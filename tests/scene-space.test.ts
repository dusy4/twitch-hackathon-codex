import test from "node:test";
import assert from "node:assert/strict";
import { SceneSpace } from "../apps/web/scene-space.js";
import { Vector3 } from "three";

test("perspective ground projection preserves source anchors at landscape and portrait sizes", () => {
  const space = new SceneSpace();
  for (const aspect of [16 / 9, 9 / 16, 1]) {
    space.resize(aspect);
    for (const [x, y] of [
      [0.36, 0.77],
      [0.2, 0.25],
      [0.9, 0.9],
      [0.5, 0.5],
    ]) {
      const ground = space.groundPoint(x, y);
      assert.ok(Math.abs(ground.y) < 1e-10);
      const projected = ground.clone().project(space.reference);
      assert.ok(Math.abs(projected.x - (2 * x - 1)) < 1e-6);
      assert.ok(Math.abs(projected.y - (1 - 2 * y)) < 1e-6);
    }
  }
});
test("same-sized volumetric characters diminish into depth and produce camera parallax", () => {
  const space = new SceneSpace();
  const projectedHeight = (y: number) => {
    const foot = space.groundPoint(0.55, y);
    const head = foot.clone().add(new Vector3(0, 1.25, 0));
    return head.project(space.reference).y - foot.project(space.reference).y;
  };
  assert.ok(projectedHeight(0.85) > projectedHeight(0.3) * 1.5);
  const actor = space.groundPoint(0.65, 0.75);
  const first = actor.clone().project(space.reference);
  const orbit = space.reference.clone();
  orbit.position.set(8, 8, 10);
  orbit.lookAt(0, 0, -1);
  orbit.updateMatrixWorld(true);
  assert.ok(first.distanceTo(actor.clone().project(orbit)) > 0.1);
});
