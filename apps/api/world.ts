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
  aiProvider,
  validatePlan,
  summarizePlan,
  type TargetResolver,
} from "./compiler.js";
/** One-word basics stay instant keyword actions even when the LLM planner is first. */
const BASIC_COMMAND =
  /^(?:!(?:rift|ourapp)\s+)?!?(join|jump|dance|wave|sit|cheer|stop|left|right|forward|back|backward|up|down|w|a|s|d)$/i;
/** "!rift go to there" / "!go to there" -> "go to there" for the model. */
const stripCommandPrefix = (text: string) =>
  text
    .trim()
    .replace(/^!(?:rift|ourapp)\s+/i, "")
    .replace(/^!/, "")
    .trim() || text;
import { mentions, targetNouns } from "./targets.js";
import { credit } from "./economy.js";
import type { Database } from "./db.js";
import { DuelArena } from "./duels.js";
import { TRACK_TTL_MS } from "../../packages/shared/tracker.js";
import {
  PORTAL_FOOT,
  arrivalPosition,
  makeArrival,
} from "../../packages/shared/arrivals.js";
type Running = {
  id: string;
  actorId: string;
  plan: ActionPlan;
  index: number;
  started: number;
  origin: [number, number];
};
export type DebugEntry = { at: number; kind: string; text: string };
const DEBUG_LOG_SIZE = 60;
/** Phone (ARCore) tracks stay anchored in 3D between detections; hold them this long after the last report. */
export const NATIVE_TRACK_HOLD_MS = 4000;
/** A fresh server detection survives this long without phone reports (the phone re-posts it once anchored). */
export const SERVER_TRACK_HOLD_MS = 10000;
/** Open-vocabulary detector scores are lower than the phone's COCO scores. */
const SERVER_MIN_CONFIDENCE = 0.2;
export class World extends EventEmitter {
  debugLog: DebugEntry[] = [];
  ai: { lastLatencyMs: number | null; lastError: string | null } = {
    lastLatencyMs: null,
    lastError: null,
  };
  trackHolds = new Map<string, number>();
  /** Server open-vocabulary detector on the latest phone frame (set by the server; absent in plain worlds). */
  findObjects?: TargetResolver;
  private serverTrackSeq = 0;
  /** Adds server detections as tracks "ov-<n>" (held like phone tracks until the phone re-posts them). */
  addServerTracks(
    found: {
      class: string;
      box: [number, number, number, number];
      confidence: number;
      frameId: string;
    }[],
    holdMs = SERVER_TRACK_HOLD_MS,
  ): SceneTrack[] {
    const now = Date.now();
    const added = found.map(
      (f): SceneTrack => ({
        id: `ov-${++this.serverTrackSeq}`,
        class: f.class.slice(0, 40),
        attributes: [],
        box: f.box,
        confidence: f.confidence,
        seenAt: now,
        source: "server",
        frameId: f.frameId,
      }),
    );
    for (const t of added) {
      this.state.tracks.push(t);
      this.trackHolds.set(t.id, now + holdMs);
    }
    if (added.length)
      this.log(
        "detect",
        `server found: ${added.map((t) => `${t.class} ${t.confidence.toFixed(2)} (${t.id})`).join(", ")}`,
      );
    return added;
  }
  private lastTrackLog = 0;
  private questCounts = new Map<string, number>();
  log(kind: string, text: string) {
    this.debugLog.push({ at: Date.now(), kind, text: text.slice(0, 300) });
    if (this.debugLog.length > DEBUG_LOG_SIZE)
      this.debugLog.splice(0, this.debugLog.length - DEBUG_LOG_SIZE);
  }
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
  private intents = new Map<string, number>();
  private steerTimes = new Map<string, number>();
  private steerSequence = 0;
  constructor(
    public db: Database,
    public channel: Record<string, any>,
    saved?: any,
  ) {
    super();
    this.state = {
      roomId: channel.id,
      mode:
        channel.demo === true || channel.id.startsWith("demo")
          ? "SIMULATOR"
          : channel.connected
            ? "LIVE TWITCH"
            : "OFFLINE",
      epoch: Date.now(),
      tick: 0,
      config: { ...defaultConfig, ...channel.config },
      avatars: (saved?.avatars || []).map((a: Avatar) => ({
        ...a,
        steer: null,
        arrival: undefined,
        spawnedAt: undefined,
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
  async join(who: Record<string, any>, entrance = false) {
    if (who.deleted) throw new GameError("DELETED", "Account is deleted", 403);
    if (entrance && this.state.config.paused)
      throw new GameError("WORLD_PAUSED", "This world is paused", 409);
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
      if (entrance && !avatar.arrival) {
        if (Date.now() - (avatar.spawnedAt || 0) < 500)
          throw new GameError(
            "ARRIVAL_COOLDOWN",
            "Give your character a moment before entering again.",
            429,
          );
        const running = this.running.get(avatar.id);
        if (running) this.finish(running, "interrupted");
        avatar.spawnedAt = Date.now();
        avatar.arrival = makeArrival(
          this.state.avatars.indexOf(avatar),
          avatar.spawnedAt,
        );
        [avatar.x, avatar.y] = [...PORTAL_FOOT];
        avatar.target = null;
        avatar.animation = "walk";
        avatar.animationAt = avatar.spawnedAt;
        avatar.lastActive = avatar.spawnedAt;
        avatar.message = "Stepping through the rift";
        this.event("avatar.arriving", avatar);
        this.log("join", `${avatar.name} stepped through the rift again`);
      }
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
        x: PORTAL_FOOT[0],
        y: PORTAL_FOOT[1],
        spawnedAt: Date.now(),
        arrival: makeArrival(this.state.avatars.length, Date.now()),
        animation: "walk",
        message: "Hello, world!",
        target: null,
        lastActive: Date.now(),
      };
      if (this.state.config.paused) {
        [avatar.x, avatar.y] = avatar.arrival!.to;
        delete avatar.arrival;
        delete avatar.spawnedAt;
        avatar.animation = "idle";
      }
      this.state.avatars.push(avatar);
      this.event("avatar.spawned", avatar);
      this.log(
        "join",
        `${avatar.name} joined (${this.state.avatars.length} in world)`,
      );
    }
    await this.db.query(
      "INSERT INTO avatar_presence(account_id,channel_id) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET channel_id=$2,updated_at=now()",
      [who.id, this.channel.id],
    );
    this.emit("joined", { actorId: who.id, roomId: this.channel.id });
    if (!who.twitch_id?.startsWith("ext:"))
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
  /** Shared controller/chat steering. No renderer can choose an actor or mint rewards. */
  cancelControl(actorId: string) {
    this.intents.set(actorId, (this.intents.get(actorId) || 0) + 1);
    const a = this.state.avatars.find((a) => a.id === actorId);
    if (a?.steer) {
      a.steer = null;
      a.animation = "idle";
      a.message = "";
    }
    const running = this.running.get(actorId);
    if (running) this.finish(running, "interrupted");
  }
  async steer(who: Record<string, any>, x: number, y: number, holdMs = 600) {
    if (![x, y].every((n) => Number.isFinite(n) && n >= -1 && n <= 1))
      throw new GameError(
        "INVALID_STEER",
        "Direction must be between -1 and 1",
        400,
      );
    if (this.state.config.paused)
      throw new GameError("WORLD_PAUSED", "This world is paused", 409);
    const now = Date.now();
    const last = this.steerTimes.get(who.id);
    if (last !== undefined && now >= last && now - last < 100)
      throw new GameError(
        "STEER_RATE",
        "Send at most ten steering updates per second",
        429,
      );
    this.steerTimes.set(who.id, now);
    const intent = (this.intents.get(who.id) || 0) + 1;
    this.intents.set(who.id, intent);
    const fence = this.planningFence;
    const a = await this.join(who);
    if (
      this.intents.get(who.id) !== intent ||
      this.state.config.paused ||
      fence !== this.planningFence
    )
      throw new GameError(
        "WORLD_CHANGED",
        "A newer instruction replaced this input",
        409,
      );
    const running = this.running.get(a.id);
    if (running) this.finish(running, "interrupted");
    delete a.arrival;
    a.target = null;
    a.lastActive = now;
    a.animation = x || y ? "walk" : "idle";
    a.message = x || y ? "Moving" : "";
    a.steer =
      x || y
        ? {
            x,
            y,
            seq: ++this.steerSequence,
            until: now + Math.min(1200, holdMs),
          }
        : null;
    this.event("avatar.state", a);
    return a;
  }
  async action(
    who: Record<string, any>,
    prompt: string,
    key: string,
    targetHint?: string,
  ): Promise<{
    id: string;
    status: string;
    message?: string;
    source?: "keywords" | "ai";
    summary?: string;
  }> {
    try {
      return (await this.runAction(who, prompt, key, targetHint)) as {
        id: string;
        status: string;
      };
    } catch (error) {
      if (error instanceof GameError)
        this.log("error", `${who.name}: ${error.code} — ${error.message}`);
      throw error;
    }
  }
  private async runAction(
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
    // A clock that stepped backwards (NTP correction, mocked test clock) must not lock a viewer out.
    const sinceLast = now - (this.cooldowns.get(who.id) || 0);
    if (sinceLast >= 0 && sinceLast < 500)
      throw new GameError("COOLDOWN", "Give your avatar a moment.", 429);
    this.cooldowns.set(who.id, now);
    const intent = (this.intents.get(who.id) || 0) + 1;
    this.intents.set(who.id, intent);
    const a = await this.join(who);
    if (this.intents.get(who.id) !== intent)
      throw new GameError(
        "WORLD_CHANGED",
        "A newer instruction replaced this action",
        409,
      );
    if (a.steer) {
      a.steer = null;
      a.animation = "idle";
      a.message = "Planning your next move";
    }
    const planningFence = this.planningFence,
      planningEpoch = this.state.epoch;
    const stillCurrent = () =>
      !this.state.config.paused &&
      this.state.avatars.includes(a) &&
      this.planningFence === planningFence &&
      this.state.epoch === planningEpoch &&
      this.cooldowns.get(who.id) === now &&
      this.intents.get(who.id) === intent;
    // Open vocabulary: objects the request names that no track shows yet are
    // looked up once by the server detector on the phone's latest frame.
    const tried = new Map<string, SceneTrack | null>();
    const resolve = async (nouns: string[]) => {
      const out: SceneTrack[] = [];
      const ask = nouns.filter((n) => !tried.has(n));
      if (ask.length && this.findObjects) {
        const found = await this.findObjects(ask).catch(() => []);
        for (const n of ask)
          tried.set(n, found.find((t) => t.class === n) || null);
      }
      for (const n of nouns) {
        const hit = tried.get(n);
        if (hit) out.push(hit);
      }
      return out;
    };
    if (!targetHint && this.findObjects) {
      const fresh = this.state.tracks.filter(
        (t) => Date.now() - t.seenAt < TRACK_TTL_MS,
      );
      const missing = targetNouns(prompt).filter(
        (n) => !fresh.some((t) => mentions(t.class, n)),
      );
      if (missing.length) await resolve(missing);
    }
    if (!stillCurrent())
      throw new GameError(
        "WORLD_CHANGED",
        "A newer instruction replaced this action while resolving targets",
        409,
      );
    const tracks = targetHint
      ? this.state.tracks.filter((t) => t.id === targetHint)
      : this.state.tracks;
    // LLM-first for free-form "!..." prompts (owner decision 2026-10-31): the small planner model reads
    // the request; the keyword compiler is the fallback when the model is offline, over budget or fails.
    // Single-word basics (!jump, !dance, a WASD step) stay instant keyword actions.
    const llmFirst =
      process.env.PLANNER_LLM_FIRST !== "false" &&
      !!aiProvider() &&
      this.state.config.ai &&
      !BASIC_COMMAND.test(prompt.trim());
    const keywordPlan = () =>
      localCompile(prompt, tracks, a.x, a.y, this.state.config.geometry);
    let plan = llmFirst ? null : keywordPlan();
    let source: "keywords" | "ai" = plan ? "keywords" : "ai";
    let latency: number | null = null;
    if (!plan) {
      if (!this.state.config.ai || !aiProvider())
        throw new GameError(
          "UNKNOWN_COMMAND",
          "Try dance, jump, summon a tiny dragon, or interact with a visible object.",
        );
      this.aiMinute = this.aiMinute.filter((t) => now - t < 60000);
      const overBudget = this.aiInFlight >= 2 || this.aiMinute.length >= 10;
      if (overBudget) {
        plan = llmFirst ? keywordPlan() : null;
        if (!plan)
          throw new GameError(
            "AI_BUDGET",
            "This world has reached its choreography budget.",
            429,
          );
        source = "keywords";
      } else {
        this.aiMinute.push(now);
        this.aiInFlight++;
        const started = Date.now();
        try {
          plan = await compileAI(
            stripCommandPrefix(prompt),
            tracks,
            fetch,
            targetHint ? undefined : resolve,
          );
          this.ai.lastError = null;
        } catch (error) {
          this.ai.lastError =
            error instanceof GameError
              ? `${error.code}: ${error.message}`
              : "AI_FAILED";
          // Target problems are real answers ("can't see a pillow"); only infrastructure
          // failures fall back to keywords.
          const targetError =
            error instanceof GameError &&
            /^TARGET_|STALE_TARGET/.test(error.code);
          const fallback = llmFirst && !targetError ? keywordPlan() : null;
          if (!fallback) throw error;
          plan = fallback;
          source = "keywords";
        } finally {
          this.aiInFlight--;
          latency = this.ai.lastLatencyMs = Date.now() - started;
        }
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
    delete a.arrival;
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
    const summary = summarizePlan(plan, currentTracks);
    this.log(
      "plan",
      `${a.name}: ${source}${latency === null ? "" : ` ${latency} ms`} — ${summary}`,
    );
    return { id, status: "running", message: plan.message, source, summary };
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
  updateTracks(
    tracks: SceneTrack[],
    epoch: number,
    holdMs = 0,
    phoneConfidence = 0.5,
  ) {
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
        t.confidence >=
          (t.source === "server" ? SERVER_MIN_CONFIDENCE : phoneConfidence),
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
    if (holdMs > 0)
      for (const t of current) this.trackHolds.set(t.id, now + holdMs);
    if (current.length && now - this.lastTrackLog >= 3000) {
      this.lastTrackLog = now;
      this.log(
        "tracks",
        `sees: ${current
          .slice(0, 6)
          .map((t) => `${t.class} ${t.confidence.toFixed(2)}`)
          .join(", ")}`,
      );
    }
  }
  /** Keep held (phone-anchored) tracks fresh until their hold lapses. */
  refreshHeldTracks(now = Date.now()) {
    for (const [id, until] of this.trackHolds) {
      const track = this.state.tracks.find((t) => t.id === id);
      if (until <= now || !track) {
        this.trackHolds.delete(id);
        continue;
      }
      track.seenAt = Math.max(track.seenAt, now);
    }
  }
  sceneReset() {
    this.planningFence++;
    this.state.epoch = Math.max(this.state.epoch + 1, Date.now());
    this.state.tracks = [];
    this.trackHolds.clear();
    this.evidence.clear();
    for (const r of this.running.values()) this.finish(r, "scene_changed");
    for (const a of this.state.avatars) {
      a.steer = null;
      delete a.arrival;
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
      a.steer = null;
      delete a.arrival;
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
    test ||= this.state.mode === "SIMULATOR";
    const row = await this.db.query(
      "INSERT INTO raids(id,source_id,destination_id,source_name,viewers,test) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
      [id, sourceId, this.channel.id, from, count, test],
    );
    if (!row.rows.length) {
      this.log("raid", `duplicate raid ${id} ignored`);
      return false;
    }
    if (this.state.config.paused) {
      this.log("raid", `raid from ${from} recorded; world paused`);
      return true;
    }
    this.state.raid = { id, from, count, started: Date.now(), test };
    this.event("raid.started", this.state.raid);
    this.log(
      "raid",
      `raid started: ${from} with ${count} viewers${test ? " (test)" : ""}`,
    );
    return true;
  }
  tick(now = Date.now(), dt = 0.05) {
    this.state.tick++;
    this.state.structures = this.state.structures?.filter(
      (s) => Date.parse(s.expiresAt) > now,
    );
    this.duels.tick(
      new Set(this.state.avatars.map((a) => a.id)),
      this.state.config.paused,
      now,
    );
    this.state.duels = this.duels.games;
    if (this.state.config.paused) return;
    this.refreshHeldTracks(now);
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
      if (a.steer) {
        // x/y positions use normalized image coordinates; up/away decreases image y.
        const elapsed = Math.max(
          0,
          Math.min(dt, (a.steer.until - (now - dt * 1000)) / 1000),
        );
        const magnitude = Math.max(1, Math.hypot(a.steer.x, a.steer.y));
        a.x = Math.max(
          0.02,
          Math.min(0.98, a.x + (a.steer.x / magnitude) * elapsed * 0.25),
        );
        a.y = Math.max(
          0.02,
          Math.min(0.98, a.y - (a.steer.y / magnitude) * elapsed * 0.25),
        );
        if (now >= a.steer.until) {
          a.steer = null;
          a.animation = "idle";
          a.message = "";
        }
        continue;
      }
      if (a.arrival && !r) {
        [a.x, a.y] = arrivalPosition(a.arrival, now);
        a.animation = "walk";
        if (now >= a.arrival.startedAt + a.arrival.durationMs) {
          delete a.arrival;
          a.animation = "wave";
          a.animationAt = now;
        }
        continue;
      }
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
        // Once the walk is over, stay glued to a moving target (camera pans move it).
        const attach =
          ["attach_to_track", "follow_track"].includes(s.op) ||
          (target !== null && s.op !== "navigate");
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
              if (t.id !== a.target || !mentions(t.class, q.targetClass!))
                return false;
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
      if (
        q.type !== "camera" &&
        this.questCounts.get(q.id) !== qualifying.length
      ) {
        if (qualifying.length || this.questCounts.has(q.id))
          this.log(
            "quest",
            `${q.title}: ${qualifying.length}/${q.minPlayers} players ${q.action}${q.targetClass ? ` on ${q.targetClass}` : ""}`,
          );
        this.questCounts.set(q.id, qualifying.length);
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
              const player = (
                await tx.query("SELECT twitch_id FROM accounts WHERE id=$1", [
                  a.id,
                ])
              ).rows[0];
              if (player?.twitch_id?.startsWith("ext:")) continue;
              // credit() is idempotent per logical key. A player at the daily
              // cap is skipped instead of rolling back everyone's award.
              try {
                await credit(
                  tx,
                  a.id,
                  this.channel.id,
                  q.reward,
                  `quest:${q.id}:${a.id}`,
                  q.title,
                );
              } catch (error) {
                if (
                  error instanceof GameError &&
                  error.code === "DAILY_REWARD_CAP"
                )
                  continue;
                throw error;
              }
              await tx.query(
                "INSERT INTO quest_awards VALUES($1,$2) ON CONFLICT DO NOTHING",
                [q.id, a.id],
              );
            }
            await tx.query("UPDATE quests SET active=false WHERE id=$1", [
              q.id,
            ]);
          });
          q.completed = true;
          this.log(
            "quest",
            `${q.title} completed — paid ${q.reward} Rift Shards each to ${qualifying.map((a) => a.name).join(", ")}`,
          );
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
        .map((a) => ({
          ...a,
          steer: null,
          arrival: undefined,
          spawnedAt: undefined,
          target: null,
          message: "",
          animation: "idle",
        })),
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
