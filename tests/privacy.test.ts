import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
test("account deletion scrubs unloaded world saves and raw identity without granting a repeat join reward on return", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 2)),
    demo: true,
    timers: false,
  });
  try {
    const login = await s.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "http://127.0.0.1:3400" },
      payload: { persona: "traveler" },
    });
    const cookie = `rr_session=${login.cookies[0].value}`;
    const me = (
      await s.app.inject({ url: "/v1/me", headers: { cookie } })
    ).json();
    const who = (
      await s.db.query("SELECT * FROM accounts WHERE id=$1", [me.user.id])
    ).rows[0];
    const world = await s.world("demo-world");
    await world.join(who);
    await world.save();
    s.worlds.delete("demo-world");
    const result = await s.app.inject({
      method: "DELETE",
      url: "/v1/me",
      headers: {
        origin: "http://127.0.0.1:3400",
        cookie,
        "x-csrf-token": me.csrf,
      },
    });
    assert.equal(result.statusCode, 200);
    const deleted = (
      await s.db.query("SELECT * FROM accounts WHERE id=$1", [who.id])
    ).rows[0];
    assert.equal(deleted.name, "Deleted traveler");
    assert.ok(deleted.twitch_id.startsWith("deleted:"));
    const save = (await s.db.query("SELECT state FROM world_saves")).rows[0]
      .state;
    assert.equal(save.avatars.length, 0);
    assert.equal((await s.world("demo-world")).state.avatars.length, 0);
    const relink = await s.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "http://127.0.0.1:3400" },
      payload: { persona: "traveler" },
    });
    const newCookie = `rr_session=${relink.cookies[0].value}`;
    const newMe = (
      await s.app.inject({ url: "/v1/me", headers: { cookie: newCookie } })
    ).json();
    assert.notEqual(newMe.user.id, who.id);
    const newAccount = (
      await s.db.query("SELECT * FROM accounts WHERE id=$1", [newMe.user.id])
    ).rows[0];
    await (await s.world("demo-world")).join(newAccount);
    assert.equal(
      Number(
        (
          await s.db.query("SELECT balance FROM wallets WHERE account_id=$1", [
            newAccount.id,
          ])
        ).rows[0].balance,
      ),
      0,
    );
    assert.equal((await s.db.query("SELECT * FROM ledger")).rows.length, 1);
  } finally {
    await s.app.close();
  }
});
test("private-world change closes existing public spectators before broadcasting private state", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 3)),
    demo: true,
    timers: false,
    origin: "http://127.0.0.1:0",
  });
  try {
    await s.app.listen({ host: "127.0.0.1", port: 0 });
    const address = s.app.server.address() as any;
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/socket?room=demo-world`,
    );
    const messages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        messages.push(JSON.parse(String(raw)));
        resolve();
      });
      ws.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    const world = await s.world("demo-world");
    world.state.config.public = false;
    world.event("private.test", { secret: "must not be sent" });
    assert.equal(await closed, 1008);
    assert.equal(
      messages.some((m) => m.type === "private.test"),
      false,
    );
  } finally {
    await s.app.close();
  }
});
