import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { trackFrame, type GrayFrame } from "../../packages/shared/flow.js";
import { Tracker, type Detection } from "../../packages/shared/tracker.js";
import type { SceneTrack } from "../../packages/shared/contracts.js";
export class CaptureCompanion {
  epoch = 0;
  private detector: ObjectDetector | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private tracker = new Tracker();
  private fileURL: string | null = null;
  private lastVideoTime = -1;
  private lastSample = 0;
  private lastDetect = 0;
  private previous: GrayFrame | null = null;
  private detectorConfirmed = 0;
  private samplingCanvas = document.createElement("canvas");
  private silhouetteWorker: Worker | null = null;
  private silhouetteReady = false;
  private silhouetteBusy = false;
  private lastSilhouette = 0;
  private surfaces = new Map<string, { x: number; y: number; at: number }>();
  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private transmit: (tracks: SceneTrack[]) => Promise<void>,
    private report: (message: string) => void,
  ) {}
  setSilhouette(enabled: boolean) {
    this.silhouetteWorker?.terminate();
    this.silhouetteWorker = null;
    this.silhouetteReady = false;
    this.silhouetteBusy = false;
    this.surfaces.clear();
    if (!enabled) return;
    this.report("Loading experimental local silhouette worker...");
    const worker = new Worker(
      new URL("./silhouette.worker.ts", import.meta.url),
    );
    this.silhouetteWorker = worker;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "stage")
        document
          .querySelector("#capture-metrics")
          ?.setAttribute("data-silhouette-stage", data.stage);
      if (data.type === "ready") {
        this.silhouetteReady = true;
        this.report(
          "Processing locally · experimental animal/furniture silhouette anchoring enabled",
        );
      } else if (data.type === "anchor") {
        this.silhouetteBusy = false;
        const metrics = document.querySelector("#capture-metrics");
        if (metrics) {
          metrics.setAttribute("data-silhouette", JSON.stringify(data));
        }
        if (
          data.epoch === this.epoch &&
          data.anchor &&
          Date.now() - data.sourceTime < 1500
        ) {
          this.surfaces.set(data.id, {
            x: (data.anchor[0] - data.box[0]) / data.box[2],
            y: (data.anchor[1] - data.box[1]) / data.box[3],
            at: Date.now(),
          });
        }
      } else if (data.type === "error") {
        this.silhouetteBusy = false;
        this.silhouetteReady = false;
        this.report(
          `Silhouette unavailable: ${data.message}. Bounding-box mode continues.`,
        );
      }
    };
    worker.onerror = () => {
      this.silhouetteBusy = false;
      this.silhouetteReady = false;
      this.report("Silhouette worker failed. Bounding-box mode continues.");
    };
    worker.postMessage({ type: "init" });
  }
  private async init() {
    if (!this.detector) {
      this.report("Loading local object detector…");
      const files = await FilesetResolver.forVisionTasks("/vision/wasm");
      this.detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/vision/efficientdet_lite0.tflite",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        scoreThreshold: 0.6,
        maxResults: 30,
      });
    }
  }
  async start(kind: "camera" | "display") {
    this.stop();
    this.stream =
      kind === "camera"
        ? await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
    this.video.srcObject = this.stream;
    this.stream.getVideoTracks()[0].onended = () => this.stop();
    await this.video.play();
    await this.run();
  }
  async file(file: File) {
    this.stop();
    this.fileURL = URL.createObjectURL(file);
    this.video.src = this.fileURL;
    this.video.loop = true;
    await this.video.play();
    await this.run();
  }
  private async run() {
    try {
      await this.init();
      this.stopped = false;
      this.tracker.reset();
      this.lastVideoTime = -1;
      this.lastSample = 0;
      this.lastDetect = 0;
      this.previous = null;
      this.report(
        "Processing locally · only ephemeral class/box metadata transmitted · no video uploaded",
      );
      void this.sample();
    } catch (e) {
      this.stop();
      throw Error(
        `Local detector could not start: ${(e as Error).message}. Run npm run setup:vision.`,
      );
    }
  }
  private async sample() {
    if (this.stopped || !this.detector) return;
    const began = performance.now();
    try {
      if (
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime
      ) {
        this.lastVideoTime = this.video.currentTime;
        const timestamp = Math.max(performance.now(), this.lastSample + 0.01);
        this.lastSample = timestamp;
        const w = this.video.videoWidth,
          h = this.video.videoHeight;
        this.samplingCanvas.width = 256;
        this.samplingCanvas.height = Math.max(1, Math.round((256 * h) / w));
        const grayContext = this.samplingCanvas.getContext("2d", {
          willReadFrequently: true,
        })!;
        grayContext.drawImage(
          this.video,
          0,
          0,
          this.samplingCanvas.width,
          this.samplingCanvas.height,
        );
        const rgba = grayContext.getImageData(
          0,
          0,
          this.samplingCanvas.width,
          this.samplingCanvas.height,
        ).data;
        const pixels = new Float32Array(rgba.length / 4);
        for (let i = 0; i < pixels.length; i++)
          pixels[i] =
            (rgba[i * 4] * 0.299 +
              rgba[i * 4 + 1] * 0.587 +
              rgba[i * 4 + 2] * 0.114) /
            255;
        const current = {
          width: this.samplingCanvas.width,
          height: this.samplingCanvas.height,
          pixels,
        };
        let tracks: SceneTrack[];
        if (timestamp - this.lastDetect > 350) {
          this.lastDetect = timestamp;
          this.detectorConfirmed = Date.now();
          const result = this.detector.detectForVideo(this.video, timestamp);
          const detections: Detection[] = result.detections
            .filter((d) => d.boundingBox && d.categories[0])
            .map((d) => {
              const box = d.boundingBox!;
              const cls = d.categories[0].categoryName;
              return {
                class: cls === "dining table" ? "table" : cls,
                box: [
                  Math.max(0, box.originX / w),
                  Math.max(0, box.originY / h),
                  Math.min(1, box.width / w),
                  Math.min(1, box.height / h),
                ],
                confidence: d.categories[0].score,
              };
            });
          tracks = this.tracker.update(detections, Date.now());
        } else {
          tracks =
            this.previous && Date.now() - this.detectorConfirmed < 600
              ? trackFrame(
                  this.previous,
                  current,
                  this.tracker.tracks,
                  Date.now(),
                )
              : [];
          this.tracker.tracks = tracks;
        }
        this.previous = current;
        for (const track of tracks) {
          const surface = this.surfaces.get(track.id);
          if (surface && Date.now() - surface.at < 1500)
            track.anchor = [
              track.box[0] + surface.x * track.box[2],
              track.box[1] + surface.y * track.box[3],
            ];
        }
        if (
          this.silhouetteReady &&
          !this.silhouetteBusy &&
          Date.now() - this.lastSilhouette > 700
        ) {
          const target = tracks.find((t) =>
            ["dog", "cat", "chair", "bench", "table", "book"].includes(t.class),
          );
          if (target) {
            this.silhouetteBusy = true;
            this.lastSilhouette = Date.now();
            const sourceTime = Date.now(),
              epoch = this.epoch;
            void createImageBitmap(this.video)
              .then((bitmap) => {
                if (!this.silhouetteWorker || this.stopped) {
                  bitmap.close();
                  this.silhouetteBusy = false;
                  return;
                }
                document
                  .querySelector("#capture-metrics")
                  ?.setAttribute("data-silhouette-stage", "sending");
                this.silhouetteWorker.postMessage(
                  {
                    type: "frame",
                    bitmap,
                    box: target.box,
                    id: target.id,
                    sourceTime,
                    epoch,
                  },
                  [bitmap],
                );
              })
              .catch(() => (this.silhouetteBusy = false));
          }
        }
        this.canvas.width = w;
        this.canvas.height = h;
        const rect = this.video.getBoundingClientRect();
        const fit = Math.min(rect.width / w, rect.height / h);
        this.canvas.style.width = `${w * fit}px`;
        this.canvas.style.height = `${h * fit}px`;
        this.canvas.style.left = `${(rect.width - w * fit) / 2}px`;
        this.canvas.style.top = `${(rect.height - h * fit) / 2}px`;
        const ctx = this.canvas.getContext("2d")!;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = "#b9edc7";
        ctx.lineWidth = 3;
        ctx.font = "18px sans-serif";
        ctx.fillStyle = "#b9edc7";
        for (const t of tracks) {
          if (t.anchor) {
            ctx.beginPath();
            ctx.arc(t.anchor[0] * w, t.anchor[1] * h, 7, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.strokeRect(
            t.box[0] * w,
            t.box[1] * h,
            t.box[2] * w,
            t.box[3] * h,
          );
          ctx.fillText(
            `${t.class} ${Math.round(t.confidence * 100)}%`,
            t.box[0] * w,
            t.box[1] * h - 8,
          );
        }
        await this.transmit(tracks);
        const metrics = document.querySelector("#capture-metrics");
        if (metrics)
          metrics.textContent = `${tracks.length} visible objects · ${Math.round(performance.now() - began)} ms detect + transmit · epoch ${this.epoch}`;
      }
    } catch (e) {
      this.report(`Capture paused: ${(e as Error).message}`);
      this.stop();
      return;
    }
    this.timer = setTimeout(
      () => void this.sample(),
      Math.max(20, 50 - (performance.now() - began)),
    );
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    if (this.fileURL) {
      URL.revokeObjectURL(this.fileURL);
      this.fileURL = null;
    }
    this.video.removeAttribute("src");
    this.tracker.reset();
    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.report("Capture stopped. Video is not retained.");
  }
  dispose() {
    this.stop();
    this.detector?.close();
    this.detector = null;
    this.silhouetteWorker?.terminate();
    this.silhouetteWorker = null;
  }
}
