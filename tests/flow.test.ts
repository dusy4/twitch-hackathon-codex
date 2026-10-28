import { test } from "node:test";
import assert from "node:assert/strict";
import { trackFrame } from "../packages/shared/flow.js";
test("local patch tracking follows image motion and drops dissimilar/occluded image patches", () => {
  const width = 100,
    height = 100;
  const frame = (dx = 0, occluded = false) => {
    const pixels = new Float32Array(10000);
    for (let y = 30; y < 60; y++)
      for (let x = 30; x < 60; x++)
        pixels[y * 100 + x + dx] = occluded
          ? 0
          : ((x * 17 + y * 31) % 100) / 100;
    return { width, height, pixels };
  };
  const t = {
    id: "temporary",
    class: "dog",
    attributes: [],
    box: [0.3, 0.3, 0.3, 0.3] as [number, number, number, number],
    confidence: 0.9,
    seenAt: 100,
  };
  const moved = trackFrame(frame(), frame(3), [t], 150);
  assert.equal(moved.length, 1);
  assert.ok(Math.abs(moved[0].box[0] - 0.33) < 0.001);
  assert.equal(moved[0].id, t.id);
  assert.equal(trackFrame(frame(), frame(0, true), [t], 150).length, 0);
  assert.equal(trackFrame(frame(), frame(3), [t], 1000).length, 0);
});
