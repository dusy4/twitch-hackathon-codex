import type { SceneTrack } from "./contracts.js";
export const TRACK_TTL_MS = 1200;
export type Detection = {
  class: string;
  box: SceneTrack["box"];
  confidence: number;
  attributes?: string[];
  anchor?: [number, number];
};
export function iou(a: number[], b: number[]) {
  const x = Math.max(a[0], b[0]),
    y = Math.max(a[1], b[1]),
    r = Math.min(a[0] + a[2], b[0] + b[2]),
    bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const intersect = Math.max(0, r - x) * Math.max(0, bottom - y);
  return intersect / (a[2] * a[3] + b[2] * b[3] - intersect || 1);
}
export class Tracker {
  tracks: SceneTrack[] = [];
  private nextId = 0;
  private history = new Map<string, SceneTrack>();
  reset() {
    this.tracks = [];
    this.nextId = 0;
    this.history.clear();
  }
  private remember(track: SceneTrack) {
    const previous = this.history.get(track.id);
    if (!previous || track.seenAt >= previous.seenAt)
      this.history.set(track.id, track);
  }
  update(detections: Detection[], time: number, sourceTracks?: SceneTrack[]) {
    for (const track of this.tracks) this.remember(track);
    for (const [id, track] of this.history)
      if (time - track.seenAt >= TRACK_TTL_MS) this.history.delete(id);
    // A delayed result belongs to its source frame, not the object's position when inference finishes.
    const reference = new Map(
      [...this.history.values()]
        .filter(
          (track) => track.seenAt <= time && time - track.seenAt < TRACK_TTL_MS,
        )
        .map((track) => [track.id, track]),
    );
    for (const track of sourceTracks || [])
      if (track.seenAt <= time && time - track.seenAt < TRACK_TTL_MS)
        reference.set(track.id, track);
    const recent = [...reference.values()];
    const available = new Set(recent.map((t) => t.id));
    const tracks: SceneTrack[] = [];
    for (const detection of detections) {
      const candidates = recent
        .filter((t) => available.has(t.id) && t.class === detection.class)
        .map((t) => ({ track: t, overlap: iou(t.box, detection.box) }))
        .sort((a, b) => b.overlap - a.overlap);
      const match = candidates[0]?.overlap > 0.2 ? candidates[0].track : null;
      if (match) available.delete(match.id);
      tracks.push({
        id: match?.id || `track-${++this.nextId}`,
        class: detection.class,
        attributes: detection.attributes || [],
        anchor: detection.anchor,
        box: detection.box,
        confidence: detection.confidence,
        seenAt: time,
      });
    }
    this.tracks = tracks;
    for (const track of tracks) this.remember(track);
    return tracks;
  }
}
