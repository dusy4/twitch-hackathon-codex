import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { defaultConfig } from "../packages/shared/contracts.js";
import { WebSocket } from "ws";
test("real HTTP contract: session, CSRF, actor ownership, config roles, privacy, overlay rotation and economy", async () => {
  const system = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 8)),
    timers: false,
    demo: true,
  });
  const { app } = system;
  try {
    let r = await app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "https://evil.test" },
      payload: { persona: "traveler" },
    });
    assert.equal(r.statusCode, 403);
    r = await app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "http://127.0.0.1:3400" },
      payload: { persona: "traveler" },
    });
    assert.equal(r.statusCode, 200);
    const sessionCookie = r.cookies[0].name + "=" + r.cookies[0].value;
    const me = (
      await app.inject({ url: "/v1/me", headers: { cookie: sessionCookie } })
    ).json();
    const headers = {
      origin: "http://127.0.0.1:3400",
      cookie: sessionCookie,
      "x-csrf-token": me.csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/worlds/demo-world/join",
          headers: { origin: headers.origin, cookie: sessionCookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/worlds/demo-world/actions",
          headers,
          payload: {
            prompt: "dance",
            clientRequestId: "a",
            actorId: "someone-else",
          },
        })
      ).statusCode,
      400,
    );
    r = await app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/actions",
      headers,
      payload: { prompt: "dance", clientRequestId: "one" },
    });
    assert.equal(r.statusCode, 200);
    const again = await app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/actions",
      headers,
      payload: { prompt: "dance", clientRequestId: "one" },
    });
    assert.equal(again.json().id, r.json().id);
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/creator/config", headers }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: "/v1/admin/audit", headers })).statusCode,
      403,
    );
    const rank = (
      await app.inject({ url: "/v1/leaderboard?period=all" })
    ).json();
    assert.equal(rank.rows[0].score, "20");
    assert.equal(rank.rows[0].demo, true);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/me/profile",
          headers,
          payload: { privacy: "hidden" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/v1/leaderboard?period=all" })).json().rows
        .length,
      0,
    );
    assert.equal(
      (await app.inject({ url: `/v1/players/${me.user.id}` })).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/shop/orders",
          headers,
          payload: { itemId: "pocket-dragon", idempotencyKey: "x" },
        })
      ).statusCode >= 400,
      true,
    );
    const host = await app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: headers.origin },
      payload: { persona: "host" },
    });
    const hc = host.cookies[0].name + "=" + host.cookies[0].value;
    const hm = (
      await app.inject({ url: "/v1/me", headers: { cookie: hc } })
    ).json();
    const hh = { origin: headers.origin, cookie: hc, "x-csrf-token": hm.csrf };
    const link = (
      await app.inject({
        method: "POST",
        url: "/v1/creator/overlay-token/rotate",
        headers: hh,
        payload: {},
      })
    ).json();
    assert.match(link.url, /#token=/);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/creator/test-raid",
          headers: hh,
          payload: { count: 10000 },
        })
      ).statusCode,
      200,
    );
    assert.equal((await system.world("demo-world")).state.raid?.count, 10000);
    await app.inject({
      method: "POST",
      url: "/v1/creator/emergency-stop",
      headers: hh,
      payload: {},
    });
    assert.equal((await system.world("demo-world")).state.config.paused, true);
    assert.equal((await system.world("demo-world")).state.config.vision, false);
  } finally {
    await app.close();
  }
});
test("signed webhook challenge, duplicate delivery, durable inbox processing and two stable numeric chatter identities", async () => {
  const old = process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET;
  process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET = "test-webhook-secret-123";
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 8)),
    timers: false,
    demo: false,
  });
  try {
    const host = await account(s.db, "123", "Creator");
    await s.db.query(
      "INSERT INTO channels(id,owner_id,config,connected) VALUES($1,$2,$3,true)",
      ["123", host.id, JSON.stringify(defaultConfig)],
    );
    const deliver = async (id: string, payload: any, type = "notification") => {
      const raw = JSON.stringify(payload),
        timestamp = new Date().toISOString();
      return s.app.inject({
        method: "POST",
        url: "/v1/twitch/eventsub",
        headers: {
          "content-type": "application/json",
          "twitch-eventsub-message-id": id,
          "twitch-eventsub-message-timestamp": timestamp,
          "twitch-eventsub-message-signature":
            "sha256=" +
            createHmac("sha256", process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET!)
              .update(id + timestamp + raw)
              .digest("hex"),
          "twitch-eventsub-message-type": type,
        },
        payload: raw,
      });
    };
    const c = await deliver(
      "challenge",
      { challenge: "verified" },
      "webhook_callback_verification",
    );
    assert.equal(c.body, "verified");
    const payload = {
      subscription: { type: "channel.raid" },
      event: {
        from_broadcaster_user_id: "777",
        to_broadcaster_user_id: "123",
        from_broadcaster_user_name: "Raid Creator",
        viewers: 10000,
      },
    };
    await deliver("same", payload);
    await deliver("same", payload);
    await s.drain();
    assert.equal((await s.db.query("SELECT * FROM raids")).rows.length, 1);
    assert.equal((await s.db.query("SELECT * FROM accounts")).rows.length, 1);
    for (const id of ["1001", "1002"])
      await deliver(`chat-${id}`, {
        subscription: {
          type: "channel.chat.message",
          condition: { broadcaster_user_id: "123" },
        },
        event: {
          broadcaster_user_id: "123",
          chatter_user_id: id,
          chatter_user_name: `Viewer${id}`,
          message_id: `msg-${id}`,
          message: { text: "!join" },
        },
      });
    await s.drain();
    const world = await s.world("123");
    assert.equal(world.state.avatars.length, 2);
    assert.ok(
      world.state.avatars.every((a) => a.arrival && a.animation === "walk"),
      "Signed !join messages initiate visible portal arrivals",
    );
    assert.notEqual(world.state.avatars[0].id, world.state.avatars[1].id);
    assert.equal(
      (await s.db.query("SELECT * FROM raid_participants")).rows.length,
      2,
    );
    assert.equal(
      (await s.db.query("SELECT * FROM inbox WHERE status='done'")).rows.length,
      3,
    );
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/twitch/eventsub",
          payload: {},
        })
      ).statusCode,
      403,
    );
  } finally {
    await s.app.close();
    if (old === undefined) delete process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET;
    else process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET = old;
  }
});
test("actual websocket gets authoritative snapshots and rejects write frames", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 8)),
    timers: false,
    demo: true,
    origin: "http://127.0.0.1:0",
  });
  try {
    await s.app.listen({ host: "127.0.0.1", port: 0 });
    const address = s.app.server.address() as any;
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/socket?room=demo-world`,
    );
    const message = await new Promise<any>((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(String(data))));
      ws.once("error", reject);
    });
    assert.equal(message.type, "world.snapshot");
    assert.equal(message.payload.mode, "SIMULATOR");
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    ws.send(JSON.stringify({ type: "mint", amount: 999999 }));
    assert.equal(await closed, 1008);
  } finally {
    await s.app.close();
  }
});
