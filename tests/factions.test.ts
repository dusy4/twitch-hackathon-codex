import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { account, credit, reverse } from "../apps/api/economy.js";
test("faction contribution follows membership at award time; switching factions cannot transfer old scores", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const who = await account(db, "faction-user", "Faction traveler");
    await db.query("INSERT INTO faction_members VALUES($1,$2)", [
      who.id,
      "violet",
    ]);
    const first = await db.transaction((tx) =>
      credit(tx, who.id, null, 100, "faction-first", "Quest"),
    );
    await db.query(
      "UPDATE faction_members SET faction_id=$2 WHERE account_id=$1",
      [who.id, "moss"],
    );
    await db.transaction((tx) =>
      credit(tx, who.id, null, 40, "faction-second", "Quest"),
    );
    let rows = (
      await db.query(
        "SELECT faction_id,sum(score_delta)::int AS score FROM ledger GROUP BY faction_id ORDER BY faction_id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { faction_id: "moss", score: 40 },
      { faction_id: "violet", score: 100 },
    ]);
    await reverse(db, who.id, first.id, "Audited correction");
    rows = (
      await db.query(
        "SELECT faction_id,sum(score_delta)::int AS score FROM ledger GROUP BY faction_id ORDER BY faction_id",
      )
    ).rows;
    assert.deepEqual(rows, [
      { faction_id: "moss", score: 40 },
      { faction_id: "violet", score: 0 },
    ]);
  } finally {
    await db.close();
  }
});
