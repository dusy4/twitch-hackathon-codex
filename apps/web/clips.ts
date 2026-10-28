import type { SourceGeometry } from "../../packages/shared/contracts.js";
type ClipResult = { url: string; mime: string; bytes: number; elapsed: number };
type Session = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  bytes: number;
  started: number;
  discard: boolean;
  raf: number;
  timeout: ReturnType<typeof setTimeout> | null;
};

/** Draw the same normalized crop -> mirror -> rotation -> output viewport used by target mapping. */
export function drawSource(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  g: SourceGeometry,
  width: number,
  height: number,
) {
  const [l, t, r, b] = g.crop,
    [vx, vy, vw, vh] = g.viewport;
  ctx.save();
  ctx.translate(vx * width, vy * height);
  ctx.scale(vw * width, vh * height);
  if (g.rotation === "90") ctx.transform(0, 1, -1, 0, 1, 0);
  if (g.rotation === "180") ctx.transform(-1, 0, 0, -1, 1, 1);
  if (g.rotation === "270") ctx.transform(0, -1, 1, 0, 0, 1);
  if (g.mirror) {
    ctx.translate(1, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    source,
    l * sourceWidth,
    t * sourceHeight,
    (1 - l - r) * sourceWidth,
    (1 - t - b) * sourceHeight,
    0,
    0,
    1,
    1,
  );
  ctx.restore();
}

/** Explicit local-only, video-only capture; no upload or background rolling buffer. */
export class LocalClipRecorder {
  private session: Session | null = null;
  private savedURL: string | null = null;
  private disposed = false;
  private starting = false;
  private startVersion = 0;
  constructor(
    private video: HTMLVideoElement,
    private geometry: () => SourceGeometry,
    private overlay: (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
    ) => void,
    private label: () => string,
    private report: (text: string) => void,
    private complete: (result: ClipResult) => void,
  ) {}
  get active() {
    return this.session !== null || this.starting;
  }
  async start(consent: boolean) {
    if (!consent)
      throw Error(
        "Confirm that you have permission to record the source and participants.",
      );
    if (this.disposed || this.session || this.starting)
      throw Error("A clip is already recording or finishing.");
    if (
      typeof MediaRecorder === "undefined" ||
      !HTMLCanvasElement.prototype.captureStream
    )
      throw Error("This browser cannot record a local composite clip.");
    if (this.video.paused)
      throw Error("Start an active permitted capture source first.");
    const version = ++this.startVersion;
    if (this.video.readyState < 2 || !this.video.videoWidth) {
      this.starting = true;
      this.report(
        "Waiting briefly for the active source to finish buffering...",
      );
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.video.removeEventListener("loadeddata", finish);
          this.video.removeEventListener("canplay", finish);
          resolve();
        };
        const timer = setTimeout(finish, 750);
        this.video.addEventListener("loadeddata", finish, { once: true });
        this.video.addEventListener("canplay", finish, { once: true });
      });
      if (this.disposed || version !== this.startVersion) return;
      this.starting = false;
    }
    if (
      this.video.paused ||
      this.video.readyState < 2 ||
      !this.video.videoWidth
    )
      throw Error(
        "The source is still buffering. Try recording again when video resumes.",
      );
    const mime = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime)
      throw Error("No supported clip encoder is available in this browser.");
    this.clearSaved();
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      1280 / this.video.videoWidth,
      720 / this.video.videoHeight,
    );
    canvas.width = Math.max(
      2,
      Math.floor((this.video.videoWidth * scale) / 2) * 2,
    );
    canvas.height = Math.max(
      2,
      Math.floor((this.video.videoHeight * scale) / 2) * 2,
    );
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 2_000_000,
      });
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      throw error;
    }
    const session: Session = {
      recorder,
      stream,
      chunks: [],
      bytes: 0,
      started: performance.now(),
      discard: false,
      raf: 0,
      timeout: null,
    };
    this.session = session;
    recorder.ondataavailable = (event) => {
      if (!session.discard && event.data.size) {
        session.chunks.push(event.data);
        session.bytes += event.data.size;
        if (session.bytes > 12 * 1024 * 1024) this.stop();
      }
    };
    recorder.onerror = () => {
      session.discard = true;
      this.report("Clip encoder failed. The unfinished clip was discarded.");
      this.stop();
    };
    recorder.onstop = () => {
      this.release(session);
      if (this.session === session) this.session = null;
      if (this.disposed || session.discard) {
        session.chunks = [];
        return;
      }
      const blob = new Blob(session.chunks, { type: recorder.mimeType });
      session.chunks = [];
      if (blob.size < 100) {
        this.report("The clip was empty. Try recording for a little longer.");
        return;
      }
      this.savedURL = URL.createObjectURL(blob);
      this.complete({
        url: this.savedURL,
        mime: blob.type,
        bytes: blob.size,
        elapsed: performance.now() - session.started,
      });
      this.report(
        "Clip ready locally. Video only; avatar labels, microphone and source audio omitted. Nothing uploaded.",
      );
    };
    let lastFrameAt = performance.now();
    const frame = () => {
      if (session.discard || this.disposed || recorder.state === "inactive")
        return;
      if (this.video.paused) {
        this.abort("The source was paused");
        return;
      }
      if (this.video.readyState < 2) {
        if (performance.now() - lastFrameAt > 750)
          this.abort("The source stopped supplying video frames");
        else session.raf = requestAnimationFrame(frame);
        return;
      }
      lastFrameAt = performance.now();
      try {
        ctx.fillStyle = "#10121b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        drawSource(
          ctx,
          this.video,
          this.video.videoWidth,
          this.video.videoHeight,
          this.geometry(),
          canvas.width,
          canvas.height,
        );
        this.overlay(ctx, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(16,18,27,.85)";
        ctx.fillRect(8, 8, Math.min(canvas.width - 16, 390), 26);
        ctx.fillStyle = "#cfefdc";
        ctx.font = "12px monospace";
        ctx.fillText(`RAIDRIFT · ${this.label().slice(0, 45)}`, 16, 26);
        this.report(
          `Recording locally · ${Math.floor((performance.now() - session.started) / 1000)}/20 seconds · video only`,
        );
      } catch {
        this.abort();
        this.report(
          "The source cannot be recorded. The unfinished clip was discarded.",
        );
        return;
      }
      session.raf = requestAnimationFrame(frame);
    };
    try {
      recorder.start(250);
      frame();
      session.timeout = setTimeout(() => this.stop(), 20000);
    } catch (error) {
      session.discard = true;
      this.release(session);
      this.session = null;
      throw error;
    }
  }
  stop() {
    const s = this.session;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    if (s.timeout) clearTimeout(s.timeout);
    if (s.recorder.state !== "inactive") s.recorder.stop();
  }
  abort(reason = "Recording cancelled") {
    this.startVersion++;
    if (this.starting) {
      this.starting = false;
      this.report(`${reason}. No recording started.`);
    }
    if (this.session) {
      this.session.discard = true;
      this.stop();
      this.report(`${reason}. The unfinished clip was discarded.`);
    }
  }
  clearSaved() {
    if (this.savedURL) {
      URL.revokeObjectURL(this.savedURL);
      this.savedURL = null;
    }
  }
  private release(s: Session) {
    cancelAnimationFrame(s.raf);
    if (s.timeout) clearTimeout(s.timeout);
    s.stream.getTracks().forEach((t) => t.stop());
  }
  dispose() {
    this.disposed = true;
    const session = this.session;
    this.abort();
    if (session) this.release(session);
    this.clearSaved();
  }
}
