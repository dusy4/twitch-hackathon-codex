import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { defaultConfig } from "../packages/shared/contracts.js";
test("verified cross-world entry transfers one persistent equipped avatar and never replays a second join award", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 12)),
    demo: true,
    timers: false,
  });
  try {
    const owner = await account(s.db, "other-host", "Other creator", true);
    await s.db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["other-world", owner.id, JSON.stringify(defaultConfig)],
    );
    const viewer = await account(s.db, "traveler", "Traveling Knight", true);
    await s.db.query("UPDATE accounts SET cosmetic=$2 WHERE id=$1", [
      viewer.id,
      "star-crown",
    ]);
    viewer.cosmetic = "star-crown";
    const first = await s.world("demo-world");
    const loads = await Promise.all(
      Array.from({ length: 25 }, () => s.world("other-world")),
    );
    const second = loads[0];
    assert.ok(
      loads.every((w) => w === second),
      "Concurrent cold-room requests share one authoritative world",
    );
    await first.action(viewer, "dance", "source-dance");
    await first.save();
    assert.equal(first.state.avatars.length, 1);
    await second.join(viewer);
    assert.equal(first.state.avatars.length, 0);
    assert.equal(first.running.size, 0);
    assert.equal(second.state.avatars[0].id, viewer.id);
    assert.equal(second.state.avatars[0].cosmetic, "star-crown");
    assert.equal(
      Number(
        (
          await s.db.query("SELECT balance FROM wallets WHERE account_id=$1", [
            viewer.id,
          ])
        ).rows[0].balance,
      ),
      20,
    );
    await first.save();
    s.worlds.delete("demo-world");
    assert.equal((await s.world("demo-world")).state.avatars.length, 0);
    assert.equal(
      (
        await s.db.query("SELECT * FROM avatar_presence WHERE account_id=$1", [
          viewer.id,
        ])
      ).rows[0].channel_id,
      "other-world",
    );
  } finally {
    await s.app.close();
  }
});
