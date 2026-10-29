import type { SourceGeometry } from "../../packages/shared/contracts.js";
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

export function outputSize(g: SourceGeometry) {
  const scale = Math.min(1, 1280 / g.width, 720 / g.height);
  return [
    Math.max(2, Math.floor((g.width * scale) / 2) * 2),
    Math.max(2, Math.floor((g.height * scale) / 2) * 2),
  ] as const;
}
