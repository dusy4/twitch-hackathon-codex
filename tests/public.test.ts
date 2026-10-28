import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { publicDocument } from "../apps/api/ssr.js";
import { account, credit } from "../apps/api/economy.js";
test("generated OpenAPI includes actual registered routes and shared schema contracts", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 4)),
    demo: true,
    timers: false,
  });
  try {
    const response = await s.app.inject("/v1/openapi.json");
    assert.equal(response.statusCode, 200);
    const spec = response.json();
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/v1/worlds/{id}/actions"].post);
    assert.ok(spec.paths["/v1/creator/emergency-stop"].post);
    assert.ok(spec.components.schemas.SceneTrack.properties.anchor);
    assert.equal(
      (await s.app.inject("/v1/streamers/demo-world")).json().mode,
      "SIMULATOR",
    );
  } finally {
    await s.app.close();
  }
});
test("public SSR renders actual ledger rankings, escapes user text and hides private profiles", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "ssr", "<img src=x onerror=alert(1)>");
    await db.transaction((tx) =>
      credit(tx, who.id, null, 40, "ssr-award", "Quest"),
    );
    const template =
      '<html><head><title>Old</title><meta name="description" content="Old"></head><body><div id="app"></div></body></html>';
    let html = await publicDocument(
      template,
      "/leaderboard",
      db,
      "https://example.test",
    );
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("40"));
    await db.query("UPDATE accounts SET privacy='hidden' WHERE id=$1", [
      who.id,
    ]);
    html = await publicDocument(
      template,
      `/players/${who.id}`,
      db,
      "https://example.test",
    );
    assert.ok(html.includes("Private or unavailable"));
    assert.ok(!html.includes("onerror"));
  } finally {
    await db.close();
  }
});
