export type VoxelPose = {
  bodyY: number;
  headY: number;
  bodyScaleY: number;
  headScale: number;
  limbX: number[];
  limbZ: number[];
  rootPitch: number;
  rootRoll: number;
  rootYaw: number;
  offsetY: number;
  rootScale: number;
  eyesClosed: boolean;
  toolVisible: boolean;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** View-only procedural rig sampling. Never changes authoritative position or game rules. */
export function samplePose(
  raw: string,
  age: number,
  time: number,
  reduced = false,
): VoxelPose {
  const name =
    (
      {
        navigate: "walk",
        follow_track: "walk",
        follow: "walk",
        build_voxel: "build",
        spawn_effect: "confetti",
        stop: "skid",
      } as Record<string, string>
    )[raw] || raw;
  const p: VoxelPose = {
    bodyY: 0.31,
    headY: 0.59,
    bodyScaleY: 1,
    headScale: 1,
    limbX: [0, 0, 0, 0],
    limbZ: [0, 0, 0, 0],
    rootPitch: 0,
    rootRoll: 0,
    rootYaw: 0,
    offsetY: 0,
    rootScale: 1,
    eyesClosed: false,
    toolVisible: false,
  };
  const t = reduced ? 0 : Math.max(0, age),
    beat = reduced ? 0 : time;
  if (["walk", "run", "sprint", "climb", "moonwalk"].includes(name)) {
    const speed =
      name === "sprint" ? 21 : name === "run" ? 17 : name === "climb" ? 9 : 12;
    for (let i = 0; i < 4; i++)
      p.limbX[i] =
        Math.sin(t * speed + (i % 2) * Math.PI) *
        (name === "sprint" ? 0.9 : 0.6);
    p.offsetY = Math.abs(Math.sin(t * speed)) * 0.04;
    if (name === "climb") {
      p.limbZ[2] = -0.8;
      p.limbZ[3] = 0.8;
    }
    if (name === "moonwalk") {
      p.rootPitch = -0.16;
      p.rootYaw = 0.35;
    }
  }
  if (name === "idle") p.bodyScaleY = 1 + Math.sin(beat * 2) * 0.012;
  if (name === "stand") {
    p.bodyY = 0.33;
    p.headY = 0.63;
  }
  if (name === "sit") {
    p.bodyY = 0.23;
    p.headY = 0.5;
    p.limbX[0] = p.limbX[1] = -1.4;
    p.limbX[2] = p.limbX[3] = -0.2;
  }
  if (["lie", "sleep"].includes(name)) {
    p.rootRoll = Math.PI / 2;
    p.offsetY = 0.12;
    p.eyesClosed = name === "sleep";
    p.bodyScaleY = 1 + Math.sin(beat * 2) * 0.015;
  }
  if (name === "hover") {
    p.offsetY = 0.28 + Math.sin(t * 3) * 0.08;
    p.limbZ[2] = -0.35;
    p.limbZ[3] = 0.35;
  }
  if (["jump", "double_jump", "backflip"].includes(name)) {
    const cycle =
      name === "double_jump" ? ((t % 1.1) / 0.55) % 1 : clamp(t / 0.9);
    p.offsetY =
      Math.sin(cycle * Math.PI) * (name === "double_jump" ? 0.85 : 0.65);
    p.limbX[0] = p.limbX[1] = 0.6;
    p.limbZ[2] = -0.9;
    p.limbZ[3] = 0.9;
    if (name === "backflip") p.rootPitch = -clamp(t / 0.9) * Math.PI * 2;
  }
  if (name === "dance") {
    p.rootRoll = Math.sin(t * 7) * 0.14;
    p.offsetY = Math.abs(Math.sin(t * 8)) * 0.055;
    for (let i = 0; i < 4; i++) {
      p.limbX[i] = Math.sin(t * 8 + i) * 0.25;
      p.limbZ[i] = Math.sin(t * 8 + i) * 0.75;
    }
  }
  if (name === "wave" || name === "join") {
    p.limbZ[3] = 2.1 + Math.sin(t * 12) * 0.4;
    p.rootRoll = Math.sin(t * 3) * 0.025;
  }
  if (name === "point") {
    p.limbZ[3] = 1.5;
    p.limbX[3] = -0.3;
    p.rootYaw = -0.16;
  }
  if (name === "bow") {
    p.rootPitch = 0.65 * Math.sin(clamp(t / 1.5) * Math.PI);
    p.limbX[2] = p.limbX[3] = -0.3;
  }
  if (name === "laugh") {
    p.offsetY = Math.abs(Math.sin(t * 13)) * 0.045;
    p.limbX[2] = p.limbX[3] = -1;
    p.bodyScaleY = 1 + Math.sin(t * 13) * 0.07;
  }
  if (name === "stumble") {
    p.rootRoll = Math.sin(t * 13) * 0.25 * Math.max(0.2, 1 - t / 2);
    p.limbX = [0.7, -0.8, 1, -1];
    p.limbZ = [0, 0, -0.7, 0.7];
  }
  if (name === "surprised") {
    p.headScale = 1.12;
    p.limbZ[2] = -0.85;
    p.limbZ[3] = 0.85;
    p.offsetY = 0.05;
  }
  if (["cheer", "celebrate", "confetti"].includes(name)) {
    p.limbZ[2] = -2.2;
    p.limbZ[3] = 2.2;
    p.offsetY = Math.abs(Math.sin(t * (name === "cheer" ? 6 : 9))) * 0.12;
    p.rootRoll = name === "confetti" ? 0.12 : Math.sin(t * 4) * 0.05;
  }
  if (name === "ride") {
    p.offsetY = 0.17 + Math.sin(t * 3) * 0.035;
    p.limbX[0] = p.limbX[1] = -1.1;
    p.limbX[2] = p.limbX[3] = -0.7;
  }
  if (["build", "dig", "carry"].includes(name)) {
    p.toolVisible = true;
    p.limbX[2] = -0.8;
    p.limbX[3] = name === "carry" ? -0.8 : Math.sin(t * 10) * 0.8 - 0.4;
    if (name === "dig") {
      p.rootPitch = 0.3;
      p.bodyY = 0.28;
    }
  }
  if (name === "cast") {
    p.limbX[2] = p.limbX[3] = -1.3;
    p.rootYaw = 0.12;
    p.offsetY = Math.sin(t * 4) * 0.02;
  }
  if (name === "shrug") {
    p.limbZ[2] = -1;
    p.limbZ[3] = 1;
    p.bodyY = 0.34;
  }
  if (name === "salute") {
    p.limbZ[3] = 2.25;
    p.limbX[3] = -0.4;
    p.rootYaw = -0.1;
  }
  if (name === "stretch") {
    p.limbZ[2] = -2.65;
    p.limbZ[3] = 2.65;
    p.bodyScaleY = 1.12;
    p.headY = 0.66;
  }
  if (name === "skid") {
    p.rootRoll = 0.17;
    p.limbX = [0.6, -0.6, 0.6, -0.6];
  }
  if (name === "portal_spawn")
    p.rootScale = reduced ? 1 : 0.15 + 0.85 * clamp(t / 0.7);
  if (name === "portal_depart")
    p.rootScale = reduced ? 1 : 1 - 0.85 * clamp(t / 1.5);
  if (!reduced && !p.eyesClosed && beat % 4 < 0.12) p.eyesClosed = true;
  if (reduced) {
    p.offsetY =
      name === "ride"
        ? 0.17
        : name === "hover"
          ? 0.28
          : ["lie", "sleep"].includes(name)
            ? 0.12
            : 0;
    p.rootPitch = name === "lie" || name === "sleep" ? 0 : p.rootPitch;
    p.rootRoll = name === "lie" || name === "sleep" ? Math.PI / 2 : 0;
  }
  return p;
}
