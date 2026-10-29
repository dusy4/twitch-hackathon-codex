import { test } from "node:test";
import assert from "node:assert/strict";
import { relayEndpoint } from "../apps/web/relay-receiver.js";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";

test("relay watch endpoints require HTTPS or loopback and never echo private values on failure", () => {
  for (const value of [
    "https://relay.example/live/whep?signature=private",
    "http://127.0.0.1:8889/live/whep",
    "http://localhost:8889/live/whep",
  ])
    assert.equal(relayEndpoint(value).href, value);
  for (const value of [
    "http://relay.example/private/whep",
    "https://user:PRIVATE@relay.example/live/whep",
    "file:///PRIVATE/whep",
    "https://relay.example/PRIVATE",
    "https://relay.example/whep#PRIVATE",
    "PRIVATE",
  ]) {
    assert.throws(
      () => relayEndpoint(value),
      (error) => error instanceof Error && !error.message.includes("PRIVATE"),
    );
  }
});

test("only the relay receiver page permits external HTTPS/loopback media handshakes", async () => {
  const s = await createApp({
    db: Database.memory(),
    demo: true,
    timers: false,
  });
  try {
    const relay = await s.app.inject({ method: "GET", url: "/relay-receiver" });
    const ordinary = await s.app.inject({ method: "GET", url: "/dashboard" });
    assert.match(
      String(relay.headers["content-security-policy"]),
      /connect-src 'self' https: http:\/\/127\.0\.0\.1:\*/,
    );
    assert.doesNotMatch(
      String(ordinary.headers["content-security-policy"]),
      /http:\/\/127\.0\.0\.1:\*/,
    );
    assert.equal(relay.headers["referrer-policy"], "no-referrer");
    assert.equal(relay.headers["cache-control"], "no-store");
  } finally {
    await s.app.close();
  }
});
