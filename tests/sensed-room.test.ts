import test from "node:test";
import assert from "node:assert/strict";
import { Group, Matrix4, Mesh, Vector3 } from "three";
import { createSensedRoom } from "../apps/web/sensed-room.js";

test("plane-only XR provider triangulates in anchor space, updates pose without geometry revision and drops vanished surfaces", async () => {
  const content = new Group();
  content.matrix.makeTranslation(2, 0.8, 0);
  const room = await createSensedRoom(content);
  try {
    const plane = {
      planeSpace: {},
      polygon: [
        { x: -1, z: -1 },
        { x: 1, z: -1 },
        { x: 1, z: 1 },
        { x: -1, z: 1 },
      ],
      lastChangedTime: 1,
    };
    const matrix = new Matrix4().makeTranslation(2, 0.8, 0);
    const frame = {
      detectedPlanes: new Set([plane]),
      getPose: () => ({ transform: { matrix: matrix.elements } }),
    } as unknown as XRFrame;
    room.update(frame, {} as XRReferenceSpace);
    assert.equal(room.provider, "planes");
    assert.equal(room.triangles, 2);
    assert.equal(room.contacts.surfaceCount, 1);
    const depthMesh = content.children[0] as Mesh;
    assert.equal(depthMesh.renderOrder, -100);
    assert.ok(Math.abs(depthMesh.matrix.elements[13]) < 1e-6);
    room.contacts.addActor("hero", new Vector3());
    for (let i = 0; i < 60; i++)
      room.contacts.step(1 / 60, new Map([["hero", new Vector3()]]));
    assert.equal(room.contacts.foot("hero")?.grounded, true);
    matrix.makeTranslation(2.1, 0.9, 0);
    room.update(frame, {} as XRReferenceSpace);
    assert.ok(Math.abs(depthMesh.matrix.elements[12] - 0.1) < 1e-6);
    assert.ok(Math.abs(depthMesh.matrix.elements[13] - 0.1) < 1e-6);
    (frame.detectedPlanes as unknown as Set<unknown>).clear();
    room.update(frame, {} as XRReferenceSpace);
    assert.equal(room.contacts.surfaceCount, 0);
    assert.equal(content.children.length, 0);
    assert.equal(room.provider, "none");
  } finally {
    room.dispose();
  }
});
