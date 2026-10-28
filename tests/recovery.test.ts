import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { account, credit, reverse } from "../apps/api/economy.js";
import { World } from "../apps/api/world.js";
import { defaultConfig, transformPoint } from "../packages/shared/contracts.js";
test("world save restores stable avatar identity and cosmetics, temporary tracking and raids are not replayed", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "55", "Traveling Mage");
    const channel = {
      id: "55",
      owner_id: who.id,
      config: defaultConfig,
      connected: true,
    };
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["55", who.id, JSON.stringify(defaultConfig)],
    );
    const first = new World(db, channel);
    await first.join(who);
    first.state.avatars[0].x = 0.7;
    first.state.avatars[0].cosmetic = "star-crown";
    await db.query("UPDATE accounts SET cosmetic=$2 WHERE id=$1", [
      who.id,
      "star-crown",
    ]);
    await first.raid("recovery-raid", "77", "Visitors", 250);
    await first.save();
    const saved = (
      await db.query("SELECT state FROM world_saves WHERE channel_id=$1", [
        "55",
      ])
    ).rows[0].state;
    const recovered = new World(db, channel, saved);
    assert.equal(recovered.state.avatars[0].id, who.id);
    assert.equal(recovered.state.avatars[0].cosmetic, "star-crown");
    assert.equal(recovered.state.avatars[0].x, 0.7);
    assert.equal(recovered.state.raid, null);
    assert.equal(recovered.state.tracks.length, 0);
    assert.equal(recovered.running.size, 0);
  } finally {
    await db.close();
  }
});
test("ledger reversal is idempotent and corrects original scoring period", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "90", "Audited Hero");
    const award = await db.transaction((tx) =>
      credit(tx, who.id, null, 100, "to-reverse", "Verified quest"),
    );
    const original = (
      await db.query("SELECT score_at FROM ledger WHERE id=$1", [award.id])
    ).rows[0].score_at;
    await reverse(db, who.id, award.id, "Confirmed invalid evidence");
    await reverse(db, who.id, award.id, "Retry same review");
    const rows = (await db.query("SELECT * FROM ledger ORDER BY created_at"))
      .rows;
    assert.equal(rows.length, 2);
    assert.equal(
      Number((await db.query("SELECT balance FROM wallets")).rows[0].balance),
      0,
    );
    assert.equal(
      new Date(rows[1].score_at).toISOString(),
      new Date(original).toISOString(),
    );
    assert.equal(
      Number(
        (await db.query("SELECT sum(score_delta) AS score FROM ledger")).rows[0]
          .score,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
test("daily mint cap applies across distinct logical reward keys", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "91", "Capped Hero");
    await db.transaction((tx) =>
      credit(tx, who.id, null, 900, "cap-a", "Quest"),
    );
    await assert.rejects(
      db.transaction((tx) => credit(tx, who.id, null, 101, "cap-b", "Quest")),
      /Daily reward/,
    );
    assert.equal(
      Number((await db.query("SELECT balance FROM wallets")).rows[0].balance),
      900,
    );
  } finally {
    await db.close();
  }
});
test("source viewport maps cropped/mirrored source into arbitrary OBS canvas region", () => {
  const point = transformPoint(0.3, 0.5, {
    width: 1920,
    height: 1080,
    crop: [0.1, 0.1, 0.1, 0.1],
    mirror: true,
    rotation: "0",
    viewport: [0.1, 0.2, 0.5, 0.4],
  });
  assert.ok(Math.abs(point[0] - 0.475) < 0.000001);
  assert.equal(point[1], 0.4);
});
