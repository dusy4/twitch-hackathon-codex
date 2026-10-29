import * as THREE from "three";
import {
  prepareContacts,
  SpatialContacts,
  type SurfaceShape,
} from "./spatial-contacts.js";

type Entry = { mesh: THREE.Mesh; revision: number; shape: SurfaceShape };
/** Bounded ephemeral SDK geometry: depth-only draw + physics use the same measured surface and pose. */
export class SensedRoom {
  private entries = new Map<object, Entry>();
  private depth = new THREE.MeshBasicMaterial({
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  triangles = 0;
  provider: "mesh" | "planes" | "none" = "none";
  constructor(
    private content: THREE.Group,
    readonly contacts: SpatialContacts,
  ) {}
  update(frame: XRFrame, space: XRReferenceSpace) {
    const meshes = frame.detectedMeshes ? [...frame.detectedMeshes] : [];
    const planes = meshes.length
      ? []
      : frame.detectedPlanes
        ? [...frame.detectedPlanes]
        : [];
    this.provider = meshes.length ? "mesh" : planes.length ? "planes" : "none";
    const entities: (XRMesh | XRPlane)[] = meshes.length ? meshes : planes;
    const seen = new Set<object>();
    const inverse = this.content.matrix.clone().invert();
    let triangles = 0;
    for (const entity of entities.slice(0, 64)) {
      const count =
        "indices" in entity
          ? entity.indices.length / 3
          : entity.polygon.length - 2;
      if (triangles + count > 120000) continue;
      const pose = frame.getPose(
        "meshSpace" in entity ? entity.meshSpace : entity.planeSpace,
        space,
      );
      if (!pose) continue;
      let entry = this.entries.get(entity);
      const localPose = inverse
        .clone()
        .multiply(new THREE.Matrix4().fromArray(pose.transform.matrix));
      if (!entry || entry.revision !== entity.lastChangedTime) {
        let vertices: Float32Array, indices: Uint32Array;
        if ("vertices" in entity) {
          if (entity.vertices.length > 600000 || entity.indices.length > 360000)
            continue;
          vertices = new Float32Array(entity.vertices);
          indices = new Uint32Array(entity.indices);
        } else {
          const polygon = entity.polygon;
          if (polygon.length < 3 || polygon.length > 128) continue;
          const points = polygon.map(
            (point) => new THREE.Vector2(point.x, point.z),
          );
          vertices = Float32Array.from(
            polygon.flatMap((point) => [point.x, 0, point.z]),
          );
          indices = Uint32Array.from(
            THREE.ShapeUtils.triangulateShape(points, []).flat(),
          );
        }
        const shape = {
          vertices,
          indices,
          pose: localPose,
          revision: entity.lastChangedTime,
        };
        if (!SpatialContacts.valid(shape)) continue;
        if (entry) {
          entry.mesh.geometry.dispose();
          this.contacts.removeSurface(entity);
        } else {
          const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.depth);
          mesh.renderOrder = -100;
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          this.content.add(mesh);
          entry = { mesh, revision: entity.lastChangedTime, shape };
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(vertices, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        entry.mesh.geometry = geometry;
        entry.revision = entity.lastChangedTime;
        entry.shape = shape;
        this.entries.set(entity, entry);
      }
      if (triangles + entry.shape.indices.length / 3 > 120000) continue;
      entry.shape.pose.copy(localPose);
      entry.mesh.matrix.copy(localPose);
      entry.mesh.visible = true;
      if (!this.contacts.upsert(entity, entry.shape)) continue;
      seen.add(entity);
      triangles += entry.shape.indices.length / 3;
    }
    for (const [key, entry] of this.entries)
      if (!seen.has(key)) {
        entry.mesh.removeFromParent();
        entry.mesh.geometry.dispose();
        this.entries.delete(key);
        this.contacts.removeSurface(key);
      }
    this.triangles = triangles;
    if (!seen.size) this.provider = "none";
  }
  clear() {
    for (const entry of this.entries.values()) {
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
    }
    this.entries.clear();
    this.contacts.clear();
    this.triangles = 0;
    this.provider = "none";
  }
  dispose() {
    this.clear();
    this.depth.dispose();
    this.contacts.dispose();
  }
}

export async function createSensedRoom(content: THREE.Group) {
  await prepareContacts();
  return new SensedRoom(content, new SpatialContacts());
}
