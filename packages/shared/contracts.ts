import { z } from "zod";
export const ops = [
  "navigate",
  "jump",
  "climb",
  "jump_to_surface",
  "follow_track",
  "attach_to_track",
  "detach",
  "face_target",
  "play_animation",
  "emote",
  "spawn_effect",
  "spawn_catalog_asset",
  "ride",
  "build_voxel",
  "interact_virtual_object",
  "group_invite",
  "say_bubble",
  "wait",
  "stop",
] as const;
export const Step = z
  .object({
    op: z.enum(ops),
    name: z.string().max(64).nullable(),
    target: z.string().max(80).nullable(),
    x: z.number().min(0).max(1).nullable(),
    y: z.number().min(0).max(1).nullable(),
    durationMs: z.number().int().min(100).max(7000),
  })
  .strict();
export const Plan = z
  .object({
    version: z.literal(1),
    steps: z.array(Step).min(1).max(8),
    message: z.string().max(160),
  })
  .strict()
  .refine(
    (p) => p.steps.reduce((n, s) => n + s.durationMs, 0) <= 15000,
    "Action exceeds 15 seconds",
  );
export type ActionPlan = z.infer<typeof Plan>;
export type ActionStep = z.infer<typeof Step>;
export const Track = z
  .object({
    id: z.string().max(80),
    class: z.string().max(40),
    attributes: z.array(z.string().max(40)).max(8),
    box: z.tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ]),
    confidence: z.number().min(0).max(1),
    anchor: z
      .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
      .optional(),
    seenAt: z.number().finite(),
    classifiedAt: z.number().finite().optional(),
  })
  .strict();
export type SceneTrack = z.infer<typeof Track>;
export const Geometry = z
  .object({
    width: z.number().positive().max(8192),
    height: z.number().positive().max(8192),
    crop: z.tuple([
      z.number().min(0).max(0.95),
      z.number().min(0).max(0.95),
      z.number().min(0).max(0.95),
      z.number().min(0).max(0.95),
    ]),
    mirror: z.boolean(),
    rotation: z.enum(["0", "90", "180", "270"]),
    viewport: z
      .tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().positive().max(1),
        z.number().positive().max(1),
      ])
      .default([0, 0, 1, 1]),
  })
  .refine(
    (g) => g.crop[0] + g.crop[2] < 1 && g.crop[1] + g.crop[3] < 1,
    "Invalid crop",
  )
  .refine(
    (g) =>
      g.viewport[0] + g.viewport[2] <= 1.000001 &&
      g.viewport[1] + g.viewport[3] <= 1.000001,
    "Output viewport must fit inside the canvas",
  );
export type SourceGeometry = z.infer<typeof Geometry>;
export function transformPoint(x: number, y: number, g: SourceGeometry) {
  const [l, t, r, b] = g.crop;
  x = (x - l) / (1 - l - r);
  y = (y - t) / (1 - t - b);
  if (g.mirror) x = 1 - x;
  let u = x,
    v = y;
  switch (g.rotation) {
    case "90":
      u = 1 - y;
      v = x;
      break;
    case "180":
      u = 1 - x;
      v = 1 - y;
      break;
    case "270":
      u = y;
      v = 1 - x;
  }
  const [vx, vy, vw, vh] = g.viewport || [0, 0, 1, 1];
  return [vx + u * vw, vy + v * vh];
}
export const Config = z.object({
  title: z.string().min(1).max(80),
  public: z.boolean(),
  paused: z.boolean(),
  vision: z.boolean(),
  audio: z.number().min(0).max(0.5),
  density: z.number().int().min(5).max(150),
  maxPlayers: z.number().int().min(1).max(1000),
  reducedMotion: z.boolean(),
  ai: z.boolean(),
  chaos: z.enum(["cozy", "standard", "mayhem"]),
  geometry: Geometry,
});
export { defaultConfig } from "./settings.js";
export type Avatar = {
  id: string;
  name: string;
  color: string;
  cosmetic: string;
  equipment?: import("./equipment.js").Equipment;
  x: number;
  y: number;
  animation: string;
  animationAt?: number;
  message: string;
  target: string | null;
  lastActive: number;
};
export type Prop = {
  id: string;
  owner: string;
  kind: string;
  x: number;
  y: number;
  expires: number;
};
export type WorldSnapshot = {
  duels?: import("./duels.js").DuelState[];
  roomId: string;
  mode: "SIMULATOR" | "LIVE TWITCH" | "OFFLINE";
  epoch: number;
  tick: number;
  config: z.infer<typeof Config>;
  avatars: Avatar[];
  tracks: SceneTrack[];
  props: Prop[];
  raid: {
    id: string;
    from: string;
    count: number;
    started: number;
    test: boolean;
  } | null;
  quests: QuestState[];
};
export type QuestState = {
  id: string;
  title: string;
  type: "virtual" | "camera" | "hybrid";
  action: string;
  targetClass: string | null;
  minPlayers: number;
  sustainMs: number;
  reward: number;
  progress: number;
  completed: boolean;
};
export { catalog } from "./catalog.js";
export function periodStart(period: string, now = new Date()) {
  const d = new Date(now);
  if (period === "all") return new Date(0);
  d.setUTCHours(0, 0, 0, 0);
  if (period === "week")
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (period === "month") d.setUTCDate(1);
  else if (period === "season") {
    d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1);
  } else throw Error("Unknown period");
  return d;
}
