import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { Security, hash } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { Twitch } from "../apps/api/twitch.js";
import { createApp } from "../apps/api/server.js";
import { defaultConfig } from "../packages/shared/contracts.js";
test("periodic provider validation revokes sessions, encrypted connection and creator capture rights on 401", async () => {
  const old = [process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET];
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "123", "Creator");
    const security = new Security(Buffer.alloc(32, 8));
    const tokens = security.seal({
      access_token: "private",
      refresh_token: "refresh",
      expiresAt: Date.now() + 3600000,
    });
    await db.query(
      "INSERT INTO channels(id,owner_id,config,tokens,connected) VALUES($1,$2,$3,$4,true)",
      [
        "123",
        who.id,
        JSON.stringify({ ...defaultConfig, vision: true }),
        tokens,
      ],
    );
    await db.query(
      "INSERT INTO twitch_connections(account_id,tokens,validated_at) VALUES($1,$2,now()-interval '1 hour')",
      [who.id, tokens],
    );
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 day')",
      [hash("session"), who.id, "csrf"],
    );
    const twitch = new Twitch(
      db,
      security,
      async () => new Response("{}", { status: 401 }),
    );
    assert.deepEqual(await twitch.validateConnections(), ["123"]);
    assert.equal((await db.query("SELECT * FROM sessions")).rows.length, 0);
    assert.equal(
      (await db.query("SELECT * FROM twitch_connections")).rows.length,
      0,
    );
    const channel = (await db.query("SELECT * FROM channels")).rows[0];
    assert.equal(channel.connected, false);
    assert.equal(channel.config.vision, false);
    assert.equal(channel.config.paused, true);
    assert.equal(channel.tokens, null);
  } finally {
    await db.close();
    for (const [i, key] of [
      "TWITCH_CLIENT_ID",
      "TWITCH_CLIENT_SECRET",
    ].entries()) {
      if (old[i] === undefined) delete process.env[key];
      else process.env[key] = old[i];
    }
  }
});
test("OAuth state is browser-bound; unlink and relink preserve persistent identity without exposing tokens", async () => {
  const old = [process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET];
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
  const fake: typeof fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).endsWith("/validate")
          ? { client_id: "test-client", user_id: "123", login: "Alice" }
          : {
              access_token: "private-access",
              refresh_token: "private-refresh",
              expires_in: 3600,
            },
      ),
    );
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 9)),
    demo: false,
    timers: false,
    fetcher: fake,
  });
  try {
    async function login() {
      const initial = await s.app.inject("/auth/twitch");
      assert.equal(initial.statusCode, 302);
      const state = new URL(initial.headers.location!).searchParams.get(
        "state",
      );
      const browserCookie =
        initial.cookies[0].name + "=" + initial.cookies[0].value;
      const path = `/auth/twitch/callback?code=provider-code&state=${state}`;
      assert.equal((await s.app.inject(path)).statusCode, 403);
      const callback = await s.app.inject({
        url: path,
        headers: { cookie: browserCookie },
      });
      assert.equal(callback.statusCode, 302);
      assert.ok(!callback.body.includes("private-access"));
      const sessionCookie = callback.cookies.find(
        (c) => c.name === "rr_session",
      )!;
      assert.equal(sessionCookie.httpOnly, true);
      const cookie = `rr_session=${sessionCookie.value}`;
      const me = (
        await s.app.inject({ url: "/v1/me", headers: { cookie } })
      ).json();
      return { me, cookie };
    }
    const first = await login();
    const connection = (await s.db.query("SELECT * FROM twitch_connections"))
      .rows[0];
    assert.ok(!connection.tokens.includes("private-access"));
    await s.db.query(
      "INSERT INTO inventory(account_id,item_id) VALUES($1,$2)",
      [first.me.user.id, "violet-mage"],
    );
    const unlinked = await s.app.inject({
      method: "POST",
      url: "/v1/me/unlink",
      headers: {
        origin: "http://127.0.0.1:3400",
        cookie: first.cookie,
        "x-csrf-token": first.me.csrf,
      },
      payload: {},
    });
    assert.equal(unlinked.statusCode, 200);
    assert.equal(
      (
        await s.app.inject({ url: "/v1/me", headers: { cookie: first.cookie } })
      ).json().user,
      null,
    );
    const second = await login();
    assert.equal(second.me.user.id, first.me.user.id);
    assert.equal(
      (
        await s.db.query("SELECT * FROM inventory WHERE account_id=$1", [
          second.me.user.id,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await s.app.close();
    for (const [i, key] of [
      "TWITCH_CLIENT_ID",
      "TWITCH_CLIENT_SECRET",
    ].entries()) {
      if (old[i] === undefined) delete process.env[key];
      else process.env[key] = old[i];
    }
  }
});
