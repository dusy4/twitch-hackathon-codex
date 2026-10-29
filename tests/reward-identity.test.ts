import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { account, credit } from "../apps/api/economy.js";
import { rewardIdentity } from "../apps/api/security.js";
import { createApp } from "../apps/api/server.js";

test("stable reward identity prevents a deleted/recreated account claiming again after APP_SECRET rotation; production fails closed without its separate key", async () => {
  const keys = [
    "APP_SECRET",
    "REWARD_IDENTITY_SECRET",
    "NODE_ENV",
    "DATABASE_URL",
    "PUBLIC_URL",
  ];
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  const db = Database.memory();
  try {
    process.env.NODE_ENV = "test";
    process.env.APP_SECRET = "a".repeat(43);
    process.env.REWARD_IDENTITY_SECRET = process.env.APP_SECRET; // Upgrade preserves the former HMAC key.
    await db.migrate();
    const first = await account(db, "123456789", "Before deletion");
    await db.transaction((tx) =>
      credit(
        tx,
        first.id,
        null,
        20,
        `first-join:${first.reward_identity}`,
        "First join",
      ),
    );
    await db.query(
      "UPDATE accounts SET deleted=true,twitch_id='deleted:'||id,name='Deleted traveler',privacy='hidden' WHERE id=$1",
      [first.id],
    );
    process.env.APP_SECRET = "b".repeat(43);
    const returned = await account(db, "123456789", "After key rotation");
    assert.notEqual(returned.id, first.id);
    assert.equal(returned.reward_identity, first.reward_identity);
    await db.transaction((tx) =>
      credit(
        tx,
        returned.id,
        null,
        20,
        `first-join:${returned.reward_identity}`,
        "First join retry",
      ),
    );
    assert.equal(
      Number(
        (await db.query("SELECT sum(delta) AS total FROM ledger")).rows[0]
          .total,
      ),
      20,
    );
    assert.equal(
      Number(
        (
          await db.query("SELECT balance FROM wallets WHERE account_id=$1", [
            returned.id,
          ])
        ).rows[0].balance,
      ),
      0,
    );
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://unused.invalid/fixture";
    process.env.PUBLIC_URL = "https://fixture.invalid";
    delete process.env.REWARD_IDENTITY_SECRET;
    assert.throws(
      () => rewardIdentity("123456789"),
      /stable REWARD_IDENTITY_SECRET/,
    );
    await assert.rejects(createApp({ db }), /stable REWARD_IDENTITY_SECRET/);
    process.env.REWARD_IDENTITY_SECRET = "too-short";
    await assert.rejects(createApp({ db }), /stable REWARD_IDENTITY_SECRET/);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await db.close();
  }
});
