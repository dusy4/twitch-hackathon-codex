import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { verifyExtensionJwt } from "../apps/api/extension.js";

const secret = Buffer.alloc(32, 37).toString("base64");
function token(claims: Record<string, unknown> = {}, alg = "HS256") {
  const data = [
    Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "viewer",
        channel_id: "555",
        opaque_user_id: "Ualice",
        user_id: "123",
        ...claims,
      }),
    ).toString("base64url"),
  ].join(".");
  return `${data}.${createHmac("sha256", Buffer.from(secret, "base64")).update(data).digest("base64url")}`;
}
test("Extension JWT requires decoded HS256 secret, signature, expiry, viewer role and channel/identity claims", () => {
  assert.equal(verifyExtensionJwt(token(), secret).user_id, "123");
  for (const bad of [
    token({ exp: 1 }),
    token({ role: "external" }),
    token({ channel_id: "" }),
    token({ opaque_user_id: "" }),
    token({}, "none"),
    token().replace(/.$/, "!"),
  ])
    assert.throws(
      () => verifyExtensionJwt(bad, secret),
      /valid Twitch Extension/,
    );
  assert.throws(() => verifyExtensionJwt(token(), ""), /not configured/);
  assert.throws(
    () => verifyExtensionJwt(token(), Buffer.alloc(32, 5).toString("base64")),
    /valid Twitch/,
  );
});
test("EBS joins chat identity, authorizes channel, isolates three steering heroes, handles opaque identity and limits", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 8)),
    timers: false,
    demo: true,
    debugRoom: "demo-world",
    extensionOwnerId: "555",
    extensionClientId: "client",
    extensionSecret: secret,
  });
  mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    const w = await s.world("demo-world");
    const alice = await account(s.db, "123", "Alice");
    await w.join(alice);
    const call = (
      route: string,
      payload?: unknown,
      jwt = token(),
      origin = "https://client.ext-twitch.tv",
    ) =>
      s.app.inject({
        method: payload === undefined ? "GET" : "POST",
        url: `/v1/ext/${route}`,
        headers: { authorization: `Bearer ${jwt}`, origin },
        ...(payload === undefined ? {} : { payload: payload as any }),
      });
    const joined = await call("join", {});
    assert.equal(joined.statusCode, 200, joined.body);
    assert.equal(joined.json().hero.id, alice.id);
    assert.equal(w.state.avatars.length, 1);
    assert.equal(
      joined.headers["access-control-allow-origin"],
      "https://client.ext-twitch.tv",
    );
    assert.equal(
      (await call("state", undefined, token(), "https://evil.ext-twitch.tv"))
        .statusCode,
      403,
    );
    assert.equal(
      (await call("join", {}, token({ channel_id: "777" }))).statusCode,
      404,
    );
    assert.equal(
      (await call("steer", { x: 0, y: 1, actorId: alice.id })).statusCode,
      400,
    );
    mock.timers.setTime(Date.now() + 1001);
    const tokens = [
      token(),
      token({ user_id: "124", opaque_user_id: "Ubob" }),
      token({ user_id: "125", opaque_user_id: "Ucharlie" }),
    ];
    const joined3 = await Promise.all(tokens.map((t) => call("join", {}, t)));
    assert.ok(joined3.every((r) => r.statusCode === 200));
    assert.equal(w.state.avatars.length, 3);
    const directions = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: -1 },
    ];
    const results = await Promise.all(
      tokens.map((t, i) => call("steer", directions[i], t)),
    );
    assert.ok(
      results.every((r) => r.statusCode === 200),
      results.map((r) => r.body).join("\n"),
    );
    assert.equal(new Set(results.map((r) => r.json().hero.id)).size, 3);
    results.forEach((r, i) =>
      assert.equal(r.json().hero.steer.x, directions[i].x),
    );
    assert.equal((await call("steer", { x: 0, y: 0 })).statusCode, 429);
    mock.timers.setTime(Date.now() + 1001);
    const emote = await call("emote", { emote: "wave" });
    assert.equal(emote.statusCode, 200, emote.body);
    assert.equal(emote.json().hero.steer, null);
    assert.equal(emote.json().hero.animation, "wave");
    const opaque = token({ user_id: undefined, opaque_user_id: "Uprivate" });
    const privateHero = await call("join", {}, opaque);
    assert.equal(privateHero.statusCode, 200, privateHero.body);
    assert.match(privateHero.json().hero.name, /^viewer-/);
    const oldId = privateHero.json().hero.id;
    assert.equal(
      (await s.db.query("SELECT 1 FROM ledger WHERE account_id=$1", [oldId]))
        .rows.length,
      0,
      "Opaque identities cannot farm join rewards",
    );
    const shared = token({ user_id: "999", opaque_user_id: "Uprivate" });
    const sharedHero = await call("join", {}, shared);
    assert.equal(sharedHero.statusCode, 200, sharedHero.body);
    assert.equal(sharedHero.json().hero.id, oldId);
    const oldAccount = (
      await s.db.query("SELECT twitch_id FROM accounts WHERE id=$1", [oldId])
    ).rows[0];
    assert.equal(oldAccount.twitch_id, "999");
    mock.timers.setTime(Date.now() + 1001);
    const merge = token({ user_id: "123", opaque_user_id: "Uexisting" });
    const extra = await call(
      "join",
      {},
      token({ user_id: undefined, opaque_user_id: "Uexisting" }),
    );
    const merged = await call("join", {}, merge);
    assert.equal(merged.json().hero.id, alice.id);
    assert.ok(!w.state.avatars.some((a) => a.id === extra.json().hero.id));
    const preflight = await s.app.inject({
      method: "OPTIONS",
      url: "/v1/ext/steer",
      headers: {
        origin: "https://client.ext-twitch.tv",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(
      (await s.app.inject({ url: "/v1/ext/state" })).statusCode,
      401,
    );
    w.state.tracks = [
      {
        id: "spot3",
        class: "spot 3",
        attributes: ["sofa"],
        box: [0.1, 0.2, 0.3, 0.4],
        confidence: 1,
        seenAt: Date.now(),
      },
    ];
    const state = (await call("state")).json();
    assert.equal(state.targets[0].number, 3);
    assert.equal(state.targets[0].label, "sofa");
    w.state.tracks.push({
      id: "red-chair",
      class: "chair",
      attributes: ["red"],
      box: [0.2, 0.2, 0.2, 0.2],
      confidence: 1,
      seenAt: Date.now(),
    });
    assert.equal(
      (await call("state")).json().targets[1].label,
      "chair",
      "An object's appearance attributes are not its target noun",
    );
    mock.timers.setTime(Date.now() + 1001);
    const prompt = await call("prompt", {
      prompt: "go to 3 and dance",
      targetHint: "spot3",
    });
    assert.equal(prompt.statusCode, 200, prompt.body);
    assert.equal(w.running.get(alice.id)!.plan.steps[0].target, "spot3");
  } finally {
    mock.timers.reset();
    await s.app.close();
  }
});

test("SSE uses bearer headers, expires with JWT and closes on server shutdown", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 8)),
    timers: false,
    demo: true,
    debugRoom: "demo-world",
    extensionOwnerId: "555",
    extensionSecret: secret,
  });
  await s.app.listen({ port: 0, host: "127.0.0.1" });
  const port = (s.app.server.address() as { port: number }).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/ext/events`, {
      headers: {
        Authorization: `Bearer ${token({ exp: Math.floor(Date.now() / 1000) + 2 })}`,
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /event: state/);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, 4000);
    while (!(await reader.read()).done) {
      /* expiration closes the stream */
    }
    clearTimeout(deadline);
    assert.equal(
      timedOut,
      false,
      "JWT expiry, rather than the test deadline, must close SSE",
    );
    const active = await fetch(`http://127.0.0.1:${port}/v1/ext/events`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const activeReader = active.body!.getReader();
    await activeReader.read();
    const closing = s.app.close();
    while (!(await activeReader.read()).done) {
      /* preClose ends active SSE */
    }
    await closing;
  } finally {
    await s.app.close();
  }
});
