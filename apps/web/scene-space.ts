import * as THREE from "three";

/** Coarse desktop ground projection. This contains no measured real-world pose/depth. */
export class SceneSpace {
  readonly reference = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 150);
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ray = new THREE.Raycaster();
  constructor() {
    this.reference.position.set(0, 8, 13);
    this.reference.lookAt(0, 0, -1);
    this.resize(16 / 9);
  }
  resize(aspect: number) {
    this.reference.aspect = aspect;
    this.reference.updateProjectionMatrix();
    this.reference.updateMatrixWorld(true);
  }
  groundPoint(x: number, y: number, output = new THREE.Vector3()) {
    this.ray.setFromCamera(
      new THREE.Vector2(x * 2 - 1, 1 - y * 2),
      this.reference,
    );
    if (!this.ray.ray.intersectPlane(this.ground, output))
      output.set(0, 0, -30);
    return output;
  }
}
