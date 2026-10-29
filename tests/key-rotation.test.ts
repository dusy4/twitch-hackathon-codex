import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { rotateEncryptedTokens } from "../apps/api/key-rotation.js";
import { defaultConfig } from "../packages/shared/contracts.js";

test("offline key rotation dry-runs, atomically reencrypts both credential stores, revokes signed-link versions and rolls back corrupt input", async () => {
  const db = Database.memory(),
    oldKey = new Security(Buffer.alloc(32, 11)),
    newKey = new Security(Buffer.alloc(32, 12));
  try {
    await db.migrate();
    const who = await account(
      db,
      "rotation-fixture",
      "Synthetic operator",
      true,
    );
    const tokens = {
      access_token: "synthetic-access",
      refresh_token: "synthetic-refresh",
      expiresAt: 1234567,
    };
    const connection = oldKey.seal(tokens),
      channel = oldKey.seal(tokens);
    await db.query(
      "INSERT INTO twitch_connections(account_id,tokens) VALUES($1,$2)",
      [who.id, connection],
    );
    await db.query(
      "INSERT INTO channels(id,owner_id,config,tokens) VALUES('rotation-world',$1,$2,$3)",
      [who.id, JSON.stringify(defaultConfig), channel],
    );
    const dry = await rotateEncryptedTokens(db, oldKey, newKey);
    assert.equal(dry.applied, false);
    assert.equal(dry.connections, 1);
    assert.equal(dry.channels, 1);
    assert.equal(dry.auditId, null);
    assert.equal(
      (await db.query("SELECT tokens FROM twitch_connections")).rows[0].tokens,
      connection,
    );
    assert.equal(
      (await db.query("SELECT token_version FROM channels")).rows[0]
        .token_version,
      1,
    );
    await db.query("UPDATE channels SET tokens='corrupt-fixture'");
    await assert.rejects(rotateEncryptedTokens(db, oldKey, newKey, true));
    assert.equal(
      (await db.query("SELECT tokens FROM twitch_connections")).rows[0].tokens,
      connection,
      "A later failure must roll back earlier re-encryption writes",
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM audit")).rows[0].n,
      0,
    );
    await db.query("UPDATE channels SET tokens=$1", [channel]);
    const result = await rotateEncryptedTokens(
      db,
      oldKey,
      newKey,
      true,
      "local-fixture",
    );
    assert.equal(result.applied, true);
    const restoredConnection = (
      await db.query("SELECT tokens FROM twitch_connections")
    ).rows[0].tokens;
    const restoredChannel = (
      await db.query("SELECT tokens,token_version FROM channels")
    ).rows[0];
    assert.deepEqual(newKey.open(restoredConnection), tokens);
    assert.deepEqual(newKey.open(restoredChannel.tokens), tokens);
    assert.throws(() => oldKey.open(restoredConnection));
    assert.equal(restoredChannel.token_version, 2);
    const canonical = (
      await db.query(
        "SELECT reward_identity,share_version FROM accounts WHERE id=$1",
        [who.id],
      )
    ).rows[0];
    assert.equal(canonical.reward_identity, who.reward_identity);
    assert.equal(canonical.share_version, 1);
    const audit = (
      await db.query("SELECT operation,detail FROM audit WHERE id=$1", [
        result.auditId,
      ])
    ).rows[0];
    assert.equal(audit.operation, "security.key_rotated");
    assert.ok(!JSON.stringify(audit).includes("synthetic-access"));
  } finally {
    await db.close();
  }
});

test("rotation CLI rejects an apply without offline acknowledgement before opening a database", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/rotate-app-secret.ts", "--apply"],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        DATABASE_URL: "",
        OLD_APP_SECRET: "",
        NEW_APP_SECRET: "",
        REWARD_IDENTITY_SECRET: "",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stop every app\/worker process first/);
});
