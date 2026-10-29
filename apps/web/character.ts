import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

export const characterModels = [
  "Knight",
  "Mage",
  "Rogue",
  "Barbarian",
] as const;
const templates = new Map<string, Promise<GLTF>>();
const clipCache = new WeakMap<GLTF, THREE.AnimationClip[]>();
export function characterFor(id: string) {
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return characterModels[hash % characterModels.length];
}
export function loadCharacter(name: string) {
  let pending = templates.get(name);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(`/models/kaykit/${name}.glb`);
    templates.set(name, pending);
    void pending.catch(() => templates.delete(name));
  }
  return pending;
}

/** Authored matching-rig clips; translation stays under server authority. */
export const characterClips: Record<string, string> = {
  idle: "Idle",
  stand: "Idle",
  stop: "Idle",
  walk: "Walking_A",
  navigate: "Walking_A",
  follow: "Walking_A",
  follow_track: "Walking_A",
  run: "Running_A",
  sprint: "Running_A",
  moonwalk: "Walking_Backwards",
  sit: "Sit_Floor_Idle",
  lie: "Lie_Idle",
  sleep: "Lie_Idle",
  wave: "Cheer",
  cheer: "Cheer",
  dance: "Cheer",
  bow: "Interact",
  jump: "Jump_Full_Short",
  double_jump: "Jump_Full_Long",
  backflip: "Jump_Idle",
  crouch: "Sit_Chair_Idle",
  pickup: "PickUp",
  pick_up: "PickUp",
  throw: "Throw",
  interact: "Interact",
  build: "Interact",
  build_voxel: "Interact",
  attack: "Unarmed_Melee_Attack_Punch_A",
  punch: "Unarmed_Melee_Attack_Punch_A",
  kick: "Unarmed_Melee_Attack_Kick",
  block: "Blocking",
  duel: "Spellcast_Long",
  cast: "Spellcasting",
  confetti: "Spellcast_Raise",
  spawn_effect: "Spellcast_Raise",
};

export class CharacterActor {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly bones = new Map<string, THREE.Bone>();
  private clips: THREE.AnimationClip[];
  private action: THREE.AnimationAction | null = null;
  private key = "";
  private disposed = false;
  private materials = new Set<THREE.Material>();
  constructor(template: GLTF, tint?: THREE.ColorRepresentation) {
    this.model = clone(template.scene);
    this.model.traverse((node) => {
      // Authored files contain all optional handheld weapons at once.
      if (node.parent?.name.startsWith("handslot")) node.visible = false;
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.userData.sharedCharacterAsset = true;
        if (tint && /Body/.test(node.name)) {
          const material = node.material as THREE.MeshStandardMaterial;
          const personalized = material.clone();
          personalized.color.lerp(new THREE.Color(tint), 0.35);
          node.material = personalized;
          this.materials.add(personalized);
        }
      }
      if (node instanceof THREE.Bone) this.bones.set(node.name, node);
    });
    let clips = clipCache.get(template);
    if (!clips)
      clips = template.animations.map((source) => {
        const clip = source.clone();
        // The rig's global root may animate in-place, but must not move the avatar off its server path.
        clip.tracks = clip.tracks.filter(
          (track) => track.name !== "root.position",
        );
        return clip;
      });
    clipCache.set(template, clips);
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(this.model);
    const idle = this.clips.find((clip) => clip.name === "Idle");
    if (!idle) throw Error("Character asset missing required Idle clip");
    this.mixer.clipAction(idle).play();
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.1)
      throw Error("Invalid character bounds");
    const scale = 1.25 / size.y;
    this.model.scale.multiplyScalar(scale);
    this.model.position.y -= bounds.min.y * scale;
    this.root.add(this.model);
    this.mixer.stopAllAction();
  }
  update(animation: string, age: number, delta: number, reduced: boolean) {
    if (this.disposed) return;
    const name = characterClips[animation] || "Idle";
    if (this.key !== name) {
      const clip = this.clips.find((candidate) => candidate.name === name)!;
      const next = this.mixer.clipAction(clip);
      next
        .reset()
        .setEffectiveTimeScale(animation === "sprint" ? 1.35 : 1)
        .setEffectiveWeight(1)
        .play();
      if (this.action) this.action.crossFadeTo(next, 0.18, false);
      this.action = next;
      this.key = name;
      this.root.userData.clip = name;
    }
    this.mixer.update(reduced ? 0 : Math.min(delta, 0.1));
    // A single raised arm gives wave its own gesture instead of pretending Cheer is a wave clip.
    if (animation === "wave") {
      const upper = this.bones.get("upperarmr") || this.bones.get("upperarm.r");
      const lower = this.bones.get("lowerarmr") || this.bones.get("lowerarm.r");
      if (upper) upper.rotation.z = -2.3;
      if (lower) lower.rotation.x = reduced ? 0.2 : Math.sin(age * 9) * 0.45;
    }
    this.root.userData.animation = animation;
  }
  dispose() {
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      if (node instanceof THREE.Mesh && !node.userData.sharedCharacterAsset) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
    this.materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
    // Cached geometry/materials/textures belong to templates, not an individual actor.
  }
}
