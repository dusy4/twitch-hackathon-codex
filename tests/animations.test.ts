import { test } from "node:test";
import assert from "node:assert/strict";
import { animationNames } from "../packages/shared/animations.js";
import { localCompile, validatePlan } from "../apps/api/compiler.js";
import { samplePose } from "../apps/web/pose.js";
test("animation catalog compiles bounded declarative poses and has finite procedural rig values", () => {
  for (const name of animationNames) {
    const plan = localCompile(name, [])!;
    assert.ok(plan, name);
    validatePlan(plan, []);
    const pose = samplePose(name, 0.35, 3.1);
    assert.ok(
      Object.values(pose)
        .flat()
        .every(
          (value) =>
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value)),
        ),
      name,
    );
  }
  assert.notDeepEqual(samplePose("sit", 0.3, 3), samplePose("stand", 0.3, 3));
  assert.notDeepEqual(samplePose("wave", 0.3, 3), samplePose("cast", 0.3, 3));
  assert.equal(samplePose("jump", 0.35, 3, true).offsetY, 0);
  assert.equal(samplePose("portal_spawn", 0.35, 3, true).rootScale, 1);
});
