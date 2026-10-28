import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "../apps/api/db.js";
import { account, credit, buy } from "../apps/api/economy.js";
const url = process.env.TEST_DATABASE_URL;
test(
  "native PostgreSQL: independent connections enforce idempotent awards and concurrent spend",
  { skip: !url },
  async () => {
    const first = await Database.open(url),
      second = await Database.open(url);
    try {
      await first.migrate();
      const who = await account(
        first,
        `pg-${randomUUID()}`,
        "Native PostgreSQL test",
      );
      const key = `pg-award:${randomUUID()}`;
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          (i % 2 ? first : second).transaction((tx) =>
            credit(tx, who.id, null, 500, key, "Native duplicate test"),
          ),
        ),
      );
      assert.equal(
        Number(
          (
            await first.query(
              "SELECT balance FROM wallets WHERE account_id=$1",
              [who.id],
            )
          ).rows[0].balance,
        ),
        500,
      );
      assert.equal(
        (await first.query("SELECT * FROM ledger WHERE logical_key=$1", [key]))
          .rows.length,
        1,
      );
      const outcomes = await Promise.allSettled([
        buy(first, who.id, "star-crown", randomUUID()),
        buy(second, who.id, "pocket-dragon", randomUUID()),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      const balance = Number(
        (
          await first.query("SELECT balance FROM wallets WHERE account_id=$1", [
            who.id,
          ])
        ).rows[0].balance,
      );
      assert.ok(balance === 0 || balance === 200);
      assert.equal(
        (
          await first.query("SELECT * FROM inventory WHERE account_id=$1", [
            who.id,
          ])
        ).rows.length,
        1,
      );
      const cap = await Promise.allSettled([
        first.transaction((tx) =>
          credit(tx, who.id, null, 400, `cap-a-${randomUUID()}`, "Cap A"),
        ),
        second.transaction((tx) =>
          credit(tx, who.id, null, 400, `cap-b-${randomUUID()}`, "Cap B"),
        ),
      ]);
      assert.equal(cap.filter((o) => o.status === "fulfilled").length, 1);
      const cappedBalance = Number(
        (
          await first.query("SELECT balance FROM wallets WHERE account_id=$1", [
            who.id,
          ])
        ).rows[0].balance,
      );
      await assert.rejects(
        first.transaction(async (tx) => {
          await credit(
            tx,
            who.id,
            null,
            101,
            `rollback-${randomUUID()}`,
            "Rollback",
          );
          throw Error("abort");
        }),
      );
      assert.equal(
        Number(
          (
            await first.query(
              "SELECT balance FROM wallets WHERE account_id=$1",
              [who.id],
            )
          ).rows[0].balance,
        ),
        cappedBalance,
      );
    } finally {
      await first.close();
      await second.close();
    }
  },
);
