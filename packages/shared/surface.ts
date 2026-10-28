/** Find a supported upper silhouette near the object's horizontal center. No physical geometry claim. */
export function silhouetteAnchor(
  mask: Float32Array,
  width: number,
  height: number,
  box: [number, number, number, number],
): [number, number] | null {
  const [x, y, w, h] = box;
  const center = x + w * 0.5;
  const tops: number[] = [];
  const firstX = Math.max(0, Math.floor((center - w * 0.04) * width)),
    lastX = Math.min(width - 1, Math.ceil((center + w * 0.04) * width));
  for (
    let px = firstX;
    px <= lastX;
    px += Math.max(1, Math.round(width * 0.002))
  ) {
    for (
      let py = Math.max(0, Math.floor(y * height));
      py < Math.min(height - 3, (y + h * 0.8) * height);
      py++
    ) {
      if (
        mask[py * width + px] > 0.85 &&
        mask[(py + 1) * width + px] > 0.85 &&
        mask[(py + 2) * width + px] > 0.85
      ) {
        tops.push(py / height);
        break;
      }
    }
  }
  if (tops.length < 3) return null;
  tops.sort((a, b) => a - b);
  return [center, tops[Math.floor(tops.length / 2)]];
}
