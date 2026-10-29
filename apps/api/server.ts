import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { installWorldTransport } from "./transport.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { publicDocument } from "./ssr.js";
import { installConstruction, loadStructures } from "./construction.js";
import { profileCard } from "./cards.js";
import { equipmentSlots } from "../../packages/shared/equipment.js";
import { z } from "zod";
import { Database } from "./db.js";
import { Security, hash, secret, verifyWebhook } from "./security.js";
import { account, buy, equip, reverse } from "./economy.js";
import { World } from "./world.js";
import { Twitch } from "./twitch.js";
import { GameError } from "./compiler.js";
import { installApiContract } from "./openapi.js";
import { installMediaRelay } from "./media.js";
import { EvidenceInput, verifyEvidence } from "./vision.js";
import {
  Config,
  defaultConfig,
  Track,
  catalog,
  periodStart,
} from "../../packages/shared/contracts.js";
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    user?: Record<string, any>;
    session?: Record<string, any>;
  }
}
const body = <T>(schema: z.ZodType<T>, v: unknown) => schema.parse(v);
const idSchema = z.string().min(1).max(100);
export async function createApp(
  options: {
    db?: Database;
    security?: Security;
    timers?: boolean;
    fetcher?: typeof fetch;
    demo?: boolean;
    origin?: string;
    webRoot?: string;
  } = {},
) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.DATABASE_URL ||
      !process.env.PUBLIC_URL?.startsWith("https://"))
  )
    throw Error(
      "Production requires external DATABASE_URL and an owned HTTPS PUBLIC_URL",
    );
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.APP_SECRET ||
      process.env.APP_SECRET.length < 43 ||
      !process.env.REWARD_IDENTITY_SECRET ||
      process.env.REWARD_IDENTITY_SECRET.length < 43)
  )
    throw Error(
      "Production requires APP_SECRET and a stable REWARD_IDENTITY_SECRET, each at least 43 characters",
    );
  const db = options.db || (await Database.open(process.env.DATABASE_URL));
  await db.migrate();
  const security = options.security || (await Security.load());
  const demo =
    options.demo ??
    (process.env.DEMO_ENABLED !== "false" &&
      process.env.NODE_ENV !== "production");
  const origin =
    options.origin || process.env.PUBLIC_URL || "http://127.0.0.1:3400";
  const twitch = new Twitch(db, security, options.fetcher);
  const app = Fastify({
    routerOptions: { maxParamLength: 1100 },
    logger:
      process.env.NODE_ENV === "production"
        ? {
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "req.url",
            ],
          }
        : false,
    bodyLimit: 1100000,
  });
  const worlds = new Map<string, World>();
  const metrics = {
    webhooks: 0,
    duplicates: 0,
    failures: 0,
    sockets: 0,
    ticks: 0,
  };
  installApiContract(app, origin);
  await app.register(cookie);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, value, done) => {
      req.rawBody = value as string;
      try {
        done(null, JSON.parse(value as string));
      } catch (e) {
        done(e as Error);
      }
    },
  );
  app.setErrorHandler((error, req, reply) => {
    metrics.failures++;
    const e = error as any;
    const status =
      e instanceof z.ZodError ? 400 : e.status || e.statusCode || 500;
    reply.code(status).send({
      code: e instanceof z.ZodError ? "INVALID_REQUEST" : e.code || "INTERNAL",
      message:
        status >= 500 && !(e instanceof GameError)
          ? "The service could not complete this request"
          : e.message,
      requestId: req.id,
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store")
      .header("Permissions-Policy", "camera=(self), microphone=(self)")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'",
      );
    if (
      ["POST", "PATCH", "DELETE", "PUT"].includes(req.method) &&
      !req.url.startsWith("/v1/twitch/eventsub")
    ) {
      if (req.headers.origin !== origin)
        throw new GameError("BAD_ORIGIN", "Request origin is not allowed", 403);
    }
    const sid = req.cookies.rr_session;
    if (sid) {
      const result = await db.query(
        "SELECT s.*,a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.hash=$1 AND s.expires_at>now() AND a.deleted=false",
        [hash(sid)],
      );
      if (result.rows[0]) {
        req.session = result.rows[0];
        req.user = result.rows[0];
      }
    }
    if (
      ["POST", "PATCH", "DELETE", "PUT"].includes(req.method) &&
      req.user &&
      !["/v1/auth/logout", "/v1/demo/session"].includes(req.url) &&
      !req.url.startsWith("/v1/twitch/eventsub")
    ) {
      if (req.headers["x-csrf-token"] !== req.session?.csrf)
        throw new GameError(
          "CSRF",
          "Refresh the page before trying again",
          403,
        );
    }
  });
  const auth = (req: any) => {
    if (!req.user)
      throw new GameError(
        "UNAUTHENTICATED",
        "Connect with Twitch to continue",
        401,
      );
    return req.user as Record<string, any>;
  };
  const creator = async (req: any) => {
    const who = auth(req);
    const c = (
      await db.query("SELECT * FROM channels WHERE owner_id=$1", [who.id])
    ).rows[0];
    if (!c)
      throw new GameError(
        "CREATOR_REQUIRED",
        "Connect a creator account first",
        403,
      );
    return c;
  };
  const loadingWorlds = new Map<string, Promise<World>>();
  async function world(id: string): Promise<World> {
    const existing = worlds.get(id);
    if (existing) return existing;
    const pending = loadingWorlds.get(id);
    if (pending) return pending;
    const operation = loadWorld(id);
    loadingWorlds.set(id, operation);
    try {
      return await operation;
    } finally {
      if (loadingWorlds.get(id) === operation) loadingWorlds.delete(id);
    }
  }
  async function loadWorld(id: string) {
    let w = worlds.get(id);
    if (w) return w;
    const channel = (
      await db.query(
        "SELECT c.*,a.demo FROM channels c JOIN accounts a ON a.id=c.owner_id WHERE c.id=$1",
        [id],
      )
    ).rows[0];
    if (!channel)
      throw new GameError("WORLD_NOT_FOUND", "This world does not exist", 404);
    const saved = (
      await db.query("SELECT state FROM world_saves WHERE channel_id=$1", [id])
    ).rows[0];
    w = new World(db, channel, saved?.state);
    await w.loadQuests();
    w.state.structures = await loadStructures(db, id);
    await w.refreshIdentities();
    w.on("fault", () => {
      metrics.failures++;
    });
    w.on("joined", ({ actorId, roomId }) => {
      for (const [id, other] of worlds) {
        if (id === roomId) continue;
        const running = other.running.get(actorId);
        if (running) other.finish(running, "transferred");
        const existed = other.state.avatars.some((a) => a.id === actorId);
        other.state.avatars = other.state.avatars.filter(
          (a) => a.id !== actorId,
        );
        other.state.props = other.state.props.filter(
          (p) => p.owner !== actorId,
        );
        other.duels.cancelFor(actorId);
        if (existed) other.event("avatar.departed", { actorId });
      }
    });
    worlds.set(id, w);
    return w;
  }
  async function session(who: any, reply: any) {
    const value = secret(),
      csrf = secret();
    await db.query("INSERT INTO sessions VALUES($1,$2,$3,$4)", [
      hash(value),
      who.id,
      csrf,
      new Date(Date.now() + 7 * 86400000),
    ]);
    reply.setCookie("rr_session", value, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https:"),
      maxAge: 7 * 86400,
    });
    return csrf;
  }
  if (demo) {
    const host = await account(db, "demo-host", "Juniper", true);
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        "demo-world",
        host.id,
        JSON.stringify({
          ...defaultConfig,
          title: "Juniper’s pocket universe",
        }),
      ],
    );
    const qid = "demo-portal-party";
    await db.query(
      "INSERT INTO quests(id,channel_id,definition) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [
        qid,
        "demo-world",
        JSON.stringify({
          title: "A little rift celebration",
          type: "virtual",
          action: "dance",
          targetClass: null,
          minPlayers: 1,
          sustainMs: 2000,
          reward: 40,
        }),
      ],
    );
  }
  app.get("/v1/status", async () => ({
    mode: demo ? "LOCAL • SIMULATOR AVAILABLE" : "LIVE CONFIGURATION",
    twitch: twitch.ready
      ? "configured — live verification required"
      : "not configured",
    ai:
      process.env.OPENAI_API_KEY && process.env.ALLOW_PAID_AI === "true"
        ? "configured"
        : "offline",
    vision: "local capture available; camera rewards experimental",
    mobile: "native AR requires device validation",
    database: process.env.DATABASE_URL
      ? "PostgreSQL"
      : "PGlite (local PostgreSQL)",
    releaseReady: false,
  }));
  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { status: "ok", ...metrics, worlds: worlds.size };
  });
  app.get("/v1/me", async (req) => {
    if (!req.user) return { user: null };
    const who = req.user;
    return {
      user: {
        id: who.id,
        name: who.name,
        color: who.color,
        cosmetic: who.cosmetic,
        equipment: who.equipment,
        privacy: who.privacy,
        demo: who.demo,
      },
      csrf: req.session!.csrf,
      wallet:
        (
          await db.query("SELECT balance FROM wallets WHERE account_id=$1", [
            who.id,
          ])
        ).rows[0]?.balance || 0,
      earned: (
        await db.query(
          "SELECT COALESCE(sum(score_delta),0) AS earned FROM ledger WHERE account_id=$1",
          [who.id],
        )
      ).rows[0].earned,
      channel:
        (
          await db.query(
            "SELECT id,config,connected FROM channels WHERE owner_id=$1",
            [who.id],
          )
        ).rows[0] || null,
    };
  });
  app.post("/v1/demo/session", async (req, reply) => {
    if (!demo)
      throw new GameError("DEMO_DISABLED", "Simulator is disabled", 404);
    const { persona } = body(
      z
        .object({
          persona: z
            .enum(["traveler", "host", "second", "third"])
            .default("traveler"),
        })
        .strict(),
      req.body,
    );
    const names = {
      traveler: "Mossling",
      host: "Juniper",
      second: "Emberfox",
      third: "Luna",
    };
    const who = await account(
      db,
      persona === "host" ? "demo-host" : `demo-${persona}`,
      names[persona],
      true,
    );
    await session(who, reply);
    return { ok: true, mode: "SIMULATOR" };
  });
  app.post("/v1/me/unlink", async (req, reply) => {
    const who = auth(req);
    await twitch.unlink(who.id);
    for (const w of worlds.values())
      if (w.channel.owner_id === who.id) {
        w.stop();
        w.state.mode = "OFFLINE";
        w.state.config.vision = false;
        w.sceneReset();
      }
    reply.clearCookie("rr_session", { path: "/" });
    return {
      ok: true,
      retained: "Avatar identity and inventory remain available on relink",
    };
  });
  app.post("/v1/auth/logout", async (req, reply) => {
    if (req.cookies.rr_session)
      await db.query("DELETE FROM sessions WHERE hash=$1", [
        hash(req.cookies.rr_session),
      ]);
    reply.clearCookie("rr_session", { path: "/" });
    return { ok: true };
  });
  app.get("/auth/twitch", async (req, reply) => {
    if (!twitch.ready)
      throw new GameError(
        "TWITCH_NOT_CONFIGURED",
        "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to connect Twitch.",
        503,
      );
    const isCreator = (req.query as any).role === "creator";
    const state = secret(),
      browser = secret();
    await db.query("INSERT INTO oauth_states VALUES($1,$2,$3,$4)", [
      hash(state),
      hash(browser),
      isCreator,
      new Date(Date.now() + 600000),
    ]);
    reply.setCookie("rr_oauth", browser, {
      path: "/auth",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https:"),
      maxAge: 600,
    });
    const params = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID!,
      redirect_uri: `${origin}/auth/twitch/callback`,
      response_type: "code",
      scope: isCreator ? "user:read:chat user:bot channel:bot" : "",
      state,
    });
    return reply.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
  });
  app.get("/auth/twitch/callback", async (req, reply) => {
    const query = body(
      z
        .object({ code: z.string().max(1000), state: z.string().max(1000) })
        .passthrough(),
      req.query,
    );
    const result = await db.query(
      "DELETE FROM oauth_states WHERE hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *",
      [hash(query.state), hash(req.cookies.rr_oauth || "")],
    );
    if (!result.rows[0])
      throw new GameError(
        "OAUTH_STATE",
        "Authorization expired. Please connect again.",
        403,
      );
    reply.clearCookie("rr_oauth", { path: "/auth" });
    const tokens = await twitch.token({
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: `${origin}/auth/twitch/callback`,
    });
    const identity = await twitch.user(tokens.access_token);
    const who = await account(db, identity.user_id, identity.login);
    if (who.deleted)
      throw new GameError("DELETED", "This account has been deleted", 403);
    await db.query(
      "INSERT INTO twitch_connections(account_id,tokens) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET tokens=$2,validated_at=now()",
      [
        who.id,
        security.seal({
          ...tokens,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        }),
      ],
    );
    if (result.rows[0].creator) {
      await db.query(
        "INSERT INTO channels(id,owner_id,config,tokens,connected) VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO UPDATE SET tokens=$4,connected=true",
        [
          identity.user_id,
          who.id,
          JSON.stringify(defaultConfig),
          security.seal({
            ...tokens,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          }),
        ],
      );
    }
    await session(who, reply);
    return reply.redirect(
      result.rows[0].creator ? "/dashboard" : "/controller",
    );
  });
  app.get("/v1/live", async () => {
    const channels = (
      await db.query(
        "SELECT c.id,c.config,c.connected,a.name,a.demo FROM channels c JOIN accounts a ON a.id=c.owner_id WHERE a.deleted=false",
      )
    ).rows.filter((c) => c.config.public);
    return {
      worlds: channels.map((c) => ({
        id: c.id,
        title: c.config.title,
        creator: c.name,
        mode: c.demo
          ? "SIMULATOR"
          : c.connected
            ? "CONNECTED • LIVE STATUS UNVERIFIED"
            : "OFFLINE",
        players: worlds.get(c.id)?.state.avatars.length || 0,
        paused: c.config.paused,
      })),
    };
  });
  app.get("/v1/streamers/:id", async (req) => {
    const id = (req.params as any).id;
    const channel = (
      await db.query(
        "SELECT c.id,c.config,c.connected,a.name,a.demo FROM channels c JOIN accounts a ON a.id=c.owner_id WHERE c.id=$1 AND a.deleted=false",
        [id],
      )
    ).rows[0];
    if (!channel || !channel.config.public)
      throw new GameError(
        "NOT_FOUND",
        "This world is private or unavailable",
        404,
      );
    return {
      id: channel.id,
      title: channel.config.title,
      creator: channel.name,
      mode: channel.demo
        ? "SIMULATOR"
        : channel.connected
          ? "TWITCH CONNECTED · STREAM STATUS UNVERIFIED"
          : "OFFLINE",
      players: worlds.get(id)?.state.avatars.length || 0,
      communityEarned: (
        await db.query(
          "SELECT COALESCE(sum(score_delta),0) AS earned FROM ledger WHERE channel_id=$1",
          [id],
        )
      ).rows[0].earned,
      quests: (
        await db.query(
          "SELECT id,definition,active FROM quests WHERE channel_id=$1 ORDER BY created_at DESC LIMIT 20",
          [id],
        )
      ).rows,
      raids: (
        await db.query(
          "SELECT r.id,r.source_name,r.viewers,r.test,r.created_at,count(p.account_id)::int AS claimed FROM raids r LEFT JOIN raid_participants p ON p.raid_id=r.id WHERE r.destination_id=$1 GROUP BY r.id ORDER BY r.created_at DESC LIMIT 10",
          [id],
        )
      ).rows,
    };
  });
  app.get("/v1/worlds/:id", async (req) => {
    const w = await world((req.params as any).id);
    if (!w.state.config.public && req.user?.id !== w.channel.owner_id)
      throw new GameError("PRIVATE", "This world is private", 403);
    return w.state;
  });
  app.post("/v1/worlds/:id/join", async (req) => {
    const who = auth(req),
      data = body(
        z.object({ entrance: z.boolean().default(false) }).strict(),
        req.body || {},
      ),
      w = await world((req.params as any).id);
    if (!w.state.config.public && who.id !== w.channel.owner_id)
      throw new GameError("PRIVATE", "This world is private", 403);
    return w.join(who, data.entrance);
  });
  app.post("/v1/worlds/:id/actions", async (req) => {
    const who = auth(req),
      data = body(
        z
          .object({
            prompt: z.string().min(1).max(500),
            clientRequestId: idSchema,
            targetHint: z.string().max(80).optional(),
          })
          .strict(),
        req.body,
      ),
      w = await world((req.params as any).id);
    if (!w.state.config.public && who.id !== w.channel.owner_id)
      throw new GameError("PRIVATE", "This world is private", 403);
    return w.action(who, data.prompt, data.clientRequestId, data.targetHint);
  });
  app.get("/v1/leaderboard", async (req) => {
    const q = body(
      z
        .object({
          period: z.enum(["week", "month", "season", "all"]).default("week"),
          type: z.enum(["players", "streamers", "factions"]).default("players"),
          scope: z.enum(["global", "channel"]).default("global"),
          channelId: z.string().max(100).optional(),
          cursor: z.coerce.number().int().min(0).max(100000).default(0),
          search: z.string().max(50).default(""),
          season: z
            .string()
            .regex(/^\d{4}-Q[1-4]$/)
            .optional(),
        })
        .strict(),
      req.query,
    );
    const start = q.season
      ? new Date(
          `${q.season.slice(0, 4)}-${String((Number(q.season.at(-1)) - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00Z`,
        )
      : periodStart(q.period);
    const end = q.season
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1))
      : new Date("9999-01-01");
    const channel = q.scope === "channel" ? q.channelId || "" : null;
    const raw = (
      await db.query(
        `SELECT a.id, CASE WHEN a.privacy='anonymous' THEN 'Rift traveler' ELSE a.name END AS name,a.color,a.cosmetic,a.equipment,a.demo,COALESCE(sum(l.score_delta),0)::text AS score,max(l.score_at) AS first_at FROM accounts a JOIN ledger l ON a.id=l.account_id WHERE a.privacy<>'hidden' AND a.deleted=false AND l.score_at >= $1 AND l.score_at < $2 AND ($3::text IS NULL OR l.channel_id=$3) GROUP BY a.id HAVING sum(l.score_delta)>0 ORDER BY sum(l.score_delta) DESC,max(l.score_at),a.id`,
        [start, end, channel],
      )
    ).rows;
    let ranked: any[] = raw.map((p, i) => ({ ...p, rank: i + 1 }));
    if (q.type === "streamers") {
      ranked = (
        await db.query(
          `SELECT c.id,a.name,a.color,a.demo,COALESCE(sum(l.score_delta),0)::text AS score FROM channels c JOIN accounts a ON a.id=c.owner_id LEFT JOIN ledger l ON l.channel_id=c.id AND l.score_at >= $1 AND l.score_at < $2 WHERE c.config->>'public'='true' GROUP BY c.id,a.id ORDER BY sum(l.score_delta) DESC NULLS LAST,c.id`,
          [start, end],
        )
      ).rows.map((p, i) => ({ ...p, rank: i + 1 }));
    }
    if (q.type === "factions") {
      ranked = (
        await db.query(
          `SELECT f.id,f.name,f.color,COALESCE(sum(l.score_delta),0)::text AS score FROM factions f LEFT JOIN ledger l ON l.faction_id=f.id AND l.score_at >= $1 AND l.score_at < $2 GROUP BY f.id ORDER BY sum(l.score_delta) DESC NULLS LAST,f.id`,
          [start, end],
        )
      ).rows.map((p, i) => ({ ...p, rank: i + 1 }));
    }
    const matches = ranked.filter((p) =>
      p.name.toLowerCase().includes(q.search.toLowerCase()),
    );
    return {
      rows: matches.slice(q.cursor, q.cursor + 50),
      myRank: req.user
        ? ranked.find((p) => p.id === req.user!.id) || null
        : null,
      nextCursor: matches.length > q.cursor + 50 ? q.cursor + 50 : null,
      updatedAt: new Date().toISOString(),
      period: q.period,
      semantics:
        "Verified earnings; spending does not reduce score. Week begins Monday 00:00 UTC.",
      mode: demo ? "Includes clearly marked simulator accounts" : "LIVE",
    };
  });
  app.get("/v1/seasons", async () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    return {
      seasons: [0, 1, 2, 3].map((i) => ({
        id: `${year}-Q${i + 1}`,
        start: new Date(Date.UTC(year, i * 3, 1)),
        end: new Date(Date.UTC(year, i * 3 + 3, 1)),
      })),
    };
  });
  app.post("/v1/me/share-card", async (req) => {
    const who = auth(req);
    body(z.object({ consent: z.literal(true) }).strict(), req.body);
    if (who.privacy !== "public")
      throw new GameError(
        "PROFILE_PRIVATE",
        "Make your profile public before creating a share card.",
        409,
      );
    const exp = Date.now() + 86400000;
    const token = security.sign({
      role: "share-card",
      account: who.id,
      version: who.share_version,
      exp,
    });
    return {
      url: `${origin}/v1/cards/${token}.svg`,
      expiresAt: new Date(exp).toISOString(),
    };
  });
  app.delete("/v1/me/share-card", async (req) => {
    const who = auth(req);
    await db.query(
      "UPDATE accounts SET share_version=share_version+1 WHERE id=$1",
      [who.id],
    );
    return { ok: true };
  });
  app.get("/v1/cards/:token", async (req, reply) => {
    const token = String((req.params as any).token).replace(/\.svg$/, "");
    if (token.length > 1000)
      throw new GameError("BAD_TOKEN", "Invalid card link.", 401);
    const p = security.verify(token);
    if (p.role !== "share-card")
      throw new GameError("BAD_TOKEN", "Invalid card link.", 401);
    const player = (
      await db.query(
        "SELECT id,name,color,cosmetic,equipment,demo FROM accounts WHERE id=$1 AND share_version=$2 AND privacy='public' AND deleted=false",
        [p.account, p.version],
      )
    ).rows[0];
    if (!player)
      throw new GameError(
        "NOT_FOUND",
        "This share card has been revoked or is private.",
        404,
      );
    const earned = (
      await db.query(
        "SELECT COALESCE(sum(score_delta),0)::text AS earned FROM ledger WHERE account_id=$1",
        [player.id],
      )
    ).rows[0].earned;
    const quests = Number(
      (
        await db.query(
          "SELECT count(*) FROM quest_awards WHERE account_id=$1",
          [player.id],
        )
      ).rows[0].count,
    );
    return reply
      .type("image/svg+xml")
      .header("Content-Disposition", 'inline; filename="raidrift-traveler.svg"')
      .send(profileCard(player as any, earned, quests));
  });
  app.get("/v1/players/:id", async (req) => {
    const id = (req.params as any).id;
    const player = (
      await db.query(
        `SELECT id,name,color,cosmetic,equipment,privacy,demo FROM accounts WHERE id=$1 AND deleted=false`,
        [id],
      )
    ).rows[0];
    if (!player || player.privacy === "hidden")
      throw new GameError(
        "NOT_FOUND",
        "Player profile is private or unavailable",
        404,
      );
    if (player.privacy === "anonymous") player.name = "Rift traveler";
    return {
      player,
      earned: (
        await db.query(
          "SELECT COALESCE(sum(score_delta),0) AS earned FROM ledger WHERE account_id=$1",
          [id],
        )
      ).rows[0].earned,
      quests: (
        await db.query(
          "SELECT q.definition,q.created_at FROM quest_awards qa JOIN quests q ON q.id=qa.quest_id WHERE qa.account_id=$1",
          [id],
        )
      ).rows,
      inventory: (
        await db.query("SELECT item_id FROM inventory WHERE account_id=$1", [
          id,
        ])
      ).rows,
    };
  });
  app.get("/v1/me/inventory", async (req) => ({
    items: (
      await db.query("SELECT item_id FROM inventory WHERE account_id=$1", [
        auth(req).id,
      ])
    ).rows,
    catalog,
  }));
  app.get("/v1/me/ledger", async (req) => ({
    entries: (
      await db.query(
        "SELECT * FROM ledger WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [auth(req).id],
      )
    ).rows,
  }));
  app.get("/v1/me/actions", async (req) => ({
    actions: (
      await db.query(
        "SELECT id,status,plan,created_at FROM action_log WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20",
        [auth(req).id],
      )
    ).rows,
  }));
  app.patch("/v1/me/profile", async (req) => {
    const data = body(
      z
        .object({
          privacy: z.enum(["public", "hidden", "anonymous"]).optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
        })
        .strict(),
      req.body,
    );
    const who = auth(req);
    await db.query(
      "UPDATE accounts SET privacy=COALESCE($2,privacy),color=COALESCE($3,color),share_version=share_version+CASE WHEN $2 IS NOT NULL AND privacy<>$2 THEN 1 ELSE 0 END WHERE id=$1",
      [who.id, data.privacy || null, data.color || null],
    );
    for (const w of worlds.values()) {
      const a = w.state.avatars.find((a) => a.id === who.id);
      if (a) {
        if (data.color) a.color = data.color;
        if (data.privacy)
          a.name = data.privacy === "anonymous" ? "Rift traveler" : who.name;
      }
    }
    return { ok: true };
  });
  app.post("/v1/me/opt-out", async (req) => {
    const who = auth(req);
    await db.query(
      `UPDATE accounts SET privacy='hidden',share_version=share_version+1 WHERE id=$1`,
      [who.id],
    );
    return { ok: true };
  });
  app.delete("/v1/me", async (req) => {
    const who = auth(req);
    await twitch.unlink(who.id);
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE accounts SET name='Deleted traveler',twitch_id='deleted:'||id,privacy='hidden',deleted=true WHERE id=$1`,
        [who.id],
      );
      await tx.query("DELETE FROM sessions WHERE account_id=$1", [who.id]);
      await tx.query("SELECT id FROM channels WHERE owner_id=$1 FOR UPDATE", [
        who.id,
      ]);
      await tx.query(
        "DELETE FROM structures WHERE owner_id=$1 OR channel_id IN (SELECT id FROM channels WHERE owner_id=$1)",
        [who.id],
      );
      await tx.query(
        "UPDATE structures SET blocks=(SELECT COALESCE(jsonb_agg(CASE WHEN b->>'ownerId'=$1 THEN b||jsonb_build_object('ownerId',NULL) ELSE b END),'[]'::jsonb) FROM jsonb_array_elements(blocks) b),revision=revision+1 WHERE blocks::text LIKE '%'||$1||'%'",
        [who.id],
      );
      await tx.query("DELETE FROM construction_receipts WHERE account_id=$1", [
        who.id,
      ]);
      await tx.query(
        "UPDATE world_saves SET state=jsonb_set(state,'{avatars}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(state->'avatars') v WHERE v->>'id'<>$1),'[]'::jsonb))",
        [who.id],
      );
      await tx.query(
        "UPDATE channels SET tokens=null,connected=false,token_version=token_version+1,config=jsonb_set(jsonb_set(jsonb_set(config,'{public}','false'::jsonb),'{vision}','false'::jsonb),'{paused}','true'::jsonb) WHERE owner_id=$1",
        [who.id],
      );
    });
    for (const w of worlds.values()) {
      w.state.avatars = w.state.avatars.filter((a) => a.id !== who.id);
      w.duels.cancelFor(who.id);
      w.state.structures = await loadStructures(db, w.channel.id);
      if (w.channel.owner_id === who.id) {
        w.stop();
        w.state.config.vision = false;
        w.state.config.public = false;
        w.sceneReset();
      }
    }
    return {
      ok: true,
      retained:
        "Pseudonymous immutable accounting records retained for reconciliation",
    };
  });
  app.get("/v1/shop", async () => ({ catalog }));
  app.post("/v1/shop/orders", async (req) => {
    const d = body(
      z.object({ itemId: idSchema, idempotencyKey: idSchema }).strict(),
      req.body,
    );
    return buy(db, auth(req).id, d.itemId, d.idempotencyKey);
  });
  const syncEquipment = (who: Record<string, any>) => {
    for (const w of worlds.values()) {
      const avatar = w.state.avatars.find((a) => a.id === who.id);
      if (avatar) {
        avatar.equipment = who.equipment;
        avatar.cosmetic = who.cosmetic;
        avatar.color = who.color;
      }
    }
    return { ok: true, equipment: who.equipment };
  };
  app.post("/v1/me/cosmetics/:id/equip", async (req) => {
    const id = (req.params as any).id;
    const item = catalog.find((item) => item.id === id);
    if (!item) throw new GameError("UNKNOWN_COSMETIC", "Unknown cosmetic", 404);
    return syncEquipment(
      await equip(
        db,
        auth(req).id,
        item.slot as (typeof equipmentSlots)[number],
        id,
      ),
    );
  });
  app.delete("/v1/me/equipment/:slot", async (req) => {
    const slot = z.enum(equipmentSlots).parse((req.params as any).slot);
    return syncEquipment(await equip(db, auth(req).id, slot, null));
  });
  installConstruction(app, db, auth, world);
  app.get("/v1/quests", async (req) => {
    const channelId = (req.query as any).channelId;
    return {
      quests: (
        await db.query(
          "SELECT q.id,q.channel_id,q.definition,q.active FROM quests q JOIN channels c ON c.id=q.channel_id WHERE c.config->>'public'='true' AND ($1::text IS NULL OR q.channel_id=$1) ORDER BY q.created_at DESC LIMIT 100",
          [channelId || null],
        )
      ).rows,
    };
  });
  app.get("/v1/raids", async () => ({
    raids: (
      await db.query(
        `SELECT r.*,count(p.account_id)::int AS claimed FROM raids r LEFT JOIN raid_participants p ON p.raid_id=r.id JOIN channels c ON c.id=r.destination_id WHERE c.config->>'public'='true' GROUP BY r.id ORDER BY r.created_at DESC LIMIT 30`,
      )
    ).rows,
  }));
  app.get("/v1/factions", async (req) => ({
    factions: (
      await db.query(
        `SELECT f.*,(SELECT count(*)::int FROM faction_members m JOIN accounts a ON a.id=m.account_id WHERE m.faction_id=f.id AND a.deleted=false AND a.privacy='public') AS public_members,(SELECT COALESCE(sum(score_delta),0)::text FROM ledger WHERE faction_id=f.id) AS earned FROM factions f ORDER BY f.name`,
      )
    ).rows,
    mine: req.user
      ? (
          await db.query(
            "SELECT faction_id FROM faction_members WHERE account_id=$1",
            [req.user.id],
          )
        ).rows[0]?.faction_id || null
      : null,
  }));
  app.delete("/v1/me/faction", async (req) => {
    await db.query("DELETE FROM faction_members WHERE account_id=$1", [
      auth(req).id,
    ]);
    return { ok: true };
  });
  app.post("/v1/factions/:id/join", async (req) => {
    const who = auth(req),
      id = (req.params as any).id;
    if (
      !(await db.query("SELECT 1 FROM factions WHERE id=$1", [id])).rows.length
    )
      throw new GameError("NOT_FOUND", "Faction not found", 404);
    await db.query(
      "INSERT INTO faction_members VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET faction_id=$2",
      [who.id, id],
    );
    return { ok: true };
  });
  app.get("/v1/creator/config", async (req) => {
    const c = await creator(req);
    return { channelId: c.id, config: c.config, connected: c.connected };
  });
  app.patch("/v1/creator/config", async (req) => {
    const c = await creator(req),
      config = body(Config, req.body);
    await db.query("UPDATE channels SET config=$2 WHERE id=$1", [
      c.id,
      JSON.stringify(config),
    ]);
    const w = await world(c.id);
    const visionChanged = w.state.config.vision !== config.vision;
    const geometryChanged =
      JSON.stringify(w.state.config.geometry) !==
      JSON.stringify(config.geometry);
    w.state.config = config;
    if (visionChanged || geometryChanged) w.sceneReset();
    if (config.paused) w.stop();
    return { ok: true };
  });
  app.post("/v1/creator/overlay-token/rotate", async (req) => {
    const c = await creator(req);
    const updated = (
      await db.query(
        "UPDATE channels SET token_version=token_version+1 WHERE id=$1 RETURNING token_version",
        [c.id],
      )
    ).rows[0];
    const token = security.sign({
      room: c.id,
      role: "overlay",
      version: updated.token_version,
      exp: Date.now() + 86400000,
    });
    return {
      url: `${origin}/overlay?room=${encodeURIComponent(c.id)}#token=${token}`,
      expiresAt: new Date(Date.now() + 86400000),
    };
  });
  app.post("/v1/creator/test-raid", async (req) => {
    const c = await creator(req),
      d = body(
        z.object({ count: z.number().int().min(1).max(10000) }).strict(),
        req.body,
      );
    const w = await world(c.id);
    if (w.state.config.paused)
      throw new GameError(
        "WORLD_PAUSED",
        "Resume the world before previewing an entrance.",
        409,
      );
    const created = await w.raid(
      `test-${randomUUID()}`,
      "test",
      "Test travelers",
      d.count,
      true,
    );
    // Preview the authenticated creator's own character, never invent named raiders from a viewer count.
    if (
      w.state.avatars.some((a) => a.id === auth(req).id) ||
      w.state.avatars.length < w.state.config.maxPlayers
    )
      await w.join(auth(req));
    return { created };
  });
  app.post("/v1/creator/emergency-stop", async (req) => {
    const c = await creator(req),
      w = await world(c.id);
    w.stop();
    w.state.config.vision = false;
    w.sceneReset();
    await db.query("UPDATE channels SET config=$2 WHERE id=$1", [
      c.id,
      JSON.stringify(w.state.config),
    ]);
    return { ok: true };
  });
  app.post("/v1/creator/vision/scene", async (req) => {
    const c = await creator(req),
      w = await world(c.id);
    w.sceneReset();
    return { epoch: w.state.epoch };
  });
  app.post("/v1/creator/vision/tracks", async (req) => {
    const c = await creator(req),
      data = body(
        z
          .object({ epoch: z.number(), tracks: z.array(Track).max(100) })
          .strict(),
        req.body,
      );
    (await world(c.id)).updateTracks(data.tracks, data.epoch);
    return { ok: true };
  });
  app.post("/v1/creator/vision/evidence", async (req) => {
    const c = await creator(req);
    if (process.env.EXPERIMENTAL_CAMERA_REWARDS !== "true")
      throw new GameError(
        "UNCALIBRATED",
        "Camera rewards are disabled until verifier calibration and source attestation are validated",
        409,
      );
    return verifyEvidence(
      await world(c.id),
      body(EvidenceInput, req.body),
      options.fetcher,
    );
  });
  app.delete("/v1/creator/vision/data", async (req) => {
    const c = await creator(req),
      w = await world(c.id);
    w.state.config.vision = false;
    w.sceneReset();
    await db.query("UPDATE channels SET config=$2 WHERE id=$1", [
      c.id,
      JSON.stringify(w.state.config),
    ]);
    return { ok: true, framesRetained: 0 };
  });
  app.post("/v1/creator/quests", async (req) => {
    const c = await creator(req);
    const data = body(
      z
        .object({
          title: z.string().min(1).max(80),
          type: z.enum(["virtual", "camera", "hybrid"]),
          action: z.enum(["dance", "sit", "wave", "cheer", "build_voxel"]),
          targetClass: z.enum(["dog", "bench", "bicycle", "red"]).nullable(),
          minPlayers: z.number().int().min(1).max(20),
          sustainMs: z.number().int().min(1000).max(7000),
          reward: z.number().int().min(1).max(100),
        })
        .strict(),
      req.body,
    );
    const count = (
      await db.query(
        "SELECT count(*)::int AS n FROM quests WHERE channel_id=$1 AND created_at>now()-interval '1 day'",
        [c.id],
      )
    ).rows[0].n;
    if (count >= 5)
      throw new GameError(
        "QUEST_CAP",
        "Five new quests per day are allowed",
        429,
      );
    if (data.type === "virtual" && data.targetClass)
      throw new GameError(
        "HYBRID_REQUIRED",
        "Camera targets require hybrid verification",
      );
    const id = randomUUID();
    await db.query(
      "INSERT INTO quests(id,channel_id,definition) VALUES($1,$2,$3)",
      [id, c.id, JSON.stringify(data)],
    );
    await (await world(c.id)).loadQuests();
    return { id };
  });
  app.post("/v1/creator/moderation/ban", async (req) => {
    const c = await creator(req),
      d = body(
        z.object({ accountId: idSchema, reason: z.string().max(200) }).strict(),
        req.body,
      );
    await db.query("INSERT INTO bans VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
      c.id,
      d.accountId,
      d.reason,
    ]);
    const w = await world(c.id);
    const r = w.running.get(d.accountId);
    if (r) w.finish(r, "banned");
    w.state.avatars = w.state.avatars.filter((a) => a.id !== d.accountId);
    w.duels.cancelFor(d.accountId);
    await db.query("INSERT INTO audit VALUES($1,$2,$3,$4,now())", [
      randomUUID(),
      c.owner_id,
      "ban",
      JSON.stringify(d),
    ]);
    return { ok: true };
  });
  app.get("/v1/creator/health", async (req) => {
    const c = await creator(req),
      w = await world(c.id);
    return {
      ...metrics,
      players: w.state.avatars.length,
      tracks: w.state.tracks.length,
      aiRequestsThisMinute: w.aiMinute.filter((t) => Date.now() - t < 60000)
        .length,
      connected: c.connected,
      vision: w.state.config.vision,
    };
  });
  app.post("/v1/creator/subscriptions/reconcile", async (req) => {
    const c = await creator(req);
    return {
      subscriptions: await twitch.reconcile(c, `${origin}/v1/twitch/eventsub`),
    };
  });
  app.post("/v1/creator/disconnect", async (req) => {
    const c = await creator(req);
    await twitch.disconnect(c);
    const w = await world(c.id);
    w.stop();
    w.state.mode = "OFFLINE";
    w.state.config.vision = false;
    w.sceneReset();
    return { ok: true };
  });
  app.post("/v1/parties/invite", async (req) => {
    const who = auth(req),
      d = body(
        z
          .object({
            channelId: idSchema,
            inviteeId: idSchema,
            kind: z.enum(["dance", "wave", "duel"]),
          })
          .strict(),
        req.body,
      );
    const w = await world(d.channelId);
    if (d.inviteeId === who.id)
      throw new GameError("SELF_INVITE", "Choose another traveler.");
    if (w.state.config.paused)
      throw new GameError(
        "WORLD_PAUSED",
        "The creator has paused this world.",
        409,
      );
    if (
      !w.state.avatars.some((a) => a.id === who.id) ||
      !w.state.avatars.some((a) => a.id === d.inviteeId)
    )
      throw new GameError("NOT_IN_WORLD", "Both players must join this world");
    const id = randomUUID();
    const inserted = await db.query(
      "INSERT INTO invitations SELECT $1,$2,$3,$4,$5,false,$6 WHERE (SELECT count(*) FROM invitations WHERE inviter_id=$3 AND expires_at>now())<5 RETURNING id",
      [
        id,
        d.channelId,
        who.id,
        d.inviteeId,
        d.kind,
        new Date(Date.now() + 60000),
      ],
    );
    if (!inserted.rows.length)
      throw new GameError(
        "INVITE_LIMIT",
        "Wait for your pending invitations to expire.",
        429,
      );
    w.event("party.invitation", {
      id,
      from: who.id,
      to: d.inviteeId,
      kind: d.kind,
    });
    return { id };
  });
  app.get("/v1/parties/invitations", async (req) => ({
    invitations: (
      await db.query(
        "SELECT * FROM invitations WHERE invitee_id=$1 AND accepted=false AND expires_at>now()",
        [auth(req).id],
      )
    ).rows,
  }));
  app.post("/v1/parties/:id/accept", async (req) => {
    const who = auth(req),
      id = (req.params as any).id;
    const invite = (
      await db.query(
        "SELECT * FROM invitations WHERE id=$1 AND invitee_id=$2 AND accepted=false AND expires_at>now()",
        [id, who.id],
      )
    ).rows[0];
    if (!invite)
      throw new GameError(
        "INVITE_EXPIRED",
        "Invitation expired or already accepted",
      );
    const w = await world(invite.channel_id);
    if (w.state.config.paused)
      throw new GameError(
        "WORLD_PAUSED",
        "The creator has paused this world.",
        409,
      );
    if (
      ![invite.inviter_id, who.id].every((id) =>
        w.state.avatars.some((a) => a.id === id),
      )
    )
      throw new GameError(
        "NOT_IN_WORLD",
        "Both players must still be in this world.",
        409,
      );
    const claimed = await db.query(
      "UPDATE invitations SET accepted=true WHERE id=$1 AND accepted=false RETURNING id",
      [id],
    );
    if (!claimed.rows.length)
      throw new GameError(
        "INVITE_EXPIRED",
        "Invitation already accepted.",
        409,
      );
    try {
      if (invite.kind === "duel") {
        if (
          w.state.config.paused ||
          ![invite.inviter_id, who.id].every((id) =>
            w.state.avatars.some((a) => a.id === id),
          )
        )
          throw new GameError(
            "NOT_IN_WORLD",
            "The world or players changed. Try again.",
            409,
          );
        const duel = w.duels.start(id, [invite.inviter_id, who.id]);
        const lane = w.duels.games
          .filter((d) => d.status === "active")
          .findIndex((d) => d.id === id);
        duel.players.forEach((player, index) => {
          const avatar = w.state.avatars.find((a) => a.id === player)!;
          const running = w.running.get(player);
          if (running) w.finish(running, "interrupted");
          avatar.x = 0.1 + lane * 0.23 + index * 0.1;
          avatar.y = 0.78;
          avatar.target = null;
          avatar.animation = "stand";
          avatar.animationAt = Date.now();
          avatar.message = "A friendly wizard duel!";
        });
        w.state.duels = w.duels.games;
        return { ok: true, duel };
      }
      await w.action(who, invite.kind, `invite:${id}`);
      const inviter = (
        await db.query("SELECT * FROM accounts WHERE id=$1", [
          invite.inviter_id,
        ])
      ).rows[0];
      if (inviter && !inviter.deleted)
        await w.action(inviter, invite.kind, `inviter:${id}`);
      return { ok: true };
    } catch (error) {
      await db.query("UPDATE invitations SET accepted=false WHERE id=$1", [id]);
      throw error;
    }
  });
  app.post("/v1/worlds/:channelId/duels/:id/moves", async (req) => {
    const who = auth(req),
      params = req.params as { channelId: string; id: string };
    const d = body(
      z
        .object({
          move: z.enum(["cast", "shield", "charge", "leave"]),
          revision: z.number().int().min(0).max(100),
          clientRequestId: z.string().min(1).max(100),
        })
        .strict(),
      req.body,
    );
    const w = await world(params.channelId);
    if (w.state.config.paused)
      throw new GameError(
        "WORLD_PAUSED",
        "The creator has paused this world.",
        409,
      );
    w.duels.tick(new Set(w.state.avatars.map((a) => a.id)), false);
    const duel = w.duels.move(
      params.id,
      who.id,
      d.move,
      d.revision,
      d.clientRequestId,
    );
    w.state.duels = w.duels.games;
    const avatar = w.state.avatars.find((a) => a.id === who.id);
    if (avatar && d.move !== "leave") {
      const running = w.running.get(who.id);
      if (running) w.finish(running, "interrupted");
      avatar.target = null;
      avatar.animation =
        d.move === "cast" ? "cast" : d.move === "charge" ? "cheer" : "salute";
      avatar.animationAt = Date.now();
      avatar.lastActive = Date.now();
      avatar.message = duel.message;
    }
    return { duel };
  });
  const admin = (req: any) => {
    const who = auth(req);
    if (
      !(process.env.ADMIN_TWITCH_IDS || "").split(",").includes(who.twitch_id)
    )
      throw new GameError("ADMIN_REQUIRED", "Operator access required", 403);
    return who;
  };
  app.get("/v1/admin/audit", async (req) => {
    admin(req);
    return {
      audit: (
        await db.query("SELECT * FROM audit ORDER BY created_at DESC LIMIT 100")
      ).rows,
      metrics,
    };
  });
  app.post("/v1/admin/reverse", async (req) => {
    const who = admin(req),
      d = body(
        z
          .object({
            transactionId: idSchema,
            reason: z.string().min(5).max(200),
          })
          .strict(),
        req.body,
      );
    return reverse(db, who.id, d.transactionId, d.reason);
  });
  app.post("/v1/twitch/eventsub", async (req, reply) => {
    const id = verifyWebhook(
      req.headers,
      req.rawBody || "",
      process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET || "",
    );
    const p = req.body as any;
    const type = req.headers["twitch-eventsub-message-type"];
    if (type === "webhook_callback_verification") {
      if (typeof p.challenge !== "string")
        throw new GameError("INVALID_CHALLENGE", "Invalid challenge");
      return reply.type("text/plain").send(p.challenge);
    }
    const subscriptionType = p.subscription?.type;
    if (
      ![
        "channel.raid",
        "channel.chat.message",
        "user.authorization.revoke",
      ].includes(subscriptionType)
    )
      return reply.code(204).send();
    const inserted = await db.query(
      "INSERT INTO inbox(id,type,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
      [
        id,
        type === "revocation" ? "revocation" : subscriptionType,
        JSON.stringify(p),
      ],
    );
    metrics.webhooks++;
    if (!inserted.rows.length) metrics.duplicates++;
    return reply.code(204).send();
  });
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      const pending = (
        await db.query(
          `SELECT * FROM inbox WHERE status='pending' AND attempts<5 ORDER BY created_at LIMIT 20`,
        )
      ).rows;
      for (const row of pending) {
        try {
          const e = row.payload.event || {};
          if (
            row.type === "revocation" ||
            row.type === "user.authorization.revoke"
          ) {
            const id =
              e.user_id ||
              row.payload.subscription?.condition?.broadcaster_user_id ||
              row.payload.subscription?.condition?.to_broadcaster_user_id;
            await db.query(
              "DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE twitch_id=$1)",
              [id || ""],
            );
            await db.query(
              "DELETE FROM twitch_connections WHERE account_id IN (SELECT id FROM accounts WHERE twitch_id=$1)",
              [id || ""],
            );
            await db.query(
              "UPDATE channels SET connected=false,tokens=null,token_version=token_version+1,config=jsonb_set(jsonb_set(config,'{vision}','false'::jsonb),'{paused}','true'::jsonb) WHERE id=$1",
              [id || ""],
            );
            const w = worlds.get(id);
            if (w) {
              w.stop();
              w.state.mode = "OFFLINE";
              w.state.config.vision = false;
              w.sceneReset();
            }
          } else if (row.type === "channel.raid") {
            const event = body(
              z
                .object({
                  from_broadcaster_user_id: z.string().regex(/^\d+$/),
                  to_broadcaster_user_id: z.string().regex(/^\d+$/),
                  from_broadcaster_user_name: z.string().max(50),
                  viewers: z.number().int().min(0).max(10000000),
                })
                .passthrough(),
              e,
            );
            const c = (
              await db.query("SELECT connected FROM channels WHERE id=$1", [
                event.to_broadcaster_user_id,
              ])
            ).rows[0];
            if (c?.connected)
              await (
                await world(event.to_broadcaster_user_id)
              ).raid(
                row.id,
                event.from_broadcaster_user_id,
                event.from_broadcaster_user_name,
                event.viewers,
              );
          } else if (row.type === "channel.chat.message") {
            const event = body(
              z
                .object({
                  broadcaster_user_id: z.string().regex(/^\d+$/),
                  chatter_user_id: z.string().regex(/^\d+$/),
                  chatter_user_name: z.string().max(50),
                  message: z.object({ text: z.string().max(2000) }),
                  message_id: z.string().max(200),
                })
                .passthrough(),
              e,
            );
            const condition = row.payload.subscription?.condition;
            if (
              condition?.broadcaster_user_id &&
              condition.broadcaster_user_id !== event.broadcaster_user_id
            )
              throw new GameError(
                "CHANNEL_MISMATCH",
                "Subscription channel mismatch",
              );
            if (
              /^!(join|left|right|up|down|jump|wave|dance|sit|rift|ourapp|stop)(\s|$)/i.test(
                event.message.text,
              )
            ) {
              const c = (
                await db.query("SELECT connected FROM channels WHERE id=$1", [
                  event.broadcaster_user_id,
                ])
              ).rows[0];
              if (c?.connected) {
                const w = await world(event.broadcaster_user_id);
                const who = await account(
                  db,
                  event.chatter_user_id,
                  event.chatter_user_name,
                  w.state.mode === "SIMULATOR",
                );
                try {
                  if (/^!join\s*$/i.test(event.message.text))
                    await w.join(who, true);
                  else
                    await w.action(
                      who,
                      event.message.text.slice(0, 500),
                      `chat:${event.message_id}`,
                    );
                } catch (error) {
                  if (!(error instanceof GameError)) throw error;
                }
              }
            }
          }
          await db.query(
            `UPDATE inbox SET status='done',payload='{}'::jsonb WHERE id=$1`,
            [row.id],
          );
        } catch (error) {
          await db.query(
            "UPDATE inbox SET attempts=attempts+1,error=$2,status=CASE WHEN attempts>=4 THEN 'dead' ELSE 'pending' END WHERE id=$1",
            [
              row.id,
              error instanceof GameError ? error.code : "PROCESSING_FAILED",
            ],
          );
        }
      }
    } finally {
      draining = false;
    }
  }
  const closeMedia = installMediaRelay(app.server, db, security, origin);
  app.post("/v1/creator/mobile-token", async (req) => {
    const c = await creator(req);
    body(z.object({ consent: z.literal(true) }).strict(), req.body);
    const token = security.sign({
      room: c.id,
      role: "capture",
      version: c.token_version,
      exp: Date.now() + 3600000,
    });
    const receiver = security.sign({
      room: c.id,
      role: "overlay",
      version: c.token_version,
      exp: Date.now() + 3600000,
    });
    return {
      server: origin,
      room: c.id,
      token,
      receiverUrl: `${origin}/receiver#token=${receiver}`,
      mode: "EXPERIMENTAL LAN VIDEO; AUDIO NOT IMPLEMENTED",
    };
  });
  app.get("/v1/native/world", async (req) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
    const p = security.verify(token);
    if (p.role !== "capture")
      throw new GameError("BAD_ROLE", "Capture token required", 403);
    const c = (
      await db.query("SELECT token_version FROM channels WHERE id=$1", [p.room])
    ).rows[0];
    if (!c || c.token_version !== p.version)
      throw new GameError("REVOKED", "Pairing revoked", 401);
    return (await world(p.room)).state;
  });
  const closeWorldTransport = installWorldTransport(
    app.server,
    db,
    security,
    origin,
    world,
    metrics,
  );
  async function validateConnections() {
    const revoked = await twitch.validateConnections();
    for (const id of revoked) {
      const w = worlds.get(id);
      if (w) {
        w.stop();
        w.state.mode = "OFFLINE";
        w.state.config.vision = false;
        w.sceneReset();
      }
    }
  }
  const timers: ReturnType<typeof setInterval>[] = [];
  if (options.timers !== false) {
    void validateConnections().catch(() => metrics.failures++);
    timers.push(
      setInterval(
        () => void validateConnections().catch(() => metrics.failures++),
        300000,
      ),
    );
    timers.push(
      setInterval(() => {
        metrics.ticks++;
        for (const w of worlds.values()) w.tick();
      }, 50),
      setInterval(() => void drain().catch(() => metrics.failures++), 250),
      setInterval(() => {
        for (const w of worlds.values())
          void w.save().catch(() => metrics.failures++);
      }, 5000),
      setInterval(() => {
        void db.query(`DELETE FROM oauth_states WHERE expires_at<now()`);
        void db.query("DELETE FROM sessions WHERE expires_at<now()");
        void db.query(
          "DELETE FROM construction_receipts WHERE created_at<now()-interval '24 hours'",
        );
        void db.query("DELETE FROM structures WHERE expires_at<now()");
        void db.query(
          "UPDATE inbox SET payload='{}'::jsonb WHERE created_at<now()-interval '1 day' AND status IN ('done','dead')",
        );
        void db.query(
          "DELETE FROM inbox WHERE created_at<now()-interval '30 days'",
        );
        void db.query(
          `UPDATE action_log SET plan=null WHERE created_at<now()-interval '1 day' AND plan IS NOT NULL`,
        );
        for (const w of worlds.values()) {
          for (const [id, e] of w.evidence)
            w.evidence.set(
              id,
              e.filter((r) => Date.now() - r.at < 3000),
            );
        }
      }, 30000),
    );
  }
  const webRoot = resolve(options.webRoot || "dist/web");
  if (existsSync(resolve(webRoot, "index.html"))) {
    const htmlTemplate = await readFile(resolve(webRoot, "index.html"), "utf8");
    for (const path of ["/", "/leaderboard", "/live", "/players/:id"])
      app.get(path, async (req, reply) =>
        reply
          .type("text/html")
          .send(
            await publicDocument(
              htmlTemplate,
              req.url.split("?")[0],
              db,
              origin,
            ),
          ),
      );
    await app.register(staticFiles, { root: webRoot, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/v1/"))
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Endpoint not found",
          requestId: req.id,
        });
      return reply.sendFile("index.html");
    });
  }
  app.addHook("onClose", async () => {
    timers.forEach(clearInterval);
    closeMedia();
    closeWorldTransport();
    for (const w of worlds.values()) await w.save();
    await db.close();
  });
  return { app, db, world, worlds, drain, security, twitch, metrics };
}
