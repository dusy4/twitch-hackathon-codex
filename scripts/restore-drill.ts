import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { Database } from "../apps/api/db.js";
import { account, buy, credit, equip } from "../apps/api/economy.js";
import { Security } from "../apps/api/security.js";
import { World } from "../apps/api/world.js";
import { rotateEncryptedTokens } from "../apps/api/key-rotation.js";
import { loadStructures } from "../apps/api/construction.js";
import { defaultConfig } from "../packages/shared/contracts.js";

// Deliberately restricted to the disposable native test cluster. Never targets a live database.
const adminURL = new URL(process.env.TEST_DATABASE_URL || "http://missing");
assert.equal(
  adminURL.protocol,
  "postgresql:",
  "Start through scripts/test-postgres.mjs",
);
assert.equal(adminURL.hostname, "127.0.0.1");
assert.equal(adminURL.port, "55432");
assert.equal(adminURL.pathname, "/postgres");
const suffix = randomUUID().replaceAll("-", "");
const names = [`rr_restore_source_${suffix}`, `rr_restore_target_${suffix}`];
const created: string[] = [];
const admin = new pg.Pool({ connectionString: adminURL.href, max: 1 });
const connection = (name: string) => {
  assert.ok(
    names.includes(name) &&
      /^rr_restore_(source|target)_[a-f0-9]{32}$/.test(name),
  );
  const url = new URL(adminURL);
  url.pathname = `/${name}`;
  return url;
};
const bin = resolve(".tools/postgres/pgsql/bin");
const directory = resolve(".data/restore-drills", suffix);
const dump = resolve(directory, "fixture.dump");
await mkdir(directory, { recursive: true });
const tool = async (program: string, db: string, args: string[]) => {
  const url = connection(db),
    password = decodeURIComponent(url.password);
  url.password = "";
  await new Promise<void>((ok, reject) => {
    const child = spawn(
      resolve(bin, `${program}.exe`),
      ["--dbname", url.href, ...args],
      {
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: password },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? ok()
        : reject(Error(`${program} failed (${code}): ${diagnostic}`)),
    );
  });
};
const tables = [
  "accounts",
  "wallets",
  "ledger",
  "inventory",
  "channels",
  "world_saves",
  "avatar_presence",
  "twitch_connections",
  "structures",
  "construction_receipts",
];
const snapshot = async (db: Database): Promise<Record<string, unknown[]>> =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await db.query(
            `SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows.map((row) => row.data),
      ]),
    ),
  );
let source: Database | undefined, target: Database | undefined;
try {
  for (const name of names) {
    connection(name); // Validate the exact generated identifier before SQL DDL.
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  source = await Database.open(connection(names[0]).href);
  await source.migrate();
  const who = await account(
    source,
    `restore-${suffix}`,
    "Restore drill traveler",
    true,
  );
  const channel = {
    id: `restore-${suffix}`,
    owner_id: who.id,
    config: defaultConfig,
  };
  await source.query(
    "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
    [channel.id, who.id, JSON.stringify(channel.config)],
  );
  const security = new Security(randomBytes(32));
  const fixtureTokens = {
    access_token: "synthetic-restore-fixture",
    refresh_token: "synthetic-refresh-fixture",
  };
  await source.query(
    "INSERT INTO twitch_connections(account_id,tokens) VALUES($1,$2)",
    [who.id, security.seal(fixtureTokens)],
  );
  await source.query("UPDATE channels SET tokens=$2 WHERE id=$1", [
    channel.id,
    security.seal(fixtureTokens),
  ]);
  await source.transaction((tx) =>
    credit(
      tx,
      who.id,
      channel.id,
      1000,
      `restore-award-${suffix}`,
      "Synthetic restore funding",
    ),
  );
  for (const id of ["mint-scout", "star-crown", "pocket-dragon"])
    await buy(source, who.id, id, `restore-buy-${id}`);
  await Promise.all([
    equip(source, who.id, "skin", "mint-scout"),
    equip(source, who.id, "hat", "star-crown"),
    equip(source, who.id, "pet", "pocket-dragon"),
  ]);
  // This drill deliberately avoids a first-join award after funding the daily cap.
  const canonical = (
    await source.query("SELECT * FROM accounts WHERE id=$1", [who.id])
  ).rows[0];
  const world = new World(source, channel, {
    avatars: [
      {
        ...canonical,
        x: 0.4,
        y: 0.7,
        animation: "idle",
        message: "",
        target: null,
        lastActive: Date.now(),
      },
    ],
  });
  await world.save();
  const structureId = randomUUID();
  await source.query(
    "INSERT INTO structures(id,channel_id,owner_id,title,x,y,blocks) VALUES($1,$2,$3,'Recovery tower',0.6,0.8,$4)",
    [
      structureId,
      channel.id,
      who.id,
      JSON.stringify([
        { x: 3, y: 0, z: 3, material: "riftstone", ownerId: who.id },
        { x: 3, y: 1, z: 3, material: "moss", ownerId: who.id },
      ]),
    ],
  );
  await source.query(
    "INSERT INTO construction_receipts(account_id,request_id,fingerprint,result) VALUES($1,$2,'synthetic-recovery',$3)",
    [who.id, randomUUID(), JSON.stringify({ structureId, deletedId: null })],
  );
  const expected = await snapshot(source);
  const backupBegan = performance.now();
  await tool("pg_dump", names[0], [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--file",
    dump,
  ]);
  const backupMs = Math.round(performance.now() - backupBegan);
  // Prove the restore comes from the archive, not a later query against the source.
  await source.query(
    "UPDATE accounts SET name='Changed after backup',equipment='{}'::jsonb WHERE id=$1",
    [who.id],
  );
  const restoreBegan = performance.now();
  await tool("pg_restore", names[1], [
    "--exit-on-error",
    "--single-transaction",
    "--no-owner",
    "--no-acl",
    dump,
  ]);
  const restoreMs = Math.round(performance.now() - restoreBegan);
  target = await Database.open(connection(names[1]).href);
  assert.deepEqual(
    await snapshot(target),
    expected,
    "Restored application records must exactly match the backup snapshot",
  );
  await target.migrate();
  assert.deepEqual(
    await snapshot(target),
    expected,
    "Startup upgrades must preserve restored records",
  );
  const mismatches = (
    await target.query(
      "SELECT w.account_id FROM wallets w LEFT JOIN ledger l ON l.account_id=w.account_id GROUP BY w.account_id,w.balance HAVING w.balance<>COALESCE(sum(l.delta),0) OR w.balance<0",
    )
  ).rows;
  assert.deepEqual(mismatches, []);
  assert.equal(
    Number(
      (
        await target.query("SELECT balance FROM wallets WHERE account_id=$1", [
          who.id,
        ])
      ).rows[0].balance,
    ),
    50,
  );
  const sealed = (
    await target.query(
      "SELECT tokens FROM twitch_connections WHERE account_id=$1",
      [who.id],
    )
  ).rows[0].tokens;
  assert.deepEqual(security.open(sealed), fixtureTokens);
  assert.throws(
    () => new Security(randomBytes(32)).open(sealed),
    "A database backup alone cannot decrypt provider tokens",
  );
  await assert.rejects(
    target.query("UPDATE ledger SET reason='tampered' WHERE account_id=$1", [
      who.id,
    ]),
    /append-only/,
  );
  const saved = (
    await target.query("SELECT state FROM world_saves WHERE channel_id=$1", [
      channel.id,
    ])
  ).rows[0].state;
  const recovered = new World(target, channel, saved);
  await recovered.refreshIdentities();
  assert.deepEqual(recovered.state.avatars[0].equipment, {
    skin: "mint-scout",
    hat: "star-crown",
    pet: "pocket-dragon",
  });
  recovered.state.structures = await loadStructures(target, channel.id);
  assert.equal(recovered.state.structures[0].id, structureId);
  assert.equal(recovered.state.structures[0].blocks.length, 2);
  const replacementKey = new Security(randomBytes(32));
  await target.query(
    "UPDATE channels SET tokens='corrupt-rotation-fixture' WHERE id=$1",
    [channel.id],
  );
  await assert.rejects(
    rotateEncryptedTokens(target, security, replacementKey, true),
  );
  assert.equal(
    (
      await target.query(
        "SELECT tokens FROM twitch_connections WHERE account_id=$1",
        [who.id],
      )
    ).rows[0].tokens,
    sealed,
    "Native PostgreSQL rolls back earlier token changes when another ciphertext fails",
  );
  await target.query("UPDATE channels SET tokens=$2 WHERE id=$1", [
    channel.id,
    security.seal(fixtureTokens),
  ]);
  const rotation = await rotateEncryptedTokens(
    target,
    security,
    replacementKey,
    true,
    "synthetic-native-drill",
  );
  assert.equal(rotation.connections, 1);
  assert.equal(rotation.channels, 1);
  const rotated = (
    await target.query(
      "SELECT tokens FROM twitch_connections WHERE account_id=$1",
      [who.id],
    )
  ).rows[0].tokens;
  assert.deepEqual(replacementKey.open(rotated), fixtureTokens);
  assert.throws(() => security.open(rotated));
  assert.equal(
    (
      await target.query("SELECT reward_identity FROM accounts WHERE id=$1", [
        who.id,
      ])
    ).rows[0].reward_identity,
    who.reward_identity,
  );
  const bytes = await readFile(dump);
  await writeFile(
    "artifacts/restore-drill.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        result: "passed",
        scope:
          "Synthetic isolated PostgreSQL 17 fixture; no production data or provider calls",
        archiveBytes: bytes.length,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
        backupMs,
        restoreMs,
        verified: [
          "exact records across ten tables",
          "startup migration preservation",
          "wallet/ledger reconciliation",
          "append-only trigger",
          "inventory and combined equipment",
          "saved world and community construction recovery",
          "synthetic token decryption with original key",
          "wrong key rejection",
          "post-backup source changes excluded",
          "native offline key rotation and corrupt-input rollback",
        ],
        rowCounts: Object.fromEntries(
          Object.entries(expected).map(([table, rows]) => [table, rows.length]),
        ),
        limitations: [
          "Small fixture, not a production RTO/RPO benchmark",
          "No managed backup, cloud failure or live provider revalidation",
          "Temporary fixture encryption key is discarded",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Isolated PostgreSQL dump/restore drill passed; artifacts/restore-drill.json",
  );
} finally {
  await source?.close();
  await target?.close();
  for (const name of created.reverse()) {
    connection(name);
    await admin.query(`DROP DATABASE "${name}"`);
  }
  await admin.end();
}
