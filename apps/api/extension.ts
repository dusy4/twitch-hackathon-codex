import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { SteerInput } from "../../packages/shared/contracts.js";
import { GameError } from "./compiler.js";
import { account } from "./economy.js";
import { rewardIdentity } from "./security.js";
import type { Database } from "./db.js";
import type { World } from "./world.js";
import type { ServerResponse } from "node:http";

const Claims = z.object({
  exp: z.number().int(),
  role: z.enum(["viewer", "broadcaster", "moderator"]),
  channel_id: z.string().regex(/^\d+$/),
  opaque_user_id: z.string().regex(/^[UA][A-Za-z0-9_-]{1,128}$/),
  user_id: z.string().regex(/^\d+$/).optional(),
  is_unlinked: z.boolean().optional(),
});
export function verifyExtensionJwt(
  token: string,
  encodedSecret: string,
  now = Date.now(),
) {
  if (
    !encodedSecret ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSecret) ||
    Buffer.from(encodedSecret, "base64").length < 32
  )
    throw new GameError(
      "EXT_NOT_CONFIGURED",
      "Extension secret is not configured",
      503,
    );
  try {
    if (token.length > 8192) throw Error();
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)))
      throw Error();
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256" || header.crit) throw Error();
    const expected = createHmac("sha256", Buffer.from(encodedSecret, "base64"))
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const signature = Buffer.from(parts[2], "base64url");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(signature, expected)
    )
      throw Error();
    const claims = Claims.parse(
      JSON.parse(Buffer.from(parts[1], "base64url").toString()),
    );
    if (claims.exp * 1000 <= now) throw Error();
    return claims;
  } catch {
    throw new GameError(
      "EXT_UNAUTHORIZED",
      "A valid Twitch Extension token is required",
      401,
    );
  }
}

export function extensionState(w: World, actorId?: string) {
  return {
    serverTime: Date.now(),
    roomId: w.state.roomId,
    live: w.state.live,
    hero: w.state.avatars.find((a) => a.id === actorId) || null,
    targets: w.state.tracks
      .filter((t) => Date.now() - t.seenAt < 4000)
      .slice(0, 50)
      .map((t) => {
        const number = /^spot\s+(\d+)$/i.exec(t.class)?.[1];
        return {
          id: t.id,
          number: number ? Number(number) : null,
          label: number
            ? t.attributes.find((a) => !/^spot\s+\d+$/i.test(a)) || t.class
            : t.class,
        };
      }),
    roster: w.state.avatars.slice(0, 30).map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      animation: a.animation,
    })),
  };
}

