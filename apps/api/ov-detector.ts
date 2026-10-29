/**
 * Client for the local open-vocabulary detector sidecar (services/ov-detector,
 * OmDet-Turbo on this PC's GPU) plus the per-room "latest phone frame" store.
 */

export type OvDetection = {
  label: string;
  score: number;
  /** [x, y, w, h], normalized 0..1, top-left origin, in the frame's image space. */
  box: [number, number, number, number];
};
export type PhoneFrame = {
  id: string;
  /** Base64 JPEG exactly as the phone sent it. */
  jpeg: string;
  bytes: number;
  width: number;
  height: number;
  receivedAt: number;
};
export type OvStatus = {
  up: boolean | null;
  device: string | null;
  lastMs: number | null;
  lastQuery: string[] | null;
  lastHits: number | null;
  lastError: string | null;
};

/** A frame older than this is not used for detection. */
export const FRAME_FRESH_MS = 5000;
export const OV_TIMEOUT_MS = 3000;
export const OV_THRESHOLD = 0.3;

export class OvDetector {
  status: OvStatus = {
    up: null,
    device: null,
    lastMs: null,
    lastQuery: null,
    lastHits: null,
    lastError: null,
  };
  private checkedAt = 0;
  constructor(
    public url: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  /** Refreshes up/device from GET /health (at most every `maxAgeMs`). */
  async health(maxAgeMs = 10000, timeoutMs = 800): Promise<OvStatus> {
    if (Date.now() - this.checkedAt < maxAgeMs) return this.status;
    this.checkedAt = Date.now();
    try {
      const res = await this.fetcher(`${this.url}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await res.json()) as { ok?: boolean; device?: string };
      this.status.up = res.ok && data.ok === true;
      this.status.device = data.device || null;
    } catch {
      this.status.up = false;
    }
    return this.status;
  }

  /** Best box per requested class; [] when the sidecar is down or finds nothing. */
  async detect(
    jpeg: string,
    classes: string[],
    threshold = OV_THRESHOLD,
    timeoutMs = OV_TIMEOUT_MS,
  ): Promise<OvDetection[]> {
    const started = Date.now();
    this.status.lastQuery = classes;
    try {
      const res = await this.fetcher(`${this.url}/detect`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: jpeg, classes, threshold }),
      });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { detections?: OvDetection[] };
      const best = new Map<string, OvDetection>();
      for (const d of data.detections || []) {
        if (
          typeof d?.label !== "string" ||
          typeof d.score !== "number" ||
          !Array.isArray(d.box) ||
          d.box.length !== 4 ||
          !d.box.every((v) => typeof v === "number" && Number.isFinite(v))
        )
          continue;
        const label = d.label.toLowerCase();
        if (!classes.includes(label) || d.score < threshold) continue;
        const [x, y, w, h] = d.box.map((v) => Math.max(0, Math.min(1, v)));
        const box: OvDetection["box"] = [
          x,
          y,
          Math.min(w, 1 - x),
          Math.min(h, 1 - y),
        ];
        if (box[2] <= 0 || box[3] <= 0) continue;
        const prev = best.get(label);
        if (!prev || d.score > prev.score)
          best.set(label, { label, score: d.score, box });
      }
      const hits = [...best.values()];
      this.status.up = true;
      this.status.lastError = null;
      this.status.lastHits = hits.length;
      return hits;
    } catch (error) {
      const e = error as Error;
      this.status.lastError =
        e?.name === "TimeoutError"
          ? `timeout after ${timeoutMs} ms`
          : (e?.message || "failed").slice(0, 200);
      this.status.lastHits = 0;
      if (e?.name !== "TimeoutError") this.status.up = false;
      return [];
    } finally {
      this.status.lastMs = Date.now() - started;
    }
  }
}
