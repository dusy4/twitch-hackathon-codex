import {
  trackFrame,
  replayTrackFrames,
  reconcileObservedTracks,
  type GrayFrame,
  type TimedGrayFrame,
} from "../../packages/shared/flow.js";
import { Tracker, type Detection } from "../../packages/shared/tracker.js";
import { drawSource, outputSize } from "./composite.js";
import { transformPoint } from "../../packages/shared/geometry.js";
import type { SourceGeometry } from "../../packages/shared/contracts.js";
import type { SceneTrack } from "../../packages/shared/contracts.js";
export class CaptureCompanion {
  epoch = 0;
  private detectorWorker: Worker | null = null;
  private detectorReady = false;
  private detectorInitReject: ((error: Error) => void) | null = null;
  private detectorFrame: {
    id: number;
    epoch: number;
    sourceTime: number;
    gray: GrayFrame;
    tracks: SceneTrack[];
  } | null = null;
  private frameId = 0;
  private lifecycle = 0;
  private freshDetections = false;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private tracker = new Tracker();
  private fileURL: string | null = null;
  private lastVideoTime = -1;
  private lastSample = 0;
  private lastDetect = 0;
  private previous: GrayFrame | null = null;
  private frameHistory: TimedGrayFrame[] = [];
  private outgoingTracks: SceneTrack[] | null = null;
  private sendController: AbortController | null = null;
  private detectorLatency = 0;
  private samplingCanvas = document.createElement("canvas");
  private silhouetteWorker: Worker | null = null;
  private silhouetteReady = false;
  private silhouetteBusy = false;
  private silhouetteEnabled = false;
  private silhouetteLate = 0;
  private silhouetteLoadingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSilhouette = 0;
  private surfaces = new Map<string, { x: number; y: number; at: number }>();
  get sourceKind() {
    return this.stream
      ? "CAPTURE SOURCE"
      : this.fileURL
        ? "TEST VIDEO"
        : "NO SOURCE";
  }
  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private transmit: (
      tracks: SceneTrack[],
      signal?: AbortSignal,
    ) => Promise<void>,
    private report: (message: string) => void,
    private geometry: () => SourceGeometry,
  ) {}
  setSilhouette(enabled: boolean) {
    this.silhouetteEnabled = enabled;
    this.stopSilhouette();
    if (!enabled) return;
    document
      .querySelector("#capture-metrics")
      ?.setAttribute("data-silhouette-status", "loading");
    this.report("Loading experimental local silhouette worker...");
    const worker = new Worker(
      new URL("./silhouette.worker.ts", import.meta.url),
    );
    this.silhouetteWorker = worker;
    this.initializeSilhouette(worker);
    this.silhouetteLoadingTimer = setTimeout(() => {
      if (this.silhouetteWorker === worker && !this.silhouetteReady) {
        this.stopSilhouette();
        document
          .querySelector("#capture-metrics")
          ?.setAttribute("data-silhouette-status", "unavailable-init");
        this.report(
          "Silhouette loading timed out. Bounding-box tracking continues.",
        );
      }
    }, 30000);
  }
  private stopSilhouette() {
    if (this.silhouetteLoadingTimer) clearTimeout(this.silhouetteLoadingTimer);
    this.silhouetteLoadingTimer = null;
    this.silhouetteWorker?.terminate();
    this.silhouetteWorker = null;
    this.silhouetteReady = false;
    this.silhouetteBusy = false;
    this.surfaces.clear();
    this.silhouetteLate = 0;
    document
      .querySelector("#capture-metrics")
      ?.setAttribute("data-silhouette-status", "off");
  }
  private initializeSilhouette(worker: Worker) {
    worker.onmessage = (event) => {
      if (this.silhouetteWorker !== worker) return;
      const data = event.data;
      if (data.type === "stage")
        document
          .querySelector("#capture-metrics")
          ?.setAttribute("data-silhouette-stage", data.stage);
      if (data.type === "ready") {
        if (this.silhouetteLoadingTimer)
          clearTimeout(this.silhouetteLoadingTimer);
        this.silhouetteLoadingTimer = null;
        this.silhouetteReady = true;
        document
          .querySelector("#capture-metrics")
          ?.setAttribute("data-silhouette-status", "running");
        this.report(
          "Processing locally · experimental animal/furniture silhouette anchoring enabled",
        );
      } else if (data.type === "anchor") {
        this.silhouetteBusy = false;
        const metrics = document.querySelector("#capture-metrics");
        if (metrics) {
          metrics.setAttribute("data-silhouette", JSON.stringify(data));
        }
        if (Date.now() - data.sourceTime >= 1500) {
          if (++this.silhouetteLate >= 3) {
            this.stopSilhouette();
            metrics?.setAttribute("data-silhouette-status", "unavailable-slow");
            this.report(
              "Silhouette too slow on this device. Bounding-box tracking continues.",
            );
          }
          return;
        }
        this.silhouetteLate = 0;
        if (
          data.epoch === this.epoch &&
          data.anchor &&
          Date.now() - data.sourceTime < 1500
        ) {
          this.surfaces.set(data.id, {
            x: (data.anchor[0] - data.box[0]) / data.box[2],
            y: (data.anchor[1] - data.box[1]) / data.box[3],
            at: data.sourceTime,
          });
          metrics?.setAttribute("data-silhouette-status", "current");
        } else if (data.epoch === this.epoch) {
          metrics?.setAttribute("data-silhouette-status", "no-surface");
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
      if (this.silhouetteWorker !== worker) return;
      this.silhouetteBusy = false;
      this.silhouetteReady = false;
      this.report("Silhouette worker failed. Bounding-box mode continues.");
    };
    worker.postMessage({ type: "init" });
  }
  private async init() {
    if (this.detectorReady) return;
    this.report("Loading local object detector worker...");
    const worker = new Worker(new URL("./detector.worker.ts", import.meta.url));
    this.detectorWorker = worker;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        clearTimeout(timeout);
        this.detectorInitReject = null;
        reject(error);
      };
      const timeout = setTimeout(
        () => fail(Error("Detector initialization timed out")),
        30000,
      );
      this.detectorInitReject = fail;
      const error = (message: string) => {
        if (this.detectorWorker !== worker) return;
        if (this.detectorInitReject) this.detectorInitReject(Error(message));
        else {
          this.stop();
          this.report(`Capture stopped: ${message}`);
        }
      };
      worker.onerror = () => error("Local detector worker failed.");
      worker.onmessage = (event) => {
        if (this.detectorWorker !== worker) return;
        const data = event.data;
        if (data.type === "ready") {
          clearTimeout(timeout);
          this.detectorInitReject = null;
          this.detectorReady = true;
          resolve();
          return;
        }
        if (data.type === "error") {
          error(data.message);
          return;
        }
        if (data.type === "detections") {
          this.detectorLatency = data.durationMs;
          const pending = this.detectorFrame;
          if (!pending || data.id !== pending.id) return;
          this.detectorFrame = null;
          document
            .querySelector("#capture-metrics")
            ?.setAttribute("data-detector-ms", String(data.durationMs));
          if (
            this.stopped ||
            data.epoch !== this.epoch ||
            Date.now() - pending.sourceTime >= 2000
          )
            return;
          const observed = this.tracker.tracks;
          const detected = this.tracker
            .update(
              data.detections as Detection[],
              pending.sourceTime,
              pending.tracks,
            )
            .map((track) => ({ ...track, classifiedAt: pending.sourceTime }));
          const replay = replayTrackFrames(
            { at: pending.sourceTime, frame: pending.gray },
            this.frameHistory,
            detected,
            Date.now(),
          );
          this.tracker.tracks = reconcileObservedTracks(
            observed,
            replay?.tracks || [],
            Date.now(),
          );
          this.freshDetections = !!replay;
          if (replay) this.previous = replay.latest.frame;
        }
      };
      worker.postMessage({ type: "init" });
    });
  }
  async start(kind: "camera" | "display") {
    this.stop();
    const lifecycle = this.lifecycle;
    const stream =
      kind === "camera"
        ? await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
    if (lifecycle !== this.lifecycle) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = this.stream;
    this.stream.getVideoTracks()[0].onended = () => this.stop();
    await this.video.play();
    if (lifecycle === this.lifecycle) await this.run(lifecycle);
  }
  async file(file: File) {
    this.stop();
    const lifecycle = this.lifecycle;
    this.fileURL = URL.createObjectURL(file);
    this.video.src = this.fileURL;
    this.video.loop = true;
    await this.video.play();
    if (lifecycle === this.lifecycle) await this.run(lifecycle);
  }
  private async run(lifecycle: number) {
    try {
      await this.init();
      if (lifecycle !== this.lifecycle) return;
      this.stopped = false;
      this.tracker.reset();
      this.lastVideoTime = -1;
      this.lastSample = 0;
      this.lastDetect = 0;
      this.previous = null;
      if (this.silhouetteEnabled) this.setSilhouette(true);
      this.report(
        "Processing locally · only ephemeral class/box metadata transmitted · no video uploaded",
      );
      void this.sample();
    } catch (e) {
      if (lifecycle !== this.lifecycle) return;
      this.stop();
      throw Error(
        `Local detector could not start: ${(e as Error).message}. Run npm run setup:vision.`,
      );
    }
  }
  private async sample() {
    if (this.stopped || !this.detectorReady) return;
    const began = performance.now();
    try {
      if (
        this.detectorFrame &&
        Date.now() - this.detectorFrame.sourceTime > 4000
      )
        throw Error("Local detector stopped responding.");
      if (this.silhouetteBusy && Date.now() - this.lastSilhouette > 4000) {
        this.stopSilhouette();
        document
          .querySelector("#capture-metrics")
          ?.setAttribute("data-silhouette-status", "unavailable-timeout");
        this.report(
          "Silhouette processing timed out. Bounding-box mode continues.",
        );
      }
      if (
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.lastVideoTime
      ) {
        this.lastVideoTime = this.video.currentTime;
        const timestamp = Math.max(performance.now(), this.lastSample + 0.01);
        this.lastSample = timestamp;
        const w = this.video.videoWidth,
          h = this.video.videoHeight;
        const observedAt = Date.now();
        const sampleScale = Math.min(1, 256 / w, 256 / h);
        this.samplingCanvas.width = Math.max(1, Math.round(w * sampleScale));
        this.samplingCanvas.height = Math.max(1, Math.round(h * sampleScale));
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
        this.frameHistory = [
          ...this.frameHistory.filter(
            (observation) => observedAt - observation.at <= 2000,
          ),
          { at: observedAt, frame: current },
        ].slice(-40);
        let tracks = this.previous
          ? trackFrame(
              this.previous,
              current,
              this.tracker.tracks.filter(
                (track) =>
                  track.classifiedAt !== undefined &&
                  observedAt - track.classifiedAt < 2000,
              ),
              observedAt,
            )
          : [];
        if (this.freshDetections) {
          const flowById = new Map(tracks.map((track) => [track.id, track]));
          tracks = this.tracker.tracks.map(
            (track) => flowById.get(track.id) || track,
          );
          this.freshDetections = false;
        }
        this.tracker.tracks = tracks;
        this.previous = current;
        if (!this.detectorFrame && timestamp - this.lastDetect > 350) {
          this.lastDetect = timestamp;
          const pending = {
            id: ++this.frameId,
            epoch: this.epoch,
            sourceTime: observedAt,
            gray: current,
            tracks: tracks
              .filter((track) => track.seenAt === observedAt)
              .map((track) => ({
                ...track,
                box: [...track.box] as SceneTrack["box"],
                attributes: [...track.attributes],
                anchor: track.anchor
                  ? ([...track.anchor] as [number, number])
                  : undefined,
              })),
          };
          this.detectorFrame = pending;
          const worker = this.detectorWorker;
          const bitmapScale = Math.min(1, 640 / w, 640 / h),
            bitmapWidth = Math.max(1, Math.round(w * bitmapScale)),
            bitmapHeight = Math.max(1, Math.round(h * bitmapScale));
          void createImageBitmap(this.video, {
            resizeWidth: bitmapWidth,
            resizeHeight: bitmapHeight,
            resizeQuality: "low",
          })
            .then((bitmap) => {
              if (
                !worker ||
                this.detectorWorker !== worker ||
                this.stopped ||
                this.detectorFrame !== pending ||
                pending.epoch !== this.epoch
              ) {
                bitmap.close();
                return;
              }
              worker.postMessage(
                {
                  type: "frame",
                  bitmap,
                  id: pending.id,
                  epoch: pending.epoch,
                  sourceTime: pending.sourceTime,
                  timestamp,
                },
                [bitmap],
              );
            })
            .catch(() => {
              if (this.detectorFrame === pending) this.detectorFrame = null;
            });
        }
        for (const [id, surface] of this.surfaces)
          if (Date.now() - surface.at >= 1500) this.surfaces.delete(id);
        while (this.surfaces.size > 32)
          this.surfaces.delete(this.surfaces.keys().next().value!);
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
            const worker = this.silhouetteWorker;
            const bitmapScale = Math.min(1, 640 / w, 640 / h),
              bitmapWidth = Math.max(1, Math.round(w * bitmapScale)),
              bitmapHeight = Math.max(1, Math.round(h * bitmapScale));
            void createImageBitmap(this.video, {
              resizeWidth: bitmapWidth,
              resizeHeight: bitmapHeight,
              resizeQuality: "low",
            })
              .then((bitmap) => {
                if (
                  !worker ||
                  this.silhouetteWorker !== worker ||
                  this.stopped ||
                  this.epoch !== epoch
                ) {
                  bitmap.close();
                  if (this.silhouetteWorker === worker)
                    this.silhouetteBusy = false;
                  return;
                }
                document
                  .querySelector("#capture-metrics")
                  ?.setAttribute("data-silhouette-stage", "sending");
                worker.postMessage(
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
              .catch(() => {
                if (this.silhouetteWorker === worker)
                  this.silhouetteBusy = false;
              });
          }
        }
        const geometry = this.geometry();
        [this.canvas.width, this.canvas.height] = outputSize(geometry);
        const width = this.canvas.width,
          height = this.canvas.height;
        const ctx = this.canvas.getContext("2d")!;
        ctx.fillStyle = "#080a10";
        ctx.fillRect(0, 0, width, height);
        drawSource(ctx, this.video, w, h, geometry, width, height);
        ctx.save();
        const [vx, vy, vw, vh] = geometry.viewport;
        ctx.beginPath();
        ctx.rect(vx * width, vy * height, vw * width, vh * height);
        ctx.clip();
        ctx.strokeStyle = "#b9edc7";
        ctx.lineWidth = 3;
        ctx.font = "18px sans-serif";
        ctx.fillStyle = "#b9edc7";
        for (const track of tracks) {
          const point = (x: number, y: number) => {
            const [u, v] = transformPoint(x, y, geometry);
            return [u * width, v * height] as const;
          };
          if (track.anchor) {
            ctx.beginPath();
            ctx.arc(...point(...track.anchor), 7, 0, Math.PI * 2);
            ctx.fill();
          }
          const [x, y, bw, bh] = track.box;
          ctx.beginPath();
          ctx.moveTo(...point(x, y));
          ctx.lineTo(...point(x + bw, y));
          ctx.lineTo(...point(x + bw, y + bh));
          ctx.lineTo(...point(x, y + bh));
          ctx.closePath();
          ctx.stroke();
          const [tx, ty] = point(x, y);
          ctx.fillText(
            `${track.class} ${Math.round(track.confidence * 100)}%`,
            tx,
            ty - 8,
          );
        }
        ctx.restore();
        this.outgoingTracks = tracks;
        this.flushTracks();
        const metrics = document.querySelector("#capture-metrics");
        if (metrics)
          metrics.textContent = `${tracks.length} visible objects · ${Math.round(performance.now() - began)} ms sample · detector ${this.detectorLatency} ms · metadata queue ≤ 1 · epoch ${this.epoch}`;
      }
    } catch (e) {
      this.stop();
      this.report(`Capture paused: ${(e as Error).message}`);
      return;
    }
    this.timer = setTimeout(
      () => void this.sample(),
      Math.max(20, 50 - (performance.now() - began)),
    );
  }
  private flushTracks() {
    if (this.sendController || this.stopped) return;
    const controller = new AbortController(),
      lifecycle = this.lifecycle;
    this.sendController = controller;
    void (async () => {
      try {
        while (
          !controller.signal.aborted &&
          !this.stopped &&
          lifecycle === this.lifecycle &&
          this.outgoingTracks
        ) {
          const tracks = this.outgoingTracks;
          this.outgoingTracks = null;
          await this.transmit(tracks, controller.signal);
        }
      } catch (error) {
        if (!controller.signal.aborted && lifecycle === this.lifecycle) {
          this.stop();
          this.report(`Capture paused: ${(error as Error).message}`);
        }
      } finally {
        if (this.sendController === controller) {
          this.sendController = null;
          if (this.outgoingTracks && !this.stopped) this.flushTracks();
        }
      }
    })();
  }
  stop() {
    this.stopped = true;
    this.lifecycle++;
    this.sendController?.abort();
    this.sendController = null;
    this.outgoingTracks = null;
    this.detectorInitReject?.(Error("Capture stopped during initialization"));
    this.detectorInitReject = null;
    this.detectorWorker?.terminate();
    this.detectorWorker = null;
    this.detectorReady = false;
    this.detectorFrame = null;
    this.freshDetections = false;
    this.frameHistory = [];
    this.stopSilhouette();
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
    this.report("Capture stopped. No source video uploaded.");
  }
  dispose() {
    this.stop();
    this.silhouetteWorker?.terminate();
    this.silhouetteWorker = null;
  }
}
