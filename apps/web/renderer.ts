import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CharacterActor, characterFor, loadCharacter } from "./character.js";
import { SceneSpace } from "./scene-space.js";
import { buildingColors } from "../../packages/shared/construction.js";
import { PORTAL_FOOT } from "../../packages/shared/arrivals.js";
import { avatarColor, equipmentOf } from "../../packages/shared/equipment.js";
import { samplePose } from "./pose.js";
import type { Avatar, WorldSnapshot } from "../../packages/shared/contracts.js";
type Puppet = {
  actor?: CharacterActor;
  yaw: number;
  group: THREE.Group;
  hat: THREE.Group;
  label: HTMLDivElement;
  position: THREE.Vector3;
  smoothed: THREE.Vector3;
  shadow: THREE.Mesh;
};
export class RiftRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private space = new SceneSpace();
  private camera = this.space.reference.clone();
  private controls: OrbitControls | null = null;
  private viewHint: HTMLDivElement | null = null;
  private lastTime = 0;
  private root = new THREE.Group();
  private portal = new THREE.Group();
  private clock = new THREE.Clock();
  private puppets = new Map<string, Puppet>();
  private raf = 0;
  private observer: ResizeObserver;
  private glow: THREE.ShaderMaterial;
  private crowd: THREE.InstancedMesh;
  private crowdHeads: THREE.InstancedMesh;
  private crowdLimbs: THREE.InstancedMesh[] = [];
  private serverOffset = 0;
  private portalWasActive = false;
  private portalOpenedAt = 0;
  private props = new Map<string, THREE.Group>();
  private structures = new Map<string, THREE.Group>();
  private stars: THREE.Points;
  private destroyed = false;
  private contextLost = false;
  private frame = 0;
  private audio: AudioContext | null = null;
  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    this.host.dataset.status = "Graphics paused — recovering context";
  };
  private onRestored = () => {
    this.contextLost = false;
    delete this.host.dataset.status;
  };
  constructor(
    private host: HTMLElement,
    private snapshot: () => WorldSnapshot | null,
    private overlay = false,
    private focus = false,
    private viewerId: string | null = null,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x11131c, overlay ? 0 : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onRestored,
    );
    this.host.dataset.projection = "perspective";
    this.host.dataset.tracking = "coarse-ground-plane";
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.add(new THREE.HemisphereLight(0xe2ddff, 0x363545, 2.2));
    if (!overlay) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.set(0, focus ? 0.65 : 0, focus ? 0 : -1);
      this.controls.enablePan = false;
      this.controls.minDistance = focus ? 2 : 7;
      this.controls.maxDistance = focus ? 7 : 30;
      this.controls.minPolarAngle = 0.3;
      this.controls.maxPolarAngle = Math.PI * 0.46;
      this.controls.enableDamping = true;
      this.viewHint = document.createElement("div");
      this.viewHint.className = "scene-camera-controls";
      this.viewHint.style.bottom = focus ? "12px" : "74px";
      const hint = document.createElement("span");
      hint.textContent = "Drag to orbit · scroll to zoom";
      const reset = document.createElement("button");
      reset.textContent = "Reset view";
      reset.addEventListener("click", () => this.resetCamera());
      this.viewHint.append(hint, reset);
      if (!focus) {
        const spatial = document.createElement("a");
        spatial.className = "button";
        spatial.textContent = "Room AR ↗";
        spatial.href = `/ar?room=${encodeURIComponent(this.snapshot()?.roomId || new URLSearchParams(location.search).get("room") || "demo-world")}`;
        spatial.dataset.nav = "";
        this.viewHint.append(spatial);
      }
      this.host.append(this.viewHint);
    }
    const light = new THREE.DirectionalLight(0xffdfbd, 3);
    light.position.set(-6, 12, 8);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = light.shadow.camera.bottom = -16;
    light.shadow.camera.right = light.shadow.camera.top = 16;
    light.shadow.camera.far = 55;
    light.shadow.normalBias = 0.035;
    this.scene.add(light, this.root);
    this.root.add(this.portal);
    this.glow = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, strength: { value: 1 } },
      vertexShader:
        "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec2 vUv; uniform float time; uniform float strength; void main(){vec2 p=vUv-.5;float d=length(p*vec2(1.,.65));float a=atan(p.y,p.x);float wave=sin(d*47.-time*2.+sin(a*6.+time)*1.6);float veins=pow(max(0.,wave),4.);vec3 c=mix(vec3(.15,.025,.3),vec3(.67,.31,1.),veins);c+=vec3(.22,.06,.4)*(1.-d);gl_FragColor=vec4(c, strength*.94);}",
    });
    const energy = new THREE.Mesh(
      new THREE.PlaneGeometry(2.25, 3.75),
      this.glow,
    );
    energy.position.z = -0.1;
    this.portal.add(energy);
    for (let side = 0; side < 2; side++)
      for (let y = 0; y < 9; y++) {
        const block = this.block(
          0.43,
          0.43,
          0.6,
          new THREE.Color().setHSL(
            0.73,
            0.22,
            0.1 + ((y * 7 + side) % 4) * 0.025,
          ),
        );
        block.position.set(side ? 1.33 : -1.33, -1.9 + y * 0.48, 0.05);
        block.rotation.z = (y % 2 ? 1 : -1) * 0.025;
        this.portal.add(block);
        const chip = this.block(0.06, 0.25, 0.02, 0x9764c9);
        chip.position.set(side ? 1.12 : -1.12, -1.9 + y * 0.48, 0.37);
        this.portal.add(chip);
      }
    for (let side = 0; side < 2; side++)
      for (let i = 0; i < 6; i++) {
        const b = this.block(0.47, 0.4, 0.65, 0x272133);
        b.position.set(-1.2 + i * 0.48, side ? 2.15 : -2.15, 0.1);
        this.portal.add(b);
      }
    this.portal.position.set(-2, -0.1, 1);
    const crowdMat = new THREE.MeshLambertMaterial({ color: 0xa997cc });
    this.crowd = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.15, 0.22, 0.12),
      crowdMat,
      120,
    );
    this.crowd.count = 0;
    this.crowd.frustumCulled = false;
    this.scene.add(this.crowd);
    this.crowdHeads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.15, 0.14),
      new THREE.MeshLambertMaterial({ color: 0xc4b6d7 }),
      120,
    );
    this.crowdHeads.count = 0;
    this.crowdHeads.frustumCulled = false;
    this.scene.add(this.crowdHeads);
    for (let i = 0; i < 4; i++) {
      const limb = new THREE.InstancedMesh(
        new THREE.BoxGeometry(i < 2 ? 0.055 : 0.05, i < 2 ? 0.14 : 0.18, 0.08),
        crowdMat,
        120,
      );
      limb.count = 0;
      limb.frustumCulled = false;
      this.crowdLimbs.push(limb);
      this.scene.add(limb);
    }
    const starPositions = new Float32Array(180 * 3);
    for (let i = 0; i < 180; i++) {
      starPositions[i * 3] = Math.sin(i * 127.1) * 9;
      starPositions[i * 3 + 1] = Math.sin(i * 31.7) * 5;
      starPositions[i * 3 + 2] = -2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3),
    );
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xc4a0ff,
        size: 0.035,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.stars);
    if (!overlay) this.landscape();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animate();
  }
  private block(
    x: number,
    y: number,
    z: number,
    color: THREE.ColorRepresentation,
  ) {
    return new THREE.Mesh(
      new THREE.BoxGeometry(x, y, z),
      new THREE.MeshLambertMaterial({ color }),
    );
  }
  private landscape() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0x222c38, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(50, 50, 0x5e5474, 0x303c49);
    grid.position.y = -0.02;
    this.scene.add(grid);
    this.scene.fog = new THREE.Fog(0x11131c, 25, 65);
    const rim = new THREE.PointLight(0x9c58ff, 20, 12);
    rim.position.set(-2, 2, 1);
    this.scene.add(rim);
  }
  private resetCamera() {
    this.camera.copy(this.space.reference);
    if (this.focus) {
      this.camera.position.set(2.5, 1.8, 4);
      this.camera.lookAt(0, 0.65, 0);
    }
    this.controls?.target.set(0, this.focus ? 0.65 : 0, this.focus ? 0 : -1);
    this.controls?.update();
  }
  private point(x: number, y: number) {
    return this.focus ? new THREE.Vector3() : this.space.groundPoint(x, y);
  }
  private makeAvatar(a: Avatar) {
    const group = new THREE.Group();
    const equipment = equipmentOf(a);
    const hat = new THREE.Group();
    if (equipment.pet === "pocket-dragon") {
      const pet = this.makeProp("dragon_small");
      pet.scale.setScalar(0.35);
      pet.position.set(0.45, 0.4, 0);
      group.add(pet);
    }
    if (equipment.hat === "star-crown") {
      for (let i = 0; i < 5; i++) {
        const point = this.block(0.045, 0.12 + (i % 2) * 0.06, 0.045, 0xffdb80);
        point.position.set((i - 2) * 0.055, 0.24, 0);
        hat.add(point);
      }
      group.add(hat);
    }
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.23, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -0.04, -0.1);
    this.scene.add(shadow);
    const label = document.createElement("div");
    label.className = "avatar-label";
    label.dataset.avatarId = a.id;
    if (a.id === this.viewerId) label.classList.add("own-avatar");
    label.textContent = a.name;
    this.host.append(label);
    this.scene.add(group);
    group.userData.firstSeenAt = performance.now();
    const puppet = {
      group,
      yaw: 0.35,
      shadow,
      smoothed: new THREE.Vector3(),
      hat,
      label,
      position: this.point(a.x, a.y),
    };
    group.position.copy(puppet.position);
    puppet.smoothed.copy(puppet.position);

    this.puppets.set(a.id, puppet);
    // Keep the loading state honest; the old primitive rig is not the imported character.
    label.dataset.model = "loading";
    const modelName = characterFor(a.id);
    void loadCharacter(modelName)
      .then((template) => {
        if (this.destroyed || this.puppets.get(a.id) !== puppet) return;
        const actor = new CharacterActor(template, avatarColor(a));
        (puppet as Puppet).actor = actor;
        group.add(actor.root);
        // Attach an earned crown to the actual animated head; pets remain independent volumetric props.
        if (equipment.hat === "star-crown") {
          const bone = actor.bones.get("head");
          if (bone) {
            hat.position.y = 0.18;
            hat.scale.setScalar(1.3);
            bone.add(hat);
          }
        }
        label.dataset.model = modelName;
      })
      .catch(() => {
        if (this.destroyed || this.puppets.get(a.id) !== puppet) return;
        label.dataset.model = "error";
        label.title = "3D character asset could not load. Reload to retry.";
        this.host.dataset.status =
          "3D character failed to load — reload to retry";
      });
    return puppet;
  }
  private resize() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.space.resize(aspect);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (!this.host.dataset.cameraInitialized) {
      this.resetCamera();
      this.host.dataset.cameraInitialized = "true";
    }
  }
  private removeObject(object: THREE.Object3D) {
    object.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.sharedCharacterAsset) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => m.dispose());
      }
    });
    object.removeFromParent();
  }
  private makeProp(kind: string) {
    const g = new THREE.Group();
    if (kind === "dragon_small") {
      const body = this.block(0.65, 0.25, 0.25, 0x84af8c);
      g.add(body);
      const head = this.block(0.3, 0.3, 0.3, 0xb2d9a1);
      head.position.set(0.4, 0.13, 0);
      g.add(head);
      for (const x of [-1, 1]) {
        const wing = this.block(0.3, 0.07, 0.5, 0x9c8bb9);
        wing.position.set(-0.12, 0.2, x * 0.3);
        g.add(wing);
      }
      const tail = this.block(0.35, 0.08, 0.1, 0x84af8c);
      tail.position.x = -0.5;
      g.add(tail);
    } else if (kind === "castle") {
      for (let i = 0; i < 15; i++) {
        const b = this.block(0.19, 0.19, 0.18, i % 3 ? 0x6b617f : 0xbda1d1);
        b.position.set((i % 5) * 0.2 - 0.4, Math.floor(i / 5) * 0.2, 0);
        g.add(b);
      }
    } else {
      for (let i = 0; i < 22; i++) {
        const b = this.block(
          0.035,
          0.05,
          0.02,
          new THREE.Color().setHSL(i / 22, 0.8, 0.7),
        );
        b.position.set(Math.sin(i * 7) * 0.6, Math.cos(i * 3) * 0.5, 0.3);
        g.add(b);
      }
    }
    this.scene.add(g);
    return g;
  }
  private animate = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (this.contextLost) return;
    const s = this.snapshot(),
      t = this.clock.getElapsedTime();
    const reduced =
      s?.config.reducedMotion ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced && this.frame++ % 2) return;
    const delta = this.lastTime ? Math.min(0.1, t - this.lastTime) : 1 / 60;
    this.lastTime = t;
    this.controls?.update();
    const now = Date.now() + this.serverOffset;
    const raid = s?.raid;
    const elapsed = raid ? (now - raid.started) / 1000 : 100;
    const newestArrival = Math.max(
      0,
      ...(s?.avatars.map((a) => a.spawnedAt || 0) || []),
    );
    const arrivalAge = now - newestArrival;
    const arrivalActive = arrivalAge >= -200 && arrivalAge < 3000;
    const portalActive = !s?.config.paused && (!!raid || arrivalActive);
    if (portalActive && !this.portalWasActive) this.portalOpenedAt = now;
    this.portalWasActive = portalActive;
    this.portal.visible = (!this.overlay || portalActive) && !this.focus;
    this.portal.position.copy(this.point(PORTAL_FOOT[0], PORTAL_FOOT[1]));
    this.portal.position.y += 2.15;
    this.portal.rotation.y = 0.18;
    const opening = raid
      ? Math.min(1, elapsed / 1.4) *
        Math.min(1, Math.max(0, (18 - elapsed) / 2))
      : this.overlay && arrivalActive
        ? Math.min(1, (now - this.portalOpenedAt) / 350) *
          Math.min(1, Math.max(0, (3000 - arrivalAge) / 500))
        : 1;
    this.portal.scale.setScalar(Math.max(0.01, opening));
    this.glow.uniforms.time.value = reduced ? 0 : t;
    this.glow.uniforms.strength.value = raid ? 1 : 0.6;
    this.portal.rotation.z = reduced
      ? 0
      : raid
        ? Math.sin(t * 23) * Math.max(0, 1 - elapsed / 2) * 0.016
        : 0;
    this.stars.visible = !this.overlay || !!raid;
    this.stars.rotation.z = reduced ? 0 : t * 0.008;
    const wanted = new Set(s?.avatars.map((a) => a.id) || []);
    for (const [id, p] of this.puppets) {
      if (!wanted.has(id)) {
        p.actor?.dispose();
        this.removeObject(p.group);
        this.removeObject(p.shadow);
        p.label.remove();
        this.puppets.delete(id);
      }
    }
    for (const a of s?.avatars || []) {
      let p = this.puppets.get(a.id);
      if (
        p &&
        p.group.userData.appearance !==
          JSON.stringify([a.color, equipmentOf(a)])
      ) {
        p.actor?.dispose();
        this.removeObject(p.group);
        this.removeObject(p.shadow);
        p.label.remove();
        this.puppets.delete(a.id);
        p = undefined;
      }
      p ||= this.makeAvatar(a);
      p.group.userData.appearance = JSON.stringify([a.color, equipmentOf(a)]);
      p.position.copy(this.point(a.x, a.y));
      const movement = p.position.clone().sub(p.smoothed);
      if (movement.lengthSq() > 0.0001 && !this.focus)
        p.yaw = Math.atan2(movement.x, movement.z);
      p.smoothed.lerp(p.position, 1 - Math.exp(-delta * 15));
      p.group.position.copy(p.smoothed);
      const active = !["idle", "sit", "stop"].includes(a.animation);
      const pose = samplePose(
        a.animation,
        (now - (a.animationAt || a.lastActive)) / 1000,
        t,
        reduced,
      );
      p.group.position.y += pose.offsetY;
      p.group.rotation.set(pose.rootPitch, p.yaw + pose.rootYaw, pose.rootRoll);
      p.actor?.update(
        a.animation,
        (now - (a.animationAt || a.lastActive)) / 1000,
        delta,
        !!reduced,
      );
      if (p.actor) p.label.dataset.clip = String(p.actor.root.userData.clip);
      const materialization = a.spawnedAt
        ? Math.min(
            1,
            0.2 + (performance.now() - p.group.userData.firstSeenAt) / 400,
          )
        : 1;
      p.group.scale.setScalar(pose.rootScale * materialization);
      p.shadow.position.copy(p.smoothed);
      p.shadow.position.y = 0.006;
      p.shadow.scale.set(pose.rootScale, pose.rootScale, 1);
      (p.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.05,
        0.28 * (1 - pose.offsetY),
      );
      const own = a.id === this.viewerId;
      (p.shadow.material as THREE.MeshBasicMaterial).color.set(
        own ? 0x8be9be : 0x000000,
      );
      p.label.textContent = `${own ? "YOU · " : ""}${a.name}${a.message ? ` · ${a.message}` : ""}`;
      const projected = p.group.position
        .clone()
        .add(new THREE.Vector3(0, 1.5, 0))
        .project(this.camera);
      p.label.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
      p.label.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
      p.label.hidden =
        this.focus || (s!.avatars.length > 30 && !active && !own);
    }
    this.host.dataset.riggedAvatarCount = String(
      [...this.puppets.values()].filter((p) => p.actor).length,
    );
    this.host.dataset.avatarCount = String(s?.avatars.length || 0);
    this.host.dataset.portalVisible = String(
      this.portal.visible && opening > 0.1,
    );
    this.host.dataset.localAvatarId = this.viewerId || "";
    const matrix = new THREE.Object3D();
    this.crowd.count =
      raid && elapsed > 1.6
        ? Math.min(120, s?.config.density || 65, raid.count)
        : 0;
    for (let i = 0; i < this.crowd.count; i++) {
      const delay = i * 0.075;
      const age = Math.max(0, elapsed - 1.6 - delay);
      const footPoint = this.space.groundPoint(PORTAL_FOOT[0], PORTAL_FOOT[1]);
      const x =
        footPoint.x +
        Math.min(age, 4) * (i % 2 ? 1 : -1) * (0.3 + (i % 5) * 0.12);
      const foot = 0;
      const depth = footPoint.z + Math.min(age, 4) * ((i % 7) - 3) * 0.17;
      const bob = reduced ? 0 : Math.abs(Math.sin(t * 14 + i)) * 0.08;
      const y = foot + 0.25;
      matrix.rotation.set(0, 0, 0);
      matrix.position.set(x, y + bob, depth);
      matrix.scale.setScalar(age > 0 ? 1 : 0);
      matrix.updateMatrix();
      this.crowd.setMatrixAt(i, matrix.matrix);
      matrix.position.y = foot + 0.42 + bob;
      matrix.updateMatrix();
      this.crowdHeads.setMatrixAt(i, matrix.matrix);
      for (const [index, limb] of this.crowdLimbs.entries()) {
        const side = index % 2 ? 1 : -1;
        matrix.position.set(
          x + side * (index < 2 ? 0.045 : 0.11),
          foot + (index < 2 ? 0.07 : 0.25) + bob,
          depth,
        );
        matrix.rotation.z = reduced
          ? 0
          : Math.sin(t * 10 + i) * side * (index < 2 ? 0.3 : -0.4);
        matrix.updateMatrix();
        limb.setMatrixAt(i, matrix.matrix);
      }
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowdHeads.count = this.crowd.count;
    this.crowdHeads.instanceMatrix.needsUpdate = true;
    for (const limb of this.crowdLimbs) {
      limb.count = this.crowd.count;
      limb.instanceMatrix.needsUpdate = true;
    }
    this.host.dataset.anonymousCrowdCount = String(this.crowd.count);
    const propIds = new Set(s?.props.map((p) => p.id) || []);
    for (const [id, g] of this.props)
      if (!propIds.has(id)) {
        this.removeObject(g);
        this.props.delete(id);
      }
    for (const prop of s?.props || []) {
      let g = this.props.get(prop.id);
      if (!g) {
        g = this.makeProp(prop.kind);
        this.props.set(prop.id, g);
      }
      const owner = s?.avatars.find((a) => a.id === prop.owner);
      g.position.copy(
        this.point(
          (prop.kind === "dragon_small" ? owner?.x : prop.x) ?? prop.x,
          (prop.kind === "dragon_small" ? owner?.y : prop.y) ?? prop.y,
        ),
      );
      g.position.y += prop.kind === "dragon_small" ? 0.8 : 0.15;
      if (!reduced) {
        if (prop.kind === "dragon_small") {
          for (const [i, side] of [
            [2, -1],
            [3, 1],
          ])
            g.children[i].rotation.x = Math.sin(t * 14) * 0.5 * side;
        }
        g.rotation.z = prop.kind === "dragon_small" ? Math.sin(t * 3) * 0.1 : 0;
        if (prop.kind === "confetti") g.rotation.z = t;
      }
    }
    const structures = s?.structures || [];
    const buildingIds = new Set(structures.map((building) => building.id));
    for (const [id, group] of this.structures) {
      if (!buildingIds.has(id)) {
        this.removeObject(group);
        this.structures.delete(id);
      }
    }
    for (const building of structures) {
      let group = this.structures.get(building.id);
      if (group && group.userData.revision !== building.revision) {
        this.removeObject(group);
        this.structures.delete(building.id);
        group = undefined;
      }
      if (!group) {
        group = new THREE.Group();
        group.userData.revision = building.revision;
        for (const block of building.blocks) {
          const mesh = this.block(
            0.155,
            0.155,
            0.155,
            buildingColors[block.material],
          );
          mesh.position.set(
            (block.x - 3.5) * 0.16,
            block.y * 0.16 + 0.08,
            (block.z - 3.5) * 0.16,
          );
          group.add(mesh);
        }
        group.rotation.set(0.32, -0.5, 0);
        this.scene.add(group);
        this.structures.set(building.id, group);
      }
      group.position.copy(this.point(building.x, building.y));
    }
    this.host.dataset.structureBlocks = String(
      structures.reduce((total, building) => total + building.blocks.length, 0),
    );
    this.renderer.render(this.scene, this.camera);
    this.host.dataset.rendered = "true";
  };
  unlockAudio() {
    this.audio ||= new AudioContext();
    void this.audio.resume();
  }
  setServerTime(time: number) {
    if (Number.isFinite(time)) this.serverOffset = time - Date.now();
  }
  setViewerId(id: string | null) {
    this.viewerId = id;
    for (const [actorId, puppet] of this.puppets)
      puppet.label.classList.toggle("own-avatar", actorId === id);
  }
  sound(kind: string, volume = 0.08) {
    if (!this.audio || this.audio.state !== "running" || volume === 0) return;
    const now = this.audio.currentTime;
    const gain = this.audio.createGain();
    gain.gain.value = Math.min(0.08, volume);
    const limiter = this.audio.createDynamicsCompressor();
    limiter.threshold.value = -15;
    gain.connect(limiter).connect(this.audio.destination);
    for (let i = 0; i < 4; i++) {
      const oscillator = this.audio.createOscillator(),
        envelope = this.audio.createGain();
      oscillator.type = kind === "raid" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(
        kind === "raid" ? 55 * (i + 1) : [523, 659, 784, 1046][i],
        now,
      );
      oscillator.frequency.exponentialRampToValueAtTime(
        kind === "raid" ? 110 * (i + 1) : [523, 659, 784, 1046][i],
        now + 1.4,
      );
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(0.22, now + 0.08 + i * 0.08);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      oscillator.connect(envelope).connect(gain);
      oscillator.start(now);
      oscillator.stop(now + 2);
    }
    setTimeout(() => {
      gain.disconnect();
      limiter.disconnect();
    }, 2500);
  }
  drawTo(context: CanvasRenderingContext2D, width: number, height: number) {
    if (this.destroyed || this.contextLost)
      throw Error("Overlay graphics unavailable");
    this.renderer.render(this.scene, this.camera);
    context.drawImage(this.renderer.domElement, 0, 0, width, height);
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls?.dispose();
    this.viewHint?.remove();
    this.puppets.forEach((p) => {
      p.actor?.dispose();
      p.label.remove();
    });
    this.scene.traverse((o) => {
      if (
        (o instanceof THREE.Mesh || o instanceof THREE.Points) &&
        !o.userData.sharedCharacterAsset
      ) {
        o.geometry.dispose();
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x) => x.dispose());
      }
    });
    void this.audio?.close();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
