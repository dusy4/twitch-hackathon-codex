import RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";

let ready: Promise<void> | null = null;
export function prepareContacts() {
  return (ready ||= RAPIER.init());
}
type Body = {
  rigid: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  vy: number;
  grounded: boolean;
};
export type SurfaceShape = {
  vertices: Float32Array;
  indices: Uint32Array;
  pose: Matrix4;
  revision: number;
};

/** View-only contact with geometry measured by an XR provider. Never reward or server-state evidence. */
export class SpatialContacts {
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private controller = this.world.createCharacterController(0.003);
  private surfaces = new Map<
    object,
    { collider: RAPIER.Collider; revision: number; pose: number[] }
  >();
  private actors = new Map<string, Body>();
  private accumulated = 0;
  private dirty = false;
  readonly halfHeight = 0.125;
  constructor() {
    this.world.timestep = 1 / 60;
    this.controller.enableSnapToGround(0.015);
    this.controller.enableAutostep(0.035, 0.045, false);
    this.controller.setMaxSlopeClimbAngle(Math.PI / 4);
    this.controller.setMinSlopeSlideAngle(Math.PI / 3);
  }
  get surfaceCount() {
    return this.surfaces.size;
  }
  static valid(shape: SurfaceShape) {
    return (
      shape.vertices.length >= 9 &&
      shape.vertices.length <= 600000 &&
      shape.vertices.length % 3 === 0 &&
      shape.indices.length >= 3 &&
      shape.indices.length <= 360000 &&
      shape.indices.length % 3 === 0 &&
      shape.vertices.every(
        (value) => Number.isFinite(value) && Math.abs(value) < 100,
      ) &&
      shape.indices.every((index) => index < shape.vertices.length / 3) &&
      shape.pose.elements.every(
        (value) => Number.isFinite(value) && Math.abs(value) < 1000,
      )
    );
  }
  upsert(key: object, shape: SurfaceShape) {
    let entry = this.surfaces.get(key);
    if (
      !shape.pose.elements.every(
        (value) => Number.isFinite(value) && Math.abs(value) < 1000,
      )
    )
      return false;
    if (
      (!entry || entry.revision !== shape.revision) &&
      !SpatialContacts.valid(shape)
    )
      return false;
    if (entry && entry.revision !== shape.revision) {
      this.removeSurface(key);
      entry = undefined;
    }
    if (!entry) {
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices),
      );
      entry = { collider, revision: shape.revision, pose: [] };
      this.surfaces.set(key, entry);
    }
    if (
      entry.pose.length &&
      shape.pose.elements.every(
        (value, index) => Math.abs(value - entry.pose[index]) < 1e-7,
      )
    )
      return true;
    entry.pose = [...shape.pose.elements];
    const position = new Vector3(),
      rotation = new Quaternion(),
      scale = new Vector3();
    shape.pose.decompose(position, rotation, scale);
    entry.collider.setTranslation(position);
    entry.collider.setRotation(rotation);
    this.dirty = true;
    return true;
  }
  removeSurface(key: object) {
    const entry = this.surfaces.get(key);
    if (entry) {
      this.world.removeCollider(entry.collider, false);
      this.surfaces.delete(key);
      this.dirty = true;
    }
  }
  addActor(id: string, foot: Vector3) {
    if (this.actors.has(id)) return;
    if (this.dirty) {
      this.world.step();
      this.dirty = false;
    }
    const probe = this.world.castRay(
      new RAPIER.Ray(
        { x: foot.x, y: foot.y + 0.3, z: foot.z },
        { x: 0, y: -1, z: 0 },
      ),
      0.3,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    const startY = probe
      ? Math.max(foot.y, foot.y + 0.3 - probe.timeOfImpact)
      : foot.y;
    const rigid = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        foot.x,
        startY + this.halfHeight + 0.006,
        foot.z,
      ),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.075, 0.05),
      rigid,
    );
    this.actors.set(id, { rigid, collider, vy: 0, grounded: false });
    this.dirty = true;
  }
  removeActor(id: string) {
    const body = this.actors.get(id);
    if (body) {
      this.world.removeRigidBody(body.rigid);
      this.actors.delete(id);
    }
  }
  step(delta: number, targets: Map<string, Vector3>) {
    // A disappeared/unlocalizable room must not become an invented infinite floor or a fall through empty data.
    if (!this.surfaces.size) {
      for (const body of this.actors.values()) body.grounded = false;
      this.accumulated = 0;
      return;
    }
    this.accumulated = Math.min(0.1, this.accumulated + Math.max(0, delta));
    if (this.dirty) {
      this.world.step();
      this.dirty = false;
    }
    while (this.accumulated >= 1 / 60) {
      for (const [id, body] of this.actors) {
        const target = targets.get(id);
        if (!target) continue;
        const current = body.rigid.translation();
        const dx = target.x - current.x,
          dz = target.z - current.z;
        const distance = Math.hypot(dx, dz);
        const step = Math.min(distance, 0.45 / 60);
        body.vy = body.grounded ? -0.1 : Math.max(-3, body.vy - 9.81 / 60);
        this.controller.computeColliderMovement(
          body.collider,
          {
            x: distance > 0.0001 ? (dx / distance) * step : 0,
            y: body.vy / 60,
            z: distance > 0.0001 ? (dz / distance) * step : 0,
          },
          RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC |
            RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        );
        const movement = this.controller.computedMovement();
        body.grounded = this.controller.computedGrounded();
        body.rigid.setNextKinematicTranslation({
          x: current.x + movement.x,
          y: current.y + movement.y,
          z: current.z + movement.z,
        });
      }
      this.world.step();
      this.accumulated -= 1 / 60;
    }
  }
  foot(id: string) {
    const body = this.actors.get(id);
    if (!body) return null;
    const position = body.rigid.translation();
    return {
      position: new Vector3(
        position.x,
        position.y - this.halfHeight,
        position.z,
      ),
      grounded: body.grounded,
    };
  }
  clearActors() {
    for (const id of this.actors.keys()) this.removeActor(id);
    this.accumulated = 0;
  }
  clear() {
    this.clearActors();
    for (const key of this.surfaces.keys()) this.removeSurface(key);
  }
  dispose() {
    this.world.free();
    this.actors.clear();
    this.surfaces.clear();
  }
}
