import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracker, TRACK_TTL_MS } from "../packages/shared/tracker.js";
import { World } from "../apps/api/world.js";
import type { Database } from "../apps/api/db.js";
import {
  defaultConfig,
  type SceneTrack,
} from "../packages/shared/contracts.js";
test("brief observation/class gaps retain ephemeral IDs only within the existing freshness window", () => {
  const tracker = new Tracker();
  const detection = {
    class: "dog",
    box: [0.1, 0.2, 0.5, 0.5] as SceneTrack["box"],
    confidence: 0.9,
  };
  const first = tracker.update([detection], 1000)[0];
  tracker.update([], 1400);
  const second = tracker.update(
    [{ ...detection, box: [0.12, 0.2, 0.5, 0.5] }],
    1805,
  )[0];
  assert.equal(second.id, first.id);
  const other = tracker.update([{ ...detection, class: "horse" }], 1950)[0];
  assert.notEqual(other.id, first.id);
  assert.equal(tracker.update([detection], 2100)[0].id, first.id);
  assert.notEqual(
    tracker.update([detection], 2100 + TRACK_TTL_MS)[0].id,
    first.id,
  );
});
test("server retention never refreshes an unseen observation and still expires it at the hard deadline", () => {
  const world = new World({} as Database, {
    id: "retention",
    config: { ...defaultConfig, vision: true },
  });
  const now = Date.now(),
    seenAt = now - 850;
  const track: SceneTrack = {
    id: "dog",
    class: "dog",
    attributes: [],
    box: [0.2, 0.3, 0.2, 0.2],
    confidence: 0.9,
    seenAt,
  };
  world.updateTracks([track], world.state.epoch);
  world.updateTracks([], world.state.epoch);
  assert.equal(world.state.tracks[0]?.seenAt, seenAt);
  assert.equal(world.state.tracks[0]?.id, "dog");
  world.tick(now + 400);
  assert.equal(world.state.tracks.length, 0);
  world.updateTracks(
    [{ ...track, seenAt: Date.now(), classifiedAt: Date.now() - 2100 }],
    world.state.epoch,
  );
  assert.equal(
    world.state.tracks.length,
    0,
    "New motion cannot extend an expired class claim",
  );
});
test("an observed anchor outside the configured source crop is not an actionable visible target", () => {
  const world = new World({} as Database, {
    id: "cropped",
    config: {
      ...defaultConfig,
      vision: true,
      geometry: { ...defaultConfig.geometry, crop: [0.2, 0.1, 0.2, 0.1] },
    },
  });
  const track: SceneTrack = {
    id: "dog",
    class: "dog",
    attributes: [],
    box: [0.3, 0.3, 0.2, 0.2],
    confidence: 0.9,
    seenAt: Date.now(),
  };
  world.updateTracks([track], world.state.epoch);
  assert.equal(world.state.tracks.length, 1);
  world.updateTracks(
    [{ ...track, box: [0.85, 0.3, 0.1, 0.2] }],
    world.state.epoch,
  );
  assert.equal(
    world.state.tracks.length,
    0,
    "A known move outside the crop drops the old observation immediately",
  );
});
