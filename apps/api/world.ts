import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  defaultConfig,
  type WorldSnapshot,
  type Avatar,
  type ActionPlan,
  type ActionStep,
  type SceneTrack,
  type QuestState,
  transformPoint,
} from "../../packages/shared/contracts.js";
import {
  GameError,
  localCompile,
  compileAI,
  validatePlan,
} from "./compiler.js";
import { credit } from "./economy.js";
import type { Database } from "./db.js";
import { DuelArena } from "./duels.js";
import { TRACK_TTL_MS } from "../../packages/shared/tracker.js";
type Running = {
  id: string;
  actorId: string;
  plan: ActionPlan;
  index: number;
  started: number;
  origin: [number, number];
};
export class World extends EventEmitter {
  duels = new DuelArena((type, duel) => this.event(type, duel));
  state: WorldSnapshot;
  running = new Map<string, Running>();
  cooldowns = new Map<string, number>();
  questSince = new Map<string, number>();
  questGroups = new Map<string, string>();
  evidence = new Map<
    string,
    { at: number; hash: string; probability: number }[]
  >();
  aiInFlight = 0;
  aiMinute: number[] = [];
  busyQuest = false;
  sequence = 0;
  completedActions = 0;
  private planningFence = 0;
  constructor(
    public db: Database,
    public channel: Record<string, any>,
    saved?: any,
  ) {
    super();
    this.state = {
      roomId: channel.id,
      mode: channel.id.startsWith("demo")
        ? "SIMULATOR"
        : channel.connected
          ? "LIVE TWITCH"
          : "OFFLINE",
      epoch: Date.now(),
      tick: 0,
      config: { ...defaultConfig, ...channel.config },
      avatars: (saved?.avatars || []).map((a: Avatar) => ({
        ...a,
        animation: "idle",
        target: null,
        message: "",
      })),
      tracks: [],
      props: [],
      raid: null,
      quests: [],
    };
  }
  event(type: string, payload: any) {
    this.emit("event", {
      type,
      version: 1,
      eventId: randomUUID(),
      roomId: this.channel.id,
      serverTime: new Date().toISOString(),
      sceneEpoch: this.state.epoch,
      tick: this.state.tick,
      sequence: ++this.sequence,
      payload,
    });
  }
  async loadQuests() {
    this.state.quests = (
      await this.db.query(
        "SELECT id,definition FROM quests WHERE channel_id=$1 AND active=true",
        [this.channel.id],
      )
    ).rows.map((q) => ({
      ...q.definition,
      id: q.id,
      progress: 0,
      completed: false,
    }));
  }
  async join(who: Record<string, any>) {
    if (who.deleted) throw new GameError("DELETED", "Account is deleted", 403);
    if (
      (
        await this.db.query(
          "SELECT 1 FROM bans WHERE channel_id=$1 AND account_id=$2",
          [this.channel.id, who.id],
        )
      ).rows.length
    )
      throw new GameError("BANNED", "You cannot join this world.", 403);
    let avatar = this.state.avatars.find((a) => a.id === who.id);
    if (avatar) {
      avatar.name = who.privacy === "anonymous" ? "Rift traveler" : who.name;
      avatar.color = who.color;
      avatar.cosmetic = who.cosmetic;
      avatar.equipment = who.equipment;
    }
    if (!avatar) {
      if (this.state.avatars.length >= this.state.config.maxPlayers)
        throw new GameError("WORLD_FULL", "This world is at capacity.", 429);
      avatar = {
        id: who.id,
        name: who.privacy === "anonymous" ? "Rift traveler" : who.name,
        color: who.color,
        cosmetic: who.cosmetic,
        equipment: who.equipment,
        x: 0.17 + (this.state.avatars.length % 12) * 0.06,
        y: 0.78 + (Math.floor(this.state.avatars.length / 12) % 4) * 0.035,
        animation: "wave",
        message: "Hello, world!",
        target: null,
        lastActive: Date.now(),
      };
      this.state.avatars.push(avatar);
      this.event("avatar.spawned", avatar);
    }
    await this.db.query(
      "INSERT INTO avatar_presence(account_id,channel_id) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET channel_id=$2,updated_at=now()",
      [who.id, this.channel.id],
    );
    this.emit("joined", { actorId: who.id, roomId: this.channel.id });
    await this.db.transaction((tx) =>
      credit(
        tx,
        who.id,
        this.channel.id,
        20,
        `first-join:${who.reward_identity || who.id}`,
        "First verified join",
      ),
    );
    if (
      this.state.raid &&
      !this.state.raid.test &&
      Date.now() - this.state.raid.started < 120000
    )
      await this.db.query(
        "INSERT INTO raid_participants VALUES($1,$2) ON CONFLICT DO NOTHING",
        [this.state.raid.id, who.id],
      );
    return avatar;
  }
  async action(
    who: Record<string, any>,
    prompt: string,
    key: string,
    targetHint?: string,
  ) {
    if (this.state.config.paused)
      throw new GameError(
        "WORLD_PAUSED",
        "The creator has paused this world.",
        409,
      );
    const previous = (
      await this.db.query(
        "SELECT id,status FROM action_log WHERE account_id=$1 AND channel_id=$2 AND request_key=$3",
        [who.id, this.channel.id, key],
      )
    ).rows[0];
    if (previous) return previous;
    const now = Date.now();
    if (now - (this.cooldowns.get(who.id) || 0) < 500)
      throw new GameError("COOLDOWN", "Give your avatar a moment.", 429);
    this.cooldowns.set(who.id, now);
    const a = await this.join(who);
    const planningFence = this.planningFence,
      planningEpoch = this.state.epoch;
    const stillCurrent = () =>
      !this.state.config.paused &&
      this.state.avatars.includes(a) &&
      this.planningFence === planningFence &&
      this.state.epoch === planningEpoch &&
      this.cooldowns.get(who.id) === now;
    const tracks = targetHint
      ? this.state.tracks.filter((t) => t.id === targetHint)
      : this.state.tracks;
    let plan = localCompile(
      prompt,
      tracks,
      a.x,
      a.y,
      this.state.config.geometry,
    );
    if (!plan) {
      if (!this.state.config.ai)
        throw new GameError(
          "UNKNOWN_COMMAND",
          "Try dance, jump, summon a tiny dragon, or interact with a visible object.",
        );
      this.aiMinute = this.aiMinute.filter((t) => now - t < 60000);
      if (this.aiInFlight >= 2 || this.aiMinute.length >= 10)
        throw new GameError(
          "AI_BUDGET",
          "This world has reached its choreography budget.",
          429,
        );
      this.aiMinute.push(now);
      this.aiInFlight++;
      try {
        plan = await compileAI(prompt, tracks);
      } finally {
        this.aiInFlight--;
      }
    }
    const currentTracks = targetHint
      ? this.state.tracks.filter((t) => t.id === targetHint)
      : this.state.tracks;
    plan = validatePlan(plan, currentTracks);
    if (!stillCurrent())
      throw new GameError(
        "WORLD_CHANGED",
        "The world or your latest instruction changed while planning. Try again.",
        409,
      );
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO action_log(id,account_id,channel_id,request_key,status,plan) VALUES($1,$2,$3,$4,'running',$5)`,
      [id, who.id, this.channel.id, key, JSON.stringify(plan)],
    );
    if (!stillCurrent()) {
      await this.db.query(
        "UPDATE action_log SET status='cancelled' WHERE id=$1",
        [id],
      );
      throw new GameError(
        "WORLD_CHANGED",
        "The world or your latest instruction changed while planning. Try again.",
        409,
      );
    }
    const old = this.running.get(a.id);
    if (old) this.finish(old, "interrupted");
    a.target = null;
    const acceptedAt = Date.now();
    a.lastActive = acceptedAt;
    a.message = plan.message;
    const running = {
      id,
      actorId: a.id,
      plan,
      index: 0,
      started: acceptedAt,
      origin: [a.x, a.y] as [number, number],
    };
    this.running.set(a.id, running);
    this.event("action.accepted", { id, actorId: a.id, plan });
    this.startStep(running, a, plan.steps[0]);
    return { id, status: "running", message: plan.message };
  }
  startStep(r: Running, a: Avatar, s: ActionStep) {
    a.animationAt = r.started;
    a.animation =
      s.op === "navigate"
        ? s.name || "walk"
        : s.op === "jump_to_surface"
          ? "jump"
          : s.op === "play_animation"
            ? s.name || "idle"
            : s.op === "attach_to_track"
              ? s.name || "sit"
              : s.op;
    a.target = s.target;
    r.origin = [a.x, a.y];
    if (["spawn_catalog_asset", "build_voxel", "spawn_effect"].includes(s.op)) {
      const own = this.state.props.filter((p) => p.owner === a.id);
      if (own.length >= 2)
        this.state.props = this.state.props.filter((p) => p.id !== own[0].id);
      this.state.props.push({
        id: randomUUID(),
        owner: a.id,
        kind: s.name || "confetti",
        x: a.x,
        y: a.y,
        expires: Date.now() + 10000,
      });
    }
    this.event("action.step", {
      id: r.id,
      actorId: a.id,
      step: r.index,
      op: s.op,
      name: s.name,
      total: r.plan.steps.length,
    });
  }
  finish(r: Running, status: string) {
    this.running.delete(r.actorId);
    this.completedActions++;
    void this.db
      .query("UPDATE action_log SET status=$2 WHERE id=$1", [r.id, status])
      .catch((e) => this.emit("fault", e));
    this.event(`action.${status === "completed" ? "completed" : "failed"}`, {
      id: r.id,
      actorId: r.actorId,
      status,
    });
  }
  updateTracks(tracks: SceneTrack[], epoch: number) {
    if (!this.state.config.vision)
      throw new GameError("NO_CONSENT", "Enable camera processing first.", 403);
    if (epoch !== this.state.epoch)
      throw new GameError("STALE_SCENE", "Resynchronize the scene epoch.", 409);
    const now = Date.now();
    const observed = tracks.filter(
      (t) =>
        now - t.seenAt < TRACK_TTL_MS &&
        now - t.seenAt >= -200 &&
        (t.classifiedAt === undefined ||
          (now - t.classifiedAt < 2000 && now - t.classifiedAt >= -200)) &&
        t.confidence >= 0.5,
    );
    const [left, top, right, bottom] = this.state.config.geometry.crop;
    const current = observed.filter((t) => {
      const x = t.anchor?.[0] ?? t.box[0] + t.box[2] / 2,
        y = t.anchor?.[1] ?? t.box[1];
      return x >= left && x <= 1 - right && y >= top && y <= 1 - bottom;
    });
    const incoming = new Set(observed.map((t) => t.id));
    this.state.tracks = [
      ...current,
      ...this.state.tracks.filter(
        (t) =>
          !incoming.has(t.id) &&
          now - t.seenAt < TRACK_TTL_MS &&
          (t.classifiedAt === undefined || now - t.classifiedAt < 2000),
      ),
    ];
  }
  sceneReset() {
    this.planningFence++;
    this.state.epoch = Math.max(this.state.epoch + 1, Date.now());
    this.state.tracks = [];
    this.evidence.clear();
    for (const r of this.running.values()) this.finish(r, "scene_changed");
    for (const a of this.state.avatars) {
      a.target = null;
      a.animation = "idle";
      a.message = "Scene changed — waiting nearby.";
    }
    this.questSince.clear();
    this.event("world.snapshot", this.state);
  }
  stop() {
    this.planningFence++;
    this.state.config.paused = true;
    this.duels.tick(new Set(), true);
    this.running.forEach((r) => this.finish(r, "stopped"));
    this.state.props = [];
    this.state.raid = null;
    for (const a of this.state.avatars) {
      a.animation = "idle";
      a.target = null;
    }
    this.event("world.snapshot", this.state);
  }
  async raid(
    id: string,
    sourceId: string,
    from: string,
    count: number,
    test = false,
  ) {
    const row = await this.db.query(
      "INSERT INTO raids(id,source_id,destination_id,source_name,viewers,test) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
      [id, sourceId, this.channel.id, from, count, test],
    );
    if (!row.rows.length) return false;
    if (this.state.config.paused) return true;
    this.state.raid = { id, from, count, started: Date.now(), test };
    this.event("raid.started", this.state.raid);
    return true;
  }
  tick(now = Date.now(), dt = 0.05) {
    this.state.tick++;
    this.duels.tick(
      new Set(this.state.avatars.map((a) => a.id)),
      this.state.config.paused,
      now,
    );
    this.state.duels = this.duels.games;
    if (this.state.config.paused) return;
    this.state.tracks = this.state.tracks.filter(
      (t) =>
        now - t.seenAt < TRACK_TTL_MS &&
        (t.classifiedAt === undefined || now - t.classifiedAt < 2000),
    );
    this.state.props = this.state.props.filter((p) => p.expires > now);
    if (this.state.raid && now - this.state.raid.started > 18000)
      this.state.raid = null;
    for (const a of this.state.avatars) {
      const r = this.running.get(a.id);
      if (!r) {
        if (a.animation !== "idle" && now - a.lastActive > 15000) {
          a.animation = "idle";
          a.message = "";
        }
        continue;
      }
      const s = r.plan.steps[r.index];
      const target = s.target
        ? this.state.tracks.find((t) => t.id === s.target)
        : null;
      if (s.target && !target) {
        a.target = null;
        a.animation = "idle";
        a.message = "Target lost — I’ll wait nearby.";
        this.finish(r, "target_lost");
        continue;
      }
      let dest: [number, number] | null = null;
      if (target) {
        const [x, y, w] = target.box;
        dest = transformPoint(
          target.anchor?.[0] ?? x + w / 2,
          target.anchor?.[1] ?? y,
          this.state.config.geometry,
        ) as [number, number];
      } else if (s.x !== null && s.y !== null) dest = [s.x, s.y];
      if (dest) {
        const attach = ["attach_to_track", "follow_track"].includes(s.op);
        const speed = attach ? 4 : s.name === "sprint" ? 1 : 0.65;
        const dx = dest[0] - a.x,
          dy = dest[1] - a.y;
        const d = Math.hypot(dx, dy);
        const k = Math.min(1, (dt * speed) / Math.max(0.001, d));
        a.x += dx * k;
        a.y += dy * k;
      }
      if (now - r.started >= s.durationMs) {
        r.index++;
        if (r.index >= r.plan.steps.length) {
          a.target = null;
          a.animation = "idle";
          a.message = "";
          this.finish(r, "completed");
        } else {
          r.started = now;
          this.startStep(r, a, r.plan.steps[r.index]);
        }
      }
    }
    if (!this.busyQuest) {
      this.busyQuest = true;
      void this.evaluateQuests(now)
        .catch((e) => this.emit("fault", e))
        .finally(() => {
          this.busyQuest = false;
        });
    }
  }
  async evaluateQuests(now: number) {
    for (const q of this.state.quests) {
      if (q.completed) continue;
      const candidates = this.state.avatars.filter(
        (a) =>
          a.animation === q.action &&
          now - a.lastActive < 20000 &&
          (!q.targetClass ||
            this.state.tracks.some((t) => {
              if (t.id !== a.target || t.class !== q.targetClass) return false;
              const [x, y] = transformPoint(
                t.anchor?.[0] ?? t.box[0] + t.box[2] / 2,
                t.anchor?.[1] ?? t.box[1],
                this.state.config.geometry,
              );
              return Math.hypot(a.x - x, a.y - y) < 0.035;
            })),
      );
      const visual =
        q.type === "virtual" ||
        (this.evidence.get(q.id) || []).filter(
          (e) => now - e.at < 3000 && e.probability >= 0.95,
        ).length >= 2;
      let qualifying =
        q.type === "camera"
          ? this.state.avatars.filter((a) => now - a.lastActive < 20000)
          : candidates;
      if (q.targetClass && q.type !== "camera") {
        const groups = new Map<string, Avatar[]>();
        for (const a of candidates) {
          const key = a.target || "";
          const group = groups.get(key) || [];
          group.push(a);
          groups.set(key, group);
        }
        qualifying =
          [...groups.entries()].sort(
            (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
          )[0]?.[1] || [];
      }
      if (qualifying.length >= q.minPlayers && visual) {
        const signature = qualifying
          .map((a) => `${a.id}:${q.targetClass ? a.target : ""}`)
          .sort()
          .join(",");
        if (this.questGroups.get(q.id) !== signature) {
          this.questSince.set(q.id, now);
          this.questGroups.set(q.id, signature);
        }
        if (!this.questSince.has(q.id)) this.questSince.set(q.id, now);
        q.progress = Math.min(
          1,
          (now - this.questSince.get(q.id)!) / q.sustainMs,
        );
        if (q.progress >= 1) {
          await this.db.transaction(async (tx) => {
            for (const a of qualifying) {
              const added = await tx.query(
                "INSERT INTO quest_awards VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING account_id",
                [q.id, a.id],
              );
              if (added.rows.length)
                await credit(
                  tx,
                  a.id,
                  this.channel.id,
                  q.reward,
                  `quest:${q.id}:${a.id}`,
                  q.title,
                );
            }
            await tx.query("UPDATE quests SET active=false WHERE id=$1", [
              q.id,
            ]);
          });
          q.completed = true;
          this.event("quest.completed", {
            id: q.id,
            title: q.title,
            reward: q.reward,
            players: qualifying.map((a) => a.id),
          });
          this.event("leaderboard.changed", {});
        }
      } else {
        this.questSince.delete(q.id);
        this.questGroups.delete(q.id);
        q.progress = 0;
      }
    }
  }
  async save() {
    const state = {
      avatars: this.state.avatars
        .filter((a) => Date.now() - a.lastActive < 3600000)
        .map((a) => ({ ...a, target: null, message: "", animation: "idle" })),
    };
    await this.db.query(
      `INSERT INTO world_saves(channel_id,state) SELECT $1,jsonb_build_object('avatars',COALESCE(jsonb_agg(items.value||jsonb_build_object('name',CASE WHEN a.privacy='anonymous' THEN 'Rift traveler' ELSE a.name END,'color',a.color,'cosmetic',a.cosmetic,'equipment',a.equipment)),'[]'::jsonb)) FROM jsonb_array_elements(($2::jsonb)->'avatars') AS items(value) JOIN accounts a ON a.id=items.value->>'id' LEFT JOIN avatar_presence p ON p.account_id=a.id WHERE a.deleted=false AND (p.channel_id IS NULL OR p.channel_id=$1) ON CONFLICT(channel_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,
      [this.channel.id, JSON.stringify(state)],
    );
  }
  async refreshIdentities() {
    if (!this.state.avatars.length) return;
    const ids = this.state.avatars.map((a) => a.id);
    const canonical = (
      await this.db.query(
        "SELECT a.id,a.name,a.color,a.cosmetic,a.equipment,a.privacy FROM accounts a LEFT JOIN avatar_presence p ON p.account_id=a.id WHERE a.id=ANY($1::text[]) AND a.deleted=false AND (p.channel_id IS NULL OR p.channel_id=$2)",
        [ids, this.channel.id],
      )
    ).rows;
    const byId = new Map(canonical.map((a) => [a.id, a]));
    this.state.avatars = this.state.avatars
      .filter((a) => byId.has(a.id))
      .map((a) => {
        const current = byId.get(a.id)!;
        return {
          ...a,
          name:
            current.privacy === "anonymous" ? "Rift traveler" : current.name,
          color: current.color,
          cosmetic: current.cosmetic,
          equipment: current.equipment,
        };
      });
  }
}
