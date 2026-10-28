import { test } from "node:test";
import assert from "node:assert/strict";
import { silhouetteAnchor } from "../packages/shared/surface.js";
test("silhouette anchor uses the body under its center rather than a raised tail bounding box", () => {
  const mask = new Float32Array(10000);
  for (let y = 40; y < 70; y++)
    for (let x = 20; x < 80; x++) mask[y * 100 + x] = 0.97;
  for (let y = 15; y < 50; y++)
    for (let x = 20; x < 25; x++) mask[y * 100 + x] = 0.97;
  const anchor = silhouetteAnchor(mask, 100, 100, [0.2, 0.15, 0.6, 0.55]);
  assert.ok(anchor);
  assert.equal(anchor[0], 0.5);
  assert.equal(anchor[1], 0.4);
  assert.equal(
    silhouetteAnchor(new Float32Array(10000), 100, 100, [0.2, 0.15, 0.6, 0.55]),
    null,
  );
});
