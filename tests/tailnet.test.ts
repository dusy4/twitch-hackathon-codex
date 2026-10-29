import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import {
  TAILNET_ROOM,
  createTailnetTestApp,
  readEnvValue,
  tailscaleIpv4,
} from "../apps/api/tailnet-test.js";

const ORIGIN = "https://raidrift-pc.example.ts.net";
async function setup() {
  delete process.env.OPENCODE_GO_API_KEY;
  const server = await createTailnetTestApp({
    host: "127.0.0.1",
    port: 3499,
    origin: ORIGIN,
    relayUrl: "rtmp://raidrift-pc.example.ts.net:1935/live/raidrift",
    timers: false,
    debugChatStaggerMs: 0,
  });
  const pair = await server.app.inject({ url: "/v1/debug/pair" });
  assert.equal(pair.statusCode, 200, pair.body);
  const auth = { authorization: `Bearer ${pair.json().token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    server.app.inject({ method: "POST", url, headers: auth, payload });
  const state = async () =>
    (
      await server.app.inject({ url: "/v1/native/debug/state", headers: auth })
    ).json();
  return { server, pair: pair.json(), auth, post, state };
}
const dog = (id = "phone-dog-1") => ({
  id,
  class: "dog",
  attributes: [],
  box: [0.4, 0.5, 0.2, 0.3],
  confidence: 0.82,
  // Phone clock skew must not matter: the server restamps on receipt.
  seenAt: 12345,
});

test("tailnet host guard accepts loopback and Tailscale CGNAT only", async () => {
  assert.ok(tailscaleIpv4("100.64.0.1"));
  assert.ok(tailscaleIpv4("100.127.255.254"));
  assert.ok(!tailscaleIpv4("100.128.0.1"));
  assert.ok(!tailscaleIpv4("100.63.0.1"));
  for (const host of ["0.0.0.0", "192.168.1.20", "8.8.8.8"])
    await assert.rejects(
      createTailnetTestApp({ host, port: 3499, origin: ORIGIN, timers: false }),
      /Tailscale/,
    );
});

test("readEnvValue reads a single key without loading the file", () => {
  const file = join(tmpdir(), `rr-env-${randomBytes(4).toString("hex")}`);
  writeFileSync(file, 'A=1\nOPENCODE_GO_API_KEY="sk-test"\nB=2\n');
  try {
    assert.equal(readEnvValue(file, "OPENCODE_GO_API_KEY"), "sk-test");
    assert.equal(readEnvValue(file, "MISSING"), undefined);
  } finally {
    rmSync(file);
  }
});

test("pairing, native tracks and synchronous native chat drive the north star with a phone dog", async () => {
  const { server, pair, post, state } = await setup();
  try {
    assert.equal(pair.server, ORIGIN);
    assert.equal(pair.room, TAILNET_ROOM);
    assert.match(pair.relayUrl, /^rtmp:/);
    const w = await server.world(TAILNET_ROOM);
    assert.equal(w.state.mode, "SIMULATOR");
    assert.equal(w.state.avatars.length, 2);
    // No dog yet: a friendly, synchronous refusal (HTTP 200).
    const none = await post("/v1/native/chat", {
      text: "run to the dog and sit on it",
    });
    assert.equal(none.statusCode, 200);
    assert.equal(none.json().ok, false);
    assert.equal(none.json().code, "TARGET_NOT_VISIBLE");
    assert.match(none.json().message, /Couldn't find a dog/);
    // Phone requests carry no Origin header and still work.
    const tracks = await post("/v1/native/tracks", { tracks: [dog()] });
    assert.equal(tracks.statusCode, 200, tracks.body);
    assert.equal(tracks.json().epoch, w.state.epoch);
    assert.equal(w.state.tracks[0].id, "phone-dog-1");
    assert.ok(Math.abs(w.state.tracks[0].seenAt - Date.now()) < 1000);
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      mock.timers.tick(600); // per-chatter cooldown after the refusal above
      await post("/v1/native/tracks", { tracks: [dog()] });
      const first = await post("/v1/native/chat", {
        text: "run to the dog and sit on it",
      });
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().ok, true, first.body);
      assert.equal(first.json().source, "keywords");
      assert.match(first.json().plan, /dog#phone-dog-1/);
      const second = await post("/v1/native/chat", {
        name: "BravoRaider",
        text: "!rift run to the dog and sit on it",
      });
      assert.equal(second.json().ok, true, second.body);
      const streamer = w.state.avatars.find((a) => a.name === "Streamer")!;
      assert.ok(streamer, "native chat auto-joins the chatter");
      assert.equal(streamer.target, "phone-dog-1");
      let completed = false;
      for (let i = 0; i < 60 && !completed; i++) {
        mock.timers.tick(250);
        // The phone keeps reporting the dog (it is still in view).
        if (i % 2 === 0) await post("/v1/native/tracks", { tracks: [dog()] });
        w.tick(Date.now());
        await w.evaluateQuests(Date.now());
        if (streamer.animation === "sit")
          assert.equal(streamer.target, "phone-dog-1");
        completed = w.state.quests.some(
          (q) => q.title === "Sit with the dog" && q.completed,
        );
      }
      assert.ok(completed, "two players sitting on the phone's dog pay out");
    } finally {
      mock.timers.reset();
    }
    const s = await state();
    assert.ok(s.leaderboard.length >= 2);
    assert.ok(
      s.leaderboard.some(
        (r: { name: string; score: number }) =>
          r.name === "Streamer" && r.score === 70,
      ),
      JSON.stringify(s.leaderboard),
    );
    assert.ok(
      s.log.some(
        (e: { kind: string; text: string }) =>
          e.kind === "quest" && /completed/.test(e.text),
      ),
    );
    assert.ok(s.log.some((e: { kind: string }) => e.kind === "plan"));
    assert.ok(s.log.some((e: { kind: string }) => e.kind === "tracks"));
    assert.equal(s.ai.provider, null);
    // Plain unknown "!" commands are refused, not silently dropped.
    const unknown = await post("/v1/native/chat", { text: "!hug" });
    assert.equal(unknown.json().ok, false);
    assert.equal(unknown.json().code, "UNKNOWN_COMMAND");
  } finally {
    await server.app.close();
  }
});

test("debug raid travels the real inbox drain; raiders !join; duplicates are idempotent", async () => {
  const { server, post, state } = await setup();
  try {
    const w = await server.world(TAILNET_ROOM);
    const raid = await post("/v1/native/debug/event", {
      type: "raid",
      from: "CozyRaider",
      viewers: 40,
      chatters: 3,
    });
    assert.equal(raid.statusCode, 200, raid.body);
    assert.deepEqual(raid.json(), { ok: true, queued: 4 });
    assert.equal((await state()).inbox.pending, 4);
    await server.drain();
    assert.equal(w.state.raid?.from, "CozyRaider");
    assert.equal(w.state.raid?.count, 40);
    assert.equal(w.state.avatars.length, 5);
    const s = await state();
    assert.deepEqual(s.inbox, { pending: 0, done: 4, failed: 0 });
    assert.equal(s.avatars, 5);
    assert.ok(
      s.log.some((e: { kind: string; text: string }) =>
        /raid started: CozyRaider with 40/.test(e.text),
      ),
    );
    const raids = await server.db.query(
      "SELECT count(*)::int AS n FROM raids WHERE destination_id=$1",
      [TAILNET_ROOM],
    );
    assert.equal(raids.rows[0].n, 1);
    const dup = await post("/v1/native/debug/event", {
      type: "duplicate_raid",
    });
    assert.deepEqual(dup.json(), { ok: true, queued: 0 });
    await server.drain();
    assert.equal(
      (
        await server.db.query(
          "SELECT count(*)::int AS n FROM raids WHERE destination_id=$1",
          [TAILNET_ROOM],
        )
      ).rows[0].n,
      1,
    );
    const chat = await post("/v1/native/debug/event", {
      type: "chat",
      name: "LateRaider",
      text: "!dance",
    });
    assert.deepEqual(chat.json(), { ok: true, queued: 1 });
    await server.drain();
    assert.equal(
      w.state.avatars.find((a) => a.name === "LateRaider")?.animation,
      "dance",
    );
    const quest = await post("/v1/native/debug/event", {
      type: "quest",
      action: "dance",
      targetClass: null,
      minPlayers: 1,
      reward: 10,
    });
    assert.equal(quest.json().ok, true, quest.body);
    assert.ok(w.state.quests.some((q) => q.title === "Everyone dance"));
    const soft = await post("/v1/native/debug/event", {
      type: "revoke",
      status: "notification_failures_exceeded",
    });
    assert.equal(soft.json().queued, 1);
    await server.drain();
    assert.equal(w.state.config.paused, false);
    const reset = await post("/v1/native/debug/event", { type: "reset" });
    assert.equal(reset.json().ok, true);
    assert.equal(w.state.avatars.length, 0);
    assert.equal(w.state.raid, null);
    const revoke = await post("/v1/native/debug/event", { type: "revoke" });
    assert.equal(revoke.json().queued, 1);
    await server.drain();
    assert.equal(w.state.config.paused, true);
    // The phone's pairing is revoked with the Twitch authorization.
    const after = await post("/v1/native/tracks", { tracks: [] });
    assert.equal(after.statusCode, 401);
    const repaired = await server.app.inject({ url: "/v1/debug/pair" });
    assert.equal(repaired.statusCode, 200);
  } finally {
    await server.app.close();
  }
});

test("native endpoints require a capture token and debug tools are off by default", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(randomBytes(32)),
    demo: true,
    timers: false,
    debugTools: false,
  });
  try {
    assert.equal(
      (await s.app.inject({ url: "/v1/debug/pair" })).statusCode,
      404,
    );
    const version = (
      await s.db.query("SELECT token_version FROM channels WHERE id=$1", [
        "demo-world",
      ])
    ).rows[0].token_version;
    const token = s.security.sign({
      room: "demo-world",
      role: "capture",
      version,
      exp: Date.now() + 60_000,
    });
    const headers = { authorization: `Bearer ${token}` };
    for (const [method, url] of [
      ["POST", "/v1/native/debug/event"],
      ["GET", "/v1/native/debug/state"],
    ] as const)
      assert.equal(
        (
          await s.app.inject({
            method,
            url,
            headers,
            ...(method === "POST" ? { payload: { type: "reset" } } : {}),
          })
        ).statusCode,
        404,
      );
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/native/chat",
          payload: { text: "dance" },
        })
      ).statusCode,
      401,
    );
    const overlay = s.security.sign({
      room: "demo-world",
      role: "overlay",
      version,
      exp: Date.now() + 60_000,
    });
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/native/tracks",
          headers: { authorization: `Bearer ${overlay}` },
          payload: { tracks: [] },
        })
      ).statusCode,
      403,
    );
    // Vision consent still applies to phone tracks in a normal room.
    const blocked = await s.app.inject({
      method: "POST",
      url: "/v1/native/tracks",
      headers,
      payload: { tracks: [dog()] },
    });
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().code, "NO_CONSENT");
    const chat = await s.app.inject({
      method: "POST",
      url: "/v1/native/chat",
      headers,
      payload: { text: "dance", name: "Phone" },
    });
    assert.equal(chat.statusCode, 200);
    assert.equal(chat.json().ok, true, chat.body);
    assert.equal(chat.json().source, "keywords");
  } finally {
    await s.app.close();
  }
});
