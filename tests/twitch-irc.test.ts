import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, type WebSocket } from "ws";
import { once } from "node:events";
import { parseIrc, TwitchIrc } from "../apps/api/twitch-irc.js";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";

const chat = (id: string, text: string, userId = "123") =>
  `@id=${id};user-id=${userId};room-id=555;display-name=Alice;color=#92FFE0 :alice!alice@alice.tmi.twitch.tv PRIVMSG #channel :${text}\r\n`;
export async function eventually(predicate: () => boolean, timeout = 5000) {
  const until = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > until) assert.fail("Timed out waiting for state");
    await new Promise((r) => setTimeout(r, 20));
  }
}
test("IRCv3 parser preserves trailing text, tags, escapes, raid, PING and RECONNECT", () => {
  const m = parseIrc(
    "@display-name=Alice\\sA;key=x\\:y\\\\z\\r\\n;empty=;flag :a!a@a PRIVMSG #channel :!rift go to 3 and dance",
  )!;
  assert.equal(m.tags["display-name"], "Alice A");
  assert.equal(m.tags.key, "x;y\\z\r\n");
  assert.equal(m.params[1], "!rift go to 3 and dance");
  assert.equal(m.tags.flag, "");
  assert.equal(parseIrc("PING :tmi.twitch.tv")!.command, "PING");
  assert.equal(parseIrc(":tmi.twitch.tv RECONNECT")!.command, "RECONNECT");
  assert.equal(
    parseIrc(
      "@msg-id=raid;msg-param-viewerCount=25 :tmi.twitch.tv USERNOTICE #channel",
    )!.tags["msg-id"],
    "raid",
  );
  assert.equal(parseIrc("@missing"), null);
});
test("anonymous connector negotiates, PONGs, deduplicates, ignores wrong rooms and reconnects", async () => {
  const fake = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(fake, "listening");
  const port = (fake.address() as { port: number }).port;
  let connections = 0,
    pong = false,
    hello = "",
    socket: WebSocket;
  fake.on("connection", (ws) => {
    connections++;
    socket = ws;
    ws.on("message", (data) => {
      const line = data.toString();
      assert.ok(
        !line.includes("\r\nNICK") && !line.includes("\r\nCAP"),
        "One outbound IRC command per WebSocket frame",
      );
      hello += line;
      if (line.includes("JOIN")) {
        ws.send(
          "@room-id=555 :tmi.twitch.tv ROOMSTATE #channel\r\nPING :hello\r\n",
        );
      }
      if (line.includes("PONG :hello")) pong = true;
    });
  });
  const chats: any[] = [],
    raids: any[] = [];
  const reader = new TwitchIrc(
    "#CHANNEL",
    {
      chat: async (m) => {
        chats.push(m);
      },
      raid: async (m) => {
        raids.push(m);
      },
    },
    { url: `ws://127.0.0.1:${port}`, retryMs: 10 },
  ).start();
  try {
    await eventually(() => reader.status.connected && pong);
    assert.match(hello, /NICK justinfan\d+/);
    assert.match(hello, /CAP REQ :twitch.tv\/tags twitch.tv\/commands/);
    socket!.send(
      chat("one", "!dance") +
        chat("one", "!dance") +
        chat("two", "!wave").replace("#channel", "#other"),
    );
    socket!.send(
      "@id=raid-one;msg-id=raid;user-id=444;msg-param-displayName=Raider;msg-param-viewerCount=42 :tmi.twitch.tv USERNOTICE #channel\r\n",
    );
    await eventually(() => chats.length === 1 && raids.length === 1);
    assert.equal(chats[0].userId, "123");
    assert.equal(chats[0].color, "#92FFE0");
    assert.equal(raids[0].count, 42);
    assert.equal(reader.status.viewersSeen, 1);
    assert.equal(reader.status.raidsSeen, 1);
    socket!.send(":tmi.twitch.tv RECONNECT\r\n");
    await eventually(() => connections >= 2 && reader.status.connected);
    reader.stop();
    const stoppedAt = connections;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(connections, stoppedAt);
  } finally {
    reader.stop();
    for (const ws of fake.clients) ws.terminate();
    await new Promise<void>((r) => fake.close(() => r()));
  }
});
test("paired Live routes deliver real identities through shared chat, steering and a non-test raid", async () => {
  const fake = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(fake, "listening");
  let socket: WebSocket | undefined;
  fake.on("connection", (ws) => {
    socket = ws;
    ws.on("message", (data) => {
      if (data.toString().includes("JOIN"))
        ws.send("@room-id=555 :tmi.twitch.tv ROOMSTATE #channel\r\n");
    });
  });
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 4)),
    demo: true,
    timers: false,
    debugTools: true,
    debugRoom: "demo-world",
    ircUrl: `ws://127.0.0.1:${(fake.address() as { port: number }).port}`,
  });
  try {
    const pair = (await s.app.inject({ url: "/v1/debug/pair" })).json();
    const headers = { authorization: `Bearer ${pair.token}` };
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/live/channel",
          payload: { channel: "channel" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/live/channel",
          headers,
          payload: { channel: "channel\r\nQUIT" },
        })
      ).statusCode,
      400,
    );
    const started = await s.app.inject({
      method: "POST",
      url: "/v1/live/channel",
      headers,
      payload: { channel: "channel" },
    });
    assert.equal(started.statusCode, 200, started.body);
    const w = await s.world("demo-world");
    await eventually(() => !!w.state.live?.connected);
    socket!.send(chat("live-join", "!join"));
    await eventually(() => w.state.avatars.some((a) => a.name === "Alice"));
    const alice = w.state.avatars.find((a) => a.name === "Alice")!;
    await new Promise((r) => setTimeout(r, 510));
    socket!.send(chat("live-dance", "!dance"));
    await eventually(() => alice.animation === "dance");
    assert.equal(alice.color, "#92FFE0");
    const account = (
      await s.db.query("SELECT twitch_id,demo FROM accounts WHERE id=$1", [
        alice.id,
      ])
    ).rows[0];
    assert.equal(account.twitch_id, "123");
    assert.equal(account.demo, false);
    await new Promise((r) => setTimeout(r, 510));
    socket!.send(chat("live-steer", "!d"));
    await eventually(() => !!alice.steer);
    assert.equal(alice.steer!.x, 1);
    assert.ok(alice.steer!.until - Date.now() <= 1200);
    socket!.send(
      "@id=live-raid;msg-id=raid;user-id=444;msg-param-displayName=RaidFriend;msg-param-viewerCount=7 :tmi.twitch.tv USERNOTICE #channel\r\n",
    );
    await eventually(() => !!w.state.raid);
    assert.equal(w.state.raid!.test, false);
    assert.equal(w.state.raid!.from, "RaidFriend");
    assert.equal(w.state.raid!.count, 7);
    const snapshot = (
      await s.app.inject({ url: "/v1/native/world", headers })
    ).json();
    assert.equal(snapshot.live.channel, "channel");
    assert.equal(snapshot.mode, "LIVE TWITCH");
    assert.equal(snapshot.avatars.length, 1);
    assert.equal(
      (
        await s.app.inject({
          url: "/v1/native/chat",
          method: "POST",
          headers,
          payload: { text: "dance" },
        })
      ).statusCode,
      403,
    );
    const reset = await s.app.inject({
      method: "POST",
      url: "/v1/native/debug/event",
      headers,
      payload: { type: "reset" },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(
      w.state.mode,
      "LIVE TWITCH",
      "Resetting practice actors must not relabel an active IRC reader as a simulator",
    );
    await s.app.inject({ method: "DELETE", url: "/v1/live/channel", headers });
    assert.equal(
      (await s.app.inject({ url: "/v1/live/status", headers })).json().channel,
      null,
    );
    assert.equal(w.state.mode, "SIMULATOR");
  } finally {
    await s.app.close();
    for (const ws of fake.clients) ws.terminate();
    await new Promise<void>((r) => fake.close(() => r()));
  }
});
