import type { SourceGeometry } from "./contracts.js";
export function transformPoint(x: number, y: number, g: SourceGeometry) {
  const [l, t, r, b] = g.crop;
  x = (x - l) / (1 - l - r);
  y = (y - t) / (1 - t - b);
  if (g.mirror) x = 1 - x;
  let u = x,
    v = y;
  switch (g.rotation) {
    case "90":
      u = 1 - y;
      v = x;
      break;
    case "180":
      u = 1 - x;
      v = 1 - y;
      break;
    case "270":
      u = y;
      v = 1 - x;
  }
  const [vx, vy, vw, vh] = g.viewport || [0, 0, 1, 1];
  return [vx + u * vw, vy + v * vh];
}
