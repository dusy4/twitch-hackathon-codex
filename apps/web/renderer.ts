import * as THREE from "three";
import { avatarColor, equipmentOf } from "../../packages/shared/equipment.js";
import { samplePose } from "./pose.js";
import type { Avatar, WorldSnapshot } from "../../packages/shared/contracts.js";
type Puppet = {
  group: THREE.Group;
  limbs: THREE.Mesh[];
  hat: THREE.Group;
  label: HTMLDivElement;
  position: THREE.Vector3;
  smoothed: THREE.Vector3;
  body: THREE.Mesh;
  head: THREE.Mesh;
  eyes: THREE.Mesh[];
  tool: THREE.Mesh;
  shadow: THREE.Mesh;
};
export class RiftRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
  private root = new THREE.Group();
  private portal = new THREE.Group();
  private clock = new THREE.Clock();
  private puppets = new Map<string, Puppet>();
  private raf = 0;
  private observer: ResizeObserver;
  private glow: THREE.ShaderMaterial;
  private crowd: THREE.InstancedMesh;
  private props = new Map<string, THREE.Group>();
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
    this.camera.position.set(0, 0, 20);
    this.scene.add(new THREE.AmbientLight(0xc5b7ff, 2.5));
    const light = new THREE.DirectionalLight(0xffdfbd, 3);
    light.position.set(-3, 8, 10);
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
      new THREE.BoxGeometry(0.1, 0.19, 0.1),
      crowdMat,
      120,
    );
    this.crowd.count = 0;
    this.crowd.frustumCulled = false;
    this.scene.add(this.crowd);
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
    const base = new THREE.Group();
    const palette = [0x292638, 0x343248, 0x3a354c, 0x242333];
    for (let x = -9; x < 10; x++)
      for (let z = 0; z < 4; z++) {
        const b = this.block(
          0.97,
          0.5 + ((x * x + z) % 3) * 0.18,
          0.8,
          palette[(x + z + 40) % 4],
        );
        b.position.set(x, -2.65 - z * 0.26, -z * 0.7);
        b.rotation.x = 0.16;
        base.add(b);
        const top = this.block(0.97, 0.07, 0.8, 0x596359);
        top.position.copy(b.position);
        top.position.y += 0.27;
        top.rotation.x = 0.16;
        base.add(top);
      }
    for (let i = 0; i < 7; i++) {
      const x = Math.sin(i * 43) * 7;
      const rock = this.block(0.6, 0.6, 0.6, 0x656072);
      rock.position.set(x, -3.5 - Math.abs(Math.sin(i * 5)) * 0.9, -1);
      rock.rotation.set(0.2, 0.5, i);
      base.add(rock);
    }
    for (const x of [-6.3, 5.8]) {
      const trunk = this.block(0.17, 1.2, 0.18, 0x69575b);
      trunk.position.set(x, -1.95, -1);
      base.add(trunk);
      for (let i = 0; i < 3; i++) {
        const leaf = this.block(
          1.1 - i * 0.25,
          0.65,
          0.7,
          i % 2 ? 0x778171 : 0x596e63,
        );
        leaf.position.set(x + (i % 2) * 0.12, -1.05 + i * 0.38, -1);
        base.add(leaf);
      }
    }
    const light = new THREE.PointLight(0xa86dff, 14, 10);
    light.position.set(-2, 0, 3);
    base.add(light);
    this.scene.add(base);
  }
  private makeAvatar(a: Avatar) {
    const group = new THREE.Group();
    const equipment = equipmentOf(a);
    const shirt = avatarColor(a);
    const body = this.block(0.25, 0.29, 0.18, shirt);
    body.position.y = 0.31;
    group.add(body);
    const head = this.block(0.25, 0.25, 0.23, 0xf1c6a8);
    head.position.y = 0.59;
    group.add(head);
    const hair = this.block(0.27, 0.075, 0.24, 0x3a2c42);
    hair.position.y = 0.16;
    head.add(hair);
    const eyes: THREE.Mesh[] = [];
    for (const x of [-0.057, 0.057]) {
      const eye = this.block(0.035, 0.04, 0.02, 0x292133);
      eye.position.set(x, 0.02, 0.13);
      head.add(eye);
      eyes.push(eye);
    }
    const limbs: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const limb = this.block(
        i < 2 ? 0.09 : 0.08,
        i < 2 ? 0.24 : 0.22,
        0.1,
        i < 2 ? 0x393450 : shirt,
      );
      limb.position.set(
        (i % 2 ? 1 : -1) * (i < 2 ? 0.07 : 0.19),
        i < 2 ? 0.12 : 0.33,
        0,
      );
      group.add(limb);
      limbs.push(limb);
    }
    const tool = this.block(0.1, 0.1, 0.1, 0xc6b36f);
    tool.position.set(0, -0.14, 0.06);
    tool.visible = false;
    limbs[3].add(tool);
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
      head.add(hat);
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
    shadow.scale.y = 0.25;
    shadow.position.set(0, -0.04, -0.1);
    this.scene.add(shadow);
    const label = document.createElement("div");
    label.className = "avatar-label";
    label.textContent = a.name;
    this.host.append(label);
    this.scene.add(group);
    const puppet = {
      group,
      body,
      head,
      eyes,
      tool,
      shadow,
      smoothed: new THREE.Vector3(),
      limbs,
      hat,
      label,
      position: new THREE.Vector3(
        (a.x - 0.5) * (this.camera.right - this.camera.left),
        (0.5 - a.y) * 9,
        2,
      ),
    };
    group.position.copy(puppet.position);
    puppet.smoothed.copy(puppet.position);
    if (this.focus) group.scale.setScalar(2);
    this.puppets.set(a.id, puppet);
    return puppet;
  }
  private resize() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.camera.left = -(this.focus ? 1.1 : 4.5) * aspect;
    this.camera.right = (this.focus ? 1.1 : 4.5) * aspect;
    this.camera.top = this.focus ? 1.3 : 4.5;
    this.camera.bottom = this.focus ? -0.9 : -4.5;
    this.camera.updateProjectionMatrix();
  }
  private removeObject(object: THREE.Object3D) {
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) {
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
    const raid = s?.raid;
    const elapsed = raid ? (Date.now() - raid.started) / 1000 : 100;
    this.portal.visible = (!this.overlay || !!raid) && !this.focus;
    const opening = raid
      ? Math.min(1, elapsed / 1.4) *
        Math.min(1, Math.max(0, (18 - elapsed) / 2))
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
        this.removeObject(p.group);
        this.removeObject(p.shadow);
        p.label.remove();
        this.puppets.delete(a.id);
        p = undefined;
      }
      p ||= this.makeAvatar(a);
      p.group.userData.appearance = JSON.stringify([a.color, equipmentOf(a)]);
      p.position.set(
        (a.x - 0.5) * (this.camera.right - this.camera.left),
        (0.5 - a.y) * 9,
        2,
      );
      p.smoothed.lerp(p.position, 0.22);
      p.group.position.copy(p.smoothed);
      const active = !["idle", "sit", "stop"].includes(a.animation);
      const pose = samplePose(
        a.animation,
        (Date.now() - (a.animationAt || a.lastActive)) / 1000,
        t,
        reduced,
      );
      p.group.position.y += pose.offsetY;
      p.group.rotation.set(pose.rootPitch, pose.rootYaw, pose.rootRoll);
      p.group.scale.setScalar((this.focus ? 2 : 1) * pose.rootScale);
      p.body.position.y = pose.bodyY;
      p.body.scale.y = pose.bodyScaleY;
      p.head.position.y = pose.headY;
      p.head.scale.setScalar(pose.headScale);
      p.limbs.forEach((limb, i) => {
        limb.rotation.set(pose.limbX[i], 0, pose.limbZ[i]);
        if (i >= 2) limb.position.y = pose.bodyY + 0.02;
      });
      p.eyes.forEach((eye) => (eye.scale.y = pose.eyesClosed ? 0.12 : 1));
      p.tool.visible = pose.toolVisible;
      p.shadow.position.copy(p.smoothed);
      p.shadow.position.y -= 0.035;
      p.shadow.position.z -= 0.15;
      p.shadow.scale.set(
        (this.focus ? 2 : 1) * pose.rootScale,
        (this.focus ? 0.5 : 0.25) * pose.rootScale,
        1,
      );
      (p.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0.05,
        0.28 * (1 - pose.offsetY),
      );
      p.label.textContent = a.message ? `${a.name} · ${a.message}` : a.name;
      const projected = p.group.position
        .clone()
        .add(new THREE.Vector3(0, 0.95, 0))
        .project(this.camera);
      p.label.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
      p.label.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
      p.label.hidden = this.focus || (s!.avatars.length > 30 && !active);
    }
    const matrix = new THREE.Object3D();
    this.crowd.count =
      raid && elapsed > 1.6
        ? Math.min(120, s?.config.density || 65, raid.count)
        : 0;
    for (let i = 0; i < this.crowd.count; i++) {
      const delay = i * 0.075;
      const age = Math.max(0, elapsed - 1.6 - delay);
      const x =
        -2 + Math.min(age, 4) * (i % 2 ? 1 : -1) * (0.3 + (i % 5) * 0.12);
      const y = -1.8 - (i % 7) * 0.05;
      matrix.position.set(
        x,
        y + (reduced ? 0 : Math.abs(Math.sin(t * 14 + i)) * 0.08),
        0.4,
      );
      matrix.scale.setScalar(age > 0 ? 1 : 0);
      matrix.updateMatrix();
      this.crowd.setMatrixAt(i, matrix.matrix);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
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
      g.position.set(
        (((prop.kind === "dragon_small" ? owner?.x : prop.x) ?? prop.x) - 0.5) *
          (this.camera.right - this.camera.left),
        (0.5 - ((prop.kind === "dragon_small" ? owner?.y : prop.y) ?? prop.y)) *
          9,
        2.1,
      );
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
    this.renderer.render(this.scene, this.camera);
    this.host.dataset.rendered = "true";
  };
  unlockAudio() {
    this.audio ||= new AudioContext();
    void this.audio.resume();
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
    this.puppets.forEach((p) => p.label.remove());
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
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
