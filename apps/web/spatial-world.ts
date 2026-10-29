import * as THREE from "three";
import { CharacterActor, characterFor, loadCharacter } from "./character.js";
import { avatarColor } from "../../packages/shared/equipment.js";
import { PORTAL_FOOT } from "../../packages/shared/arrivals.js";
import type { WorldSnapshot } from "../../packages/shared/contracts.js";

type SpatialActor = {
  actor: CharacterActor;
  position: THREE.Vector3;
  yaw: number;
};

/** Real WebXR poses only. No synthetic camera/plane fallback is presented as AR. */
export class SpatialWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.01, 50);
  private content = new THREE.Group();
  private reticle: THREE.Mesh;
  private portal = new THREE.Group();
  private actors = new Map<string, SpatialActor>();
  private sensed: import("./sensed-room.js").SensedRoom | null = null;
  private pending = new Set<string>();
  private failed = new Set<string>();
  private placementVersion = 0;
  private session: XRSession | null = null;
  private space: XRReferenceSpace | null = null;
  private hitSource: XRHitTestSource | null = null;
  private hit: XRHitTestResult | null = null;
  private anchor: XRAnchor | null = null;
  private placed = false;
  private placing = false;
  private placeRequested = false;
  private disposed = false;
  private starting = false;
  private observer: ResizeObserver;
  private lastTime = 0;
  private offset = 0;
  private lastStatus = "";
  constructor(
    private host: HTMLElement,
    private snapshot: () => WorldSnapshot | null,
    private status: (message: string) => void,
    private controls: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.host.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556174, 2.2));
    const light = new THREE.DirectionalLight(0xffe4cc, 2);
    light.position.set(2, 4, 3);
    this.scene.add(light, this.content);
    this.content.matrixAutoUpdate = false;
    this.content.visible = false;
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.065, 0.08, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x98efc9, side: THREE.DoubleSide }),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    const stone = new THREE.MeshStandardMaterial({
      color: 0x30213e,
      roughness: 0.8,
    });
    const energy = new THREE.MeshBasicMaterial({
      color: 0x8d42d9,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    for (const x of [-0.2, 0.2]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.5, 0.06),
        stone,
      );
      pillar.position.set(x, 0.25, 0);
      this.portal.add(pillar);
    }
    for (const y of [0.025, 0.475]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.05, 0.06),
        stone,
      );
      beam.position.y = y;
      this.portal.add(beam);
    }
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.45), energy);
    veil.position.y = 0.25;
    this.portal.add(veil);
    this.portal.position.copy(
      this.localPosition(PORTAL_FOOT[0], PORTAL_FOOT[1]),
    );
    this.content.add(this.portal);
    this.observer = new ResizeObserver(() => {
      this.renderer.setSize(
        Math.max(1, host.clientWidth),
        Math.max(1, host.clientHeight),
      );
    });
    this.observer.observe(host);
    this.host.dataset.spatialState = "idle";
    this.controls.addEventListener("beforexrselect", this.preventControlSelect);
  }
  private preventControlSelect = (event: Event) => event.preventDefault();
  private report(message: string) {
    if (message !== this.lastStatus) {
      this.status(message);
      this.lastStatus = message;
    }
  }
  static async supported() {
    return !!(
      isSecureContext &&
      navigator.xr &&
      (await navigator.xr.isSessionSupported("immersive-ar").catch(() => false))
    );
  }
  setServerTime(time: number) {
    if (Number.isFinite(time)) this.offset = time - Date.now();
  }
  private localPosition(x: number, y: number) {
    return new THREE.Vector3((x - 0.5) * 0.9, 0, (y - 0.75) * 0.9);
  }
  async start() {
    if (this.disposed || this.starting || this.session) return;
    this.starting = true;
    let session: XRSession | null = null;
    try {
      if (!navigator.xr || !isSecureContext)
        throw Error(
          "Open this page over trusted HTTPS on a device with immersive AR support.",
        );
      // Must stay in the user's click gesture; do not await model loads before permission.
      session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: [
          "anchors",
          "dom-overlay",
          "mesh-detection",
          "plane-detection",
        ],
        domOverlay: { root: this.controls },
      });
      if (this.disposed) {
        await session.end();
        return;
      }
      this.session = session;
      session.addEventListener("end", this.onEnd);
      session.addEventListener("select", this.onSelect);
      await this.renderer.xr.setSession(session);
      if (!this.sensed) {
        try {
          const { createSensedRoom } = await import("./sensed-room.js");
          const sensed = await createSensedRoom(this.content);
          if (this.disposed || session !== this.session) {
            sensed.dispose();
            return;
          }
          this.sensed = sensed;
        } catch {
          this.host.dataset.surfaceProvider = "unavailable";
        }
        if (this.disposed || session !== this.session) return;
      }
      this.space = this.renderer.xr.getReferenceSpace();
      if (!this.space) throw Error("AR reference space unavailable");
      this.space.addEventListener("reset", this.onReset);
      const viewer = await session.requestReferenceSpace("viewer");
      this.hitSource =
        (await session.requestHitTestSource?.({ space: viewer })) || null;
      if (!this.hitSource)
        throw Error("This runtime did not provide real surface hit testing.");
      this.host.dataset.spatialState = "scanning";
      this.report(
        "Move slowly to find a desk or floor. Aim the green ring and tap to place your world. Depth occlusion is not enabled.",
      );
      this.renderer.setAnimationLoop(this.frame);
    } catch (error) {
      if (session) await session.end().catch(() => {});
      this.onEnd();
      this.report(`AR could not start: ${(error as Error).message}`);
    } finally {
      this.starting = false;
    }
  }
  private onSelect = () => {
    if (!this.hit || this.placed || this.placing) return;
    this.placeRequested = true;
  };
  private async place(hit: XRHitTestResult) {
    this.placing = true;
    const version = this.placementVersion;
    const session = this.session;
    try {
      const pose = this.space && hit.getPose(this.space);
      if (!pose) return;
      this.content.matrix.fromArray(pose.transform.matrix);
      if (hit.createAnchor) {
        try {
          const anchor = await hit.createAnchor();
          if (
            this.disposed ||
            session !== this.session ||
            version !== this.placementVersion
          ) {
            anchor.delete();
            return;
          }
          this.anchor = anchor;
        } catch {
          this.anchor = null;
        }
      }
      if (session !== this.session || version !== this.placementVersion) return;
      this.placed = true;
      this.reticle.visible = false;
      this.host.dataset.spatialState = this.anchor
        ? "anchored"
        : "placed-local-space";
      this.host.dataset.anchorProvider = this.anchor
        ? "webxr-anchor"
        : "webxr-local-space";
      this.report(
        `${this.anchor ? "Runtime anchor active" : "Placed in tracked local space; anchor API unavailable"}. Characters are about 25 cm tall. ${this.sensed ? "Sensed-room contacts activate when geometry is available" : "Sensed-room contacts could not initialize; using anchored placement only"}. Per-pixel depth is not enabled.`,
      );
    } finally {
      this.placing = false;
    }
  }
  recenter() {
    this.placementVersion++;
    this.sensed?.clear();
    this.resetActors();
    this.anchor?.delete();
    this.anchor = null;
    this.placed = false;
    this.placeRequested = false;
    this.content.visible = false;
    this.hit = null;
    if (this.session) {
      this.host.dataset.spatialState = "scanning";
      this.report("Aim at a horizontal surface and tap to place again.");
    }
  }
  private onReset = () => {
    this.recenter();
    this.report("Tracking origin changed. Place your world again.");
  };
  private resetActors() {
    for (const avatar of this.snapshot()?.avatars || []) {
      const entry = this.actors.get(avatar.id);
      if (entry) {
        entry.position.copy(this.localPosition(avatar.x, avatar.y));
        entry.actor.root.position.copy(entry.position);
      }
    }
  }
  private frame = (time: number, frame?: XRFrame) => {
    if (!frame || !this.space || !this.session || this.disposed) return;
    const delta = this.lastTime
      ? Math.min((time - this.lastTime) / 1000, 0.1)
      : 1 / 60;
    this.lastTime = time;
    if (!frame.getViewerPose(this.space)) {
      this.content.visible = false;
      this.reticle.visible = false;
      this.hit = null;
      this.host.dataset.tracking = "lost";
      this.report(
        "Tracking lost. Characters hidden until the runtime recovers.",
      );
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.host.dataset.tracking = "webxr-pose";
    if (this.anchor) {
      const pose = frame.getPose(this.anchor.anchorSpace, this.space);
      if (pose) this.content.matrix.fromArray(pose.transform.matrix);
      else {
        this.content.visible = false;
        this.renderer.render(this.scene, this.camera);
        return;
      }
    }
    if (!this.placed && this.hitSource) {
      this.hit =
        frame.getHitTestResults(this.hitSource).find((hit) => {
          const pose = hit.getPose(this.space!);
          return !!pose && pose.transform.matrix[5] > 0.8; // Horizontal desks/floors only.
        }) || null;
      this.reticle.visible = !!this.hit;
      const pose = this.hit?.getPose(this.space);
      if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
      if (this.placeRequested && this.hit && !this.placing) {
        this.placeRequested = false;
        void this.place(this.hit).catch(() =>
          this.report("Surface placement failed. Aim and tap again."),
        );
      }
    }
    const state = this.snapshot();
    this.host.dataset.hitVisible = String(this.reticle.visible);
    if (this.placed)
      this.host.dataset.anchorPosition = JSON.stringify(
        [
          this.content.matrix.elements[12],
          this.content.matrix.elements[13],
          this.content.matrix.elements[14],
        ].map((value) => Math.round(value * 10000) / 10000),
      );
    this.content.visible = this.placed && !!state && !state.config.paused;
    if (this.placed && this.sensed) {
      this.sensed.update(frame, this.space);
      const provider = this.sensed.provider;
      if (this.host.dataset.surfaceProvider !== provider)
        this.report(
          provider === "none"
            ? "No localized room geometry. Anchored placement remains available; sensed contacts and occlusion are unavailable."
            : `${provider === "mesh" ? "Room mesh" : "Coarse surface planes"} active: contact and geometry occlusion enabled. Per-pixel depth and hand occlusion are not enabled.`,
        );
      this.host.dataset.surfaceProvider = provider;
      this.host.dataset.surfaceCount = String(
        this.sensed.contacts.surfaceCount,
      );
      this.host.dataset.surfaceTriangles = String(this.sensed.triangles);
    }
    const targets = new Map<string, THREE.Vector3>();
    this.portal.visible = !!state?.raid;
    const wanted = new Set(state?.avatars.map((avatar) => avatar.id));
    for (const [id, entry] of this.actors)
      if (!wanted.has(id)) {
        entry.actor.dispose();
        this.sensed?.contacts.removeActor(id);
        this.actors.delete(id);
      }
    for (const avatar of state?.avatars || []) {
      let entry = this.actors.get(avatar.id);
      if (
        !entry &&
        !this.pending.has(avatar.id) &&
        !this.failed.has(avatar.id)
      ) {
        this.pending.add(avatar.id);
        void loadCharacter(characterFor(avatar.id))
          .then((template) => {
            if (
              this.disposed ||
              !this.snapshot()?.avatars.some(
                (candidate) => candidate.id === avatar.id,
              )
            )
              return;
            const actor = new CharacterActor(template, avatarColor(avatar));
            actor.root.scale.setScalar(0.2);
            const contact = new THREE.Mesh(
              new THREE.CircleGeometry(0.28, 24),
              new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0.22,
                depthWrite: false,
              }),
            );
            contact.rotation.x = -Math.PI / 2;
            contact.position.y = 0.006;
            actor.root.add(contact);
            const position = this.localPosition(avatar.x, avatar.y);
            actor.root.position.copy(position);
            this.actors.set(avatar.id, { actor, position, yaw: 0 });
            this.content.add(actor.root);
          })
          .catch(() => {
            this.failed.add(avatar.id);
            this.report(
              "A 3D character could not load. Check the connection and reopen AR.",
            );
          })
          .finally(() => this.pending.delete(avatar.id));
      }
      entry = this.actors.get(avatar.id);
      if (!entry) continue;
      const target = this.localPosition(avatar.x, avatar.y);
      targets.set(avatar.id, target);
      if (this.placed && this.sensed?.contacts.surfaceCount)
        this.sensed.contacts.addActor(avatar.id, entry.position);
      const movement = target.clone().sub(entry.position);
      if (movement.lengthSq() > 0.000001)
        entry.yaw = Math.atan2(movement.x, movement.z);
      if (!this.sensed?.contacts.foot(avatar.id))
        entry.position.lerp(target, 1 - Math.exp(-delta * 15));
      entry.actor.root.position.copy(entry.position);
      entry.actor.root.rotation.y = entry.yaw;
      entry.actor.update(
        avatar.animation,
        (Date.now() + this.offset - (avatar.animationAt || avatar.lastActive)) /
          1000,
        delta,
        state!.config.reducedMotion,
      );
    }
    let grounded = 0;
    if (this.placed && this.sensed && !state?.config.paused) {
      this.sensed.contacts.step(delta, targets);
      for (const [id, entry] of this.actors) {
        const foot = this.sensed.contacts.foot(id);
        if (foot) {
          entry.position.copy(foot.position);
          entry.actor.root.position.copy(foot.position);
          if (foot.grounded) grounded++;
        }
      }
    }
    this.host.dataset.groundedAvatarCount = String(grounded);
    this.host.dataset.riggedAvatarCount = String(this.actors.size);
    this.renderer.render(this.scene, this.camera);
    this.host.dataset.rendered = "true";
  };
  private onEnd = () => {
    this.placementVersion++;
    this.sensed?.clear();
    this.resetActors();
    this.renderer.setAnimationLoop(null);
    this.space?.removeEventListener("reset", this.onReset);
    this.session?.removeEventListener("select", this.onSelect);
    this.session?.removeEventListener("end", this.onEnd);
    this.hitSource?.cancel();
    this.hitSource = null;
    this.anchor?.delete();
    this.anchor = null;
    this.session = null;
    this.space = null;
    this.hit = null;
    this.placed = false;
    this.content.visible = false;
    this.reticle.visible = false;
    this.lastTime = 0;
    this.host.dataset.spatialState = "idle";
    if (!this.disposed)
      this.report(
        "AR stopped. Camera session closed. Your multiplayer character remains in the world.",
      );
  };
  async end() {
    await this.session?.end();
  }
  dispose() {
    this.disposed = true;
    const session = this.session;
    this.onEnd();
    void session?.end().catch(() => {});
    this.observer.disconnect();
    this.controls.removeEventListener(
      "beforexrselect",
      this.preventControlSelect,
    );
    for (const entry of this.actors.values()) entry.actor.dispose();
    this.actors.clear();
    this.sensed?.dispose();
    this.sensed = null;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        geometries.add(node.geometry);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
