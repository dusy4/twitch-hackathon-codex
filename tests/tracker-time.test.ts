import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracker } from "../packages/shared/tracker.js";
import type { SceneTrack } from "../packages/shared/contracts.js";

test("late classifications associate with their source-frame positions and never rewind newer observations", () => {
  const tracker = new Tracker();
  const dog = (x: number) => ({
    class: "dog",
    box: [x, 0.3, 0.15, 0.3] as SceneTrack["box"],
    confidence: 0.8,
  });
  const [left, right] = tracker.update([dog(0.1), dog(0.65)], 1000);
  const source = [
    { ...left, seenAt: 1050 },
    { ...right, seenAt: 1050 },
  ];
  // Both objects move while inference is in flight. Their current boxes cannot identify an old frame.
  tracker.tracks = [
    { ...left, box: dog(0.65).box, seenAt: 1500 },
    { ...right, box: dog(0.1).box, seenAt: 1500 },
  ];
  const delayed = tracker.update([dog(0.1), dog(0.65)], 1050, source);
  assert.deepEqual(
    delayed.map((track) => track.id),
    [left.id, right.id],
  );
  assert.ok(
    delayed.every((track) => track.seenAt === 1050),
    "An inference response does not fabricate a new observation time",
  );
  const fresh = tracker.update([dog(0.65), dog(0.1)], 1550);
  assert.deepEqual(
    fresh.map((track) => track.id),
    [left.id, right.id],
    "Old classifications do not replace the newer motion history",
  );
});

test("an old classification cannot borrow an identity observed only in its future", () => {
  const tracker = new Tracker();
  const detection = {
    class: "dog",
    box: [0.2, 0.3, 0.3, 0.3] as SceneTrack["box"],
    confidence: 0.9,
  };
  const future = tracker.update([detection], 1500)[0];
  const old = tracker.update([detection], 1000, [])[0];
  assert.notEqual(old.id, future.id);
});
