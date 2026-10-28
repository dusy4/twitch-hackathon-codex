import { test } from "node:test";
import assert from "node:assert/strict";
import { trackFrame, replayTrackFrames } from "../packages/shared/flow.js";
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
test("delayed classifications advance only through actual contiguous image observations", () => {
  const frame = (dx: number, occluded = false) => {
    const pixels = new Float32Array(10000);
    for (let y = 30; y < 60; y++)
      for (let x = 20; x < 50; x++)
        pixels[y * 100 + x + dx] = occluded
          ? 0
          : ((x * 17 + y * 31) % 100) / 100;
    return { width: 100, height: 100, pixels };
  };
  const actor = {
    id: "temporary-dog",
    class: "dog",
    attributes: [],
    box: [0.2, 0.3, 0.3, 0.3] as [number, number, number, number],
    confidence: 0.95,
    seenAt: 0,
    classifiedAt: 0,
  };
  const origin = { at: 0, frame: frame(0) },
    history = Array.from({ length: 12 }, (_, i) => ({
      at: (i + 1) * 100,
      frame: frame(i + 1),
    }));
  const replay = replayTrackFrames(origin, history, [actor], 1250)!;
  assert.ok(replay);
  assert.ok(Math.abs(replay.tracks[0].box[0] - 0.32) < 0.001);
  assert.equal(replay.tracks[0].seenAt, 1200);
  assert.equal(replay.tracks[0].classifiedAt, 0);
  assert.equal(
    trackFrame(origin.frame, history.at(-1)!.frame, [actor], 1250).length,
    0,
    "An old classification alone cannot invent a fresh position",
  );
  assert.equal(
    replayTrackFrames(
      origin,
      history.filter(
        (observation) => observation.at < 400 || observation.at > 800,
      ),
      [actor],
      1250,
    ),
    null,
    "Missing observations break association",
  );
  assert.equal(
    replayTrackFrames(
      origin,
      history.map((observation, i) =>
        i === 5 ? { ...observation, frame: frame(i + 1, true) } : observation,
      ),
      [actor],
      1250,
    ),
    null,
    "Occlusion cannot be bridged by later frames",
  );
  assert.equal(
    replayTrackFrames(origin, history, [actor], 2100),
    null,
    "Old class evidence expires",
  );
});