export function installExtension(
  app: FastifyInstance,
  ctx: {
    db: Database;
    resolveRoom: (channel: string) => Promise<World>;
    command: (
      w: World,
      who: Record<string, any>,
      text: string,
      id: string,
      targetHint?: string,
    ) => Promise<unknown>;
    secret?: string;
  },
) {
  const rates = new Map<string, number[]>();
  const streams = new Map<string, number>();
  const responses = new Set<ServerResponse>();
  app.addHook("preClose", async () => {
    for (const response of responses) response.end();
  });
  function limit(key: string, max: number, window: number) {
    const now = Date.now(),
      hits = (rates.get(key) || []).filter((t) => now - t < window);
    if (hits.length >= max)
      throw new GameError("EXT_RATE", "Please slow down", 429);
    if (rates.size > 10000)
      for (const [k, times] of rates)
        if (now - times.at(-1)! > 60000) rates.delete(k);
    hits.push(now);
    rates.set(key, hits);
  }
  const authenticate = async (req: FastifyRequest) => {
    const claims = verifyExtensionJwt(
      req.headers.authorization?.replace(/^Bearer /, "") || "",
      ctx.secret ?? process.env.EXT_SECRET ?? "",
    );
    const w = await ctx.resolveRoom(claims.channel_id);
    const twitchId =
      claims.user_id && !claims.is_unlinked
        ? claims.user_id
        : `ext:${claims.opaque_user_id}`;
    return { claims, w, twitchId };
  };
  const identity = async (twitchId: string, opaque: string, w: World) => {
    // A Twitch-signed shared token proves both identities. Preserve an opaque hero
    // when possible; otherwise retire it in favour of the existing chat account.
    if (/^\d+$/.test(twitchId)) {
      const old = (
        await ctx.db.query(
          "SELECT * FROM accounts WHERE twitch_id=$1 AND deleted=false",
          [`ext:${opaque}`],
        )
      ).rows[0];
      if (old) {
        await ctx.db.query(
          "UPDATE accounts SET twitch_id=$2,reward_identity=$3 WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM accounts WHERE twitch_id=$2)",
          [old.id, twitchId, rewardIdentity(twitchId)],
        );
        const linked = (
          await ctx.db.query("SELECT * FROM accounts WHERE twitch_id=$1", [
            twitchId,
          ])
        ).rows[0];
        if (linked?.id !== old.id) {
          const running = w.running.get(old.id);
          if (running) w.finish(running, "identity_shared");
          w.state.avatars = w.state.avatars.filter((a) => a.id !== old.id);
          w.state.props = w.state.props.filter((p) => p.owner !== old.id);
          w.duels.cancelFor(old.id);
          w.event("avatar.departed", { actorId: old.id });
        }
      }
    }
    const existing = (
      await ctx.db.query("SELECT * FROM accounts WHERE twitch_id=$1", [
        twitchId,
      ])
    ).rows[0];
    return (
      existing || account(ctx.db, twitchId, `viewer-${twitchId.slice(-4)}`)
    );
  };
  for (const route of ["join", "steer", "emote", "prompt"] as const) {
    app.post(`/v1/ext/${route}`, async (req) => {
      const { w, twitchId, claims } = await authenticate(req);
      limit(
        `${w.state.roomId}:${twitchId}:${route === "steer" ? "steer" : "action"}`,
        route === "steer" ? 10 : 2,
        1000,
      );
      // Validate before allocating an account. No actor/name/channel may be supplied by the client.
      const data =
        route === "steer"
          ? SteerInput.parse(req.body)
          : route === "emote"
            ? z
                .object({
                  emote: z.enum(["jump", "dance", "wave", "sit", "cheer"]),
                })
                .strict()
                .parse(req.body)
            : route === "prompt"
              ? z
                  .object({
                    prompt: z.string().trim().min(1).max(500),
                    targetHint: z.string().max(80).optional(),
                  })
                  .strict()
                  .parse(req.body)
              : z.object({}).strict().parse(req.body);
      const who = await identity(twitchId, claims.opaque_user_id, w);
      if (route === "join") {
        await w.join(who);
        w.cancelControl(who.id);
      } else if ("x" in data) await w.steer(who, data.x, data.y);
      else if ("emote" in data)
        await ctx.command(w, who, `!${data.emote}`, `ext-${randomUUID()}`);
      else if ("prompt" in data)
        await ctx.command(
          w,
          who,
          `!rift ${data.prompt.replace(/^!(?:rift|ourapp)\s+/i, "").replace(/^!/, "")}`,
          `ext-${randomUUID()}`,
          data.targetHint,
        );
      return extensionState(w, who.id);
    });
  }
  const state = async (req: FastifyRequest) => {
    const auth = await authenticate(req);
    limit(`${auth.twitchId}:read`, 20, 1000);
    const who = (
      await ctx.db.query(
        "SELECT id FROM accounts WHERE twitch_id=$1 AND deleted=false",
        [auth.twitchId],
      )
    ).rows[0];
    return { ...auth, actorId: who?.id as string | undefined };
  };
  app.get("/v1/ext/state", async (req) => {
    const { w, actorId } = await state(req);
    return extensionState(w, actorId);
  });
  app.get("/v1/ext/events", async (req, reply) => {
    const { w, actorId, twitchId, claims } = await state(req);
    const key = `${w.state.roomId}:${twitchId}`;
    if ((streams.get(key) || 0) >= 2)
      throw new GameError(
        "EXT_STREAM_LIMIT",
        "Close another controller first",
        429,
      );
    streams.set(key, (streams.get(key) || 0) + 1);
    // fetch streaming keeps JWT in Authorization, never in URLs or access logs.
    reply.hijack();
    for (const [key, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(key, value);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    responses.add(reply.raw);
    const send = () => {
      if (Date.now() >= claims.exp * 1000 || reply.raw.destroyed) {
        reply.raw.end();
        return;
      }
      if (reply.raw.writableLength > 65536) {
        reply.raw.end();
        return;
      }
      void ctx
        .resolveRoom(claims.channel_id)
        .then((room) => {
          if (reply.raw.destroyed || reply.raw.writableEnded) return;
          if (room !== w) {
            reply.raw.end();
            return;
          }
          reply.raw.write(
            `event: state\ndata: ${JSON.stringify(extensionState(w, actorId))}\n\n`,
          );
        })
        .catch(() => reply.raw.end());
    };
    const timer = setInterval(send, 200);
    timer.unref();
    send();
    const cleanup = () => {
      responses.delete(reply.raw);
      clearInterval(timer);
      const n = (streams.get(key) || 1) - 1;
      if (n) streams.set(key, n);
      else streams.delete(key);
    };
    reply.raw.once("close", cleanup);
  });
}
