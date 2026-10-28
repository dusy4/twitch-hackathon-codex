import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
test("share cards require explicit owner consent, escape text and honor signature, expiry, privacy and revocation", async () => {
  const security = new Security(Buffer.alloc(32, 14));
  const s = await createApp({
    db: Database.memory(),
    security,
    demo: true,
    timers: false,
  });
  try {
    const login = await s.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "http://127.0.0.1:3400" },
      payload: { persona: "third" },
    });
    const cookie = `rr_session=${login.cookies[0].value}`;
    const me = (
      await s.app.inject({ url: "/v1/me", headers: { cookie } })
    ).json();
    const headers = {
      cookie,
      origin: "http://127.0.0.1:3400",
      "x-csrf-token": me.csrf,
    };
    const mint = (consent: boolean) =>
      s.app.inject({
        method: "POST",
        url: "/v1/me/share-card",
        headers,
        payload: { consent },
      });
    assert.equal((await mint(false)).statusCode, 400);
    await s.db.query("UPDATE accounts SET name=$2 WHERE id=$1", [
      me.user.id,
      "<script>alert(1)</script>",
    ]);
    const card = (await mint(true)).json();
    const url = new URL(card.url).pathname;
    let response = await s.app.inject({ url });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers["content-type"] as string, /image\/svg\+xml/);
    assert.ok(response.body.includes("&lt;script&gt;"));
    assert.ok(!response.body.includes("<script>"));
    assert.ok(!response.body.includes("wallet"));
    assert.ok(response.body.includes("SIMULATOR PLAYER"));
    const wrong = security.sign({
      role: "overlay",
      account: me.user.id,
      version: 0,
      exp: Date.now() + 10000,
    });
    assert.equal(
      (await s.app.inject({ url: `/v1/cards/${wrong}.svg` })).statusCode,
      401,
    );
    const expired = security.sign({
      role: "share-card",
      account: me.user.id,
      version: 0,
      exp: Date.now() - 1,
    });
    assert.equal(
      (await s.app.inject({ url: `/v1/cards/${expired}.svg` })).statusCode,
      401,
    );
    assert.equal(
      (
        await s.app.inject({
          url: url.replace(/\.[^.]+\.svg$/, ".tampered.svg"),
        })
      ).statusCode,
      401,
    );
    await s.db.query("UPDATE accounts SET privacy='hidden' WHERE id=$1", [
      me.user.id,
    ]);
    assert.equal((await s.app.inject({ url })).statusCode, 404);
    assert.equal((await mint(true)).statusCode, 409);
    await s.db.query("UPDATE accounts SET privacy='public' WHERE id=$1", [
      me.user.id,
    ]);
    assert.equal(
      (
        await s.app.inject({
          method: "DELETE",
          url: "/v1/me/share-card",
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal((await s.app.inject({ url })).statusCode, 404);
    response = await mint(true);
    assert.equal(response.statusCode, 200);
    const next = new URL(response.json().url).pathname;
    assert.equal((await s.app.inject({ url: next })).statusCode, 200);
    await s.db.query("UPDATE accounts SET deleted=true WHERE id=$1", [
      me.user.id,
    ]);
    assert.equal((await s.app.inject({ url: next })).statusCode, 404);
  } finally {
    await s.app.close();
  }
});
