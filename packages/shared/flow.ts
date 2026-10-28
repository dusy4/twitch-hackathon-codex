import type { SceneTrack } from "./contracts.js";
export type GrayFrame = { width: number; height: number; pixels: Float32Array };
/** Small image-space patch matcher. Ephemeral motion only, never identity recognition. */
export function trackFrame(
  previous: GrayFrame,
  current: GrayFrame,
  tracks: SceneTrack[],
  now: number,
): SceneTrack[] {
  if (previous.width !== current.width || previous.height !== current.height)
    return [];
  const { width: w, height: h } = current;
  return tracks.flatMap((track) => {
    if (now - track.seenAt > 600) return [];
    const [x, y, bw, bh] = track.box;
    const points: [number, number][] = [];
    for (let row = 1; row <= 4; row++)
      for (let col = 1; col <= 4; col++)
        points.push([
          Math.round((x + (bw * col) / 5) * w),
          Math.round((y + (bh * row) / 5) * h),
        ]);
    let best = Infinity,
      bx = 0,
      by = 0;
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        let error = 0,
          n = 0;
        for (const [px, py] of points) {
          const nx = px + dx,
            ny = py + dy;
          if (
            px < 1 ||
            px >= w - 1 ||
            py < 1 ||
            py >= h - 1 ||
            nx < 1 ||
            nx >= w - 1 ||
            ny < 1 ||
            ny >= h - 1
          )
            continue;
          for (const [ox, oy] of [
            [0, 0],
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            error += Math.abs(
              previous.pixels[(py + oy) * w + px + ox] -
                current.pixels[(ny + oy) * w + nx + ox],
            );
            n++;
          }
        }
        const score = error / Math.max(1, n) + Math.hypot(dx, dy) * 0.0002;
        if (n >= 30 && score < best) {
          best = score;
          bx = dx;
          by = dy;
        }
      }
    if (best > 0.12) return [];
    const nx = x + bx / w,
      ny = y + by / h;
    if (nx < 0 || ny < 0 || nx + bw > 1 || ny + bh > 1) return [];
    return [
      {
        ...track,
        box: [nx, ny, bw, bh],
        confidence: Math.max(0, track.confidence - 0.008),
        anchor: track.anchor
          ? [track.anchor[0] + bx / w, track.anchor[1] + by / h]
          : undefined,
        seenAt: now,
      },
    ];
  });
}
