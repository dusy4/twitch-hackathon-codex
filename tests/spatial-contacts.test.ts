import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import {
  SpatialContacts,
  prepareContacts,
} from "../apps/web/spatial-contacts.js";

function rectangle(x0: number, x1: number, z0: number, z1: number, y: number) {
  return {
    vertices: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    pose: new Matrix4(),
    revision: 1,
  };
}
test("actual Rapier capsule stays on a sensed desk and falls onto the lower sensed floor after walking off its edge", async () => {
  await prepareContacts();
  const contacts = new SpatialContacts();
  try {
    contacts.upsert({}, rectangle(-0.4, 0.4, -0.4, 0.4, 0));
    contacts.upsert({}, rectangle(-3, 3, -3, 3, -0.75));
    contacts.addActor("hero", new Vector3());
    const targets = new Map([["hero", new Vector3()]]);
    for (let i = 0; i < 90; i++) contacts.step(1 / 60, targets);
    assert.ok(Math.abs(contacts.foot("hero")!.position.y) < 0.012);
    assert.equal(contacts.foot("hero")!.grounded, true);
    targets.set("hero", new Vector3(1, 0, 0));
    for (let i = 0; i < 240; i++) contacts.step(1 / 60, targets);
    const foot = contacts.foot("hero")!;
    assert.ok(foot.position.x > 0.9);
    assert.ok(Math.abs(foot.position.y + 0.75) < 0.015);
    assert.equal(foot.grounded, true);
  } finally {
    contacts.dispose();
  }
});
test("sensed wall blocks a character, missing geometry freezes it, and invalid geometry is rejected", async () => {
  await prepareContacts();
  const contacts = new SpatialContacts();
  try {
    const floorKey = {},
      wallKey = {};
    contacts.upsert(floorKey, rectangle(-2, 2, -2, 2, 0));
    contacts.upsert(wallKey, {
      vertices: new Float32Array([
        0.3, 0, -1, 0.3, 1, -1, 0.3, 1, 1, 0.3, 0, 1,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      pose: new Matrix4(),
      revision: 1,
    });
    contacts.addActor("hero", new Vector3());
    const targets = new Map([["hero", new Vector3(1, 0, 0)]]);
    for (let i = 0; i < 180; i++) contacts.step(1 / 60, targets);
    const blocked = contacts.foot("hero")!.position.clone();
    assert.ok(blocked.x > 0.15 && blocked.x < 0.26);
    contacts.removeSurface(floorKey);
    contacts.removeSurface(wallKey);
    for (let i = 0; i < 120; i++) contacts.step(1 / 60, targets);
    assert.deepEqual(contacts.foot("hero")!.position, blocked);
    const invalid = rectangle(-1, 1, -1, 1, 0);
    invalid.vertices[0] = NaN;
    assert.equal(contacts.upsert({}, invalid), false);
  } finally {
    contacts.dispose();
  }
});
