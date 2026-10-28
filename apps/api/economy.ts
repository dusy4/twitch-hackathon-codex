import { GameError } from "./compiler.js";
import { randomUUID, createHmac } from "node:crypto";
import { catalog } from "../../packages/shared/contracts.js";
import type { Database, SQL } from "./db.js";
export async function account(
  db: SQL,
  twitchId: string,
  name: string,
  demo = false,
) {
  return (
    await db.query(
      `INSERT INTO accounts(id,twitch_id,name,demo,reward_identity) VALUES($1,$2,$3,$4,$5) ON CONFLICT(twitch_id) DO UPDATE SET name=CASE WHEN accounts.deleted THEN accounts.name ELSE EXCLUDED.name END,reward_identity=CASE WHEN accounts.reward_identity='' THEN EXCLUDED.reward_identity ELSE accounts.reward_identity END RETURNING *`,
      [
        randomUUID(),
        twitchId,
        name.slice(0, 50),
        demo,
        createHmac(
          "sha256",
          process.env.APP_SECRET || "raidrift-local-simulator-reward-guard",
        )
          .update(twitchId)
          .digest("hex"),
      ],
    )
  ).rows[0];
}
export async function credit(
  tx: SQL,
  accountId: string,
  channelId: string | null,
  amount: number,
  key: string,
  reason: string,
) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000)
    throw Error("Invalid award");
  await tx.query(
    "INSERT INTO wallets(account_id) VALUES($1) ON CONFLICT DO NOTHING",
    [accountId],
  );
  await tx.query(
    "SELECT account_id FROM wallets WHERE account_id=$1 FOR UPDATE",
    [accountId],
  );
  const previous = (
    await tx.query("SELECT * FROM ledger WHERE logical_key=$1", [key])
  ).rows[0];
  if (previous) return previous;
  const daily = (
    await tx.query(
      "SELECT COALESCE(sum(delta),0) AS earned FROM ledger WHERE account_id=$1 AND category='earn' AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",
      [accountId],
    )
  ).rows[0];
  if (Number(daily.earned) + amount > 1000)
    throw new GameError("DAILY_REWARD_CAP", "Daily reward limit reached", 429);
  const faction =
    (
      await tx.query(
        "SELECT faction_id FROM faction_members WHERE account_id=$1",
        [accountId],
      )
    ).rows[0]?.faction_id || null;
  const row = (
    await tx.query(
      `INSERT INTO ledger(id,account_id,channel_id,delta,score_delta,category,reason,logical_key,faction_id) VALUES($1,$2,$3,$4,$4,'earn',$5,$6,$7) ON CONFLICT(logical_key) DO NOTHING RETURNING *`,
      [randomUUID(), accountId, channelId, amount, reason, key, faction],
    )
  ).rows[0];
  if (row)
    await tx.query(
      "UPDATE wallets SET balance=balance+$2,version=version+1 WHERE account_id=$1",
      [accountId, amount],
    );
  return row;
}
export async function buy(
  db: Database,
  who: string,
  itemId: string,
  key: string,
) {
  const item = catalog.find((i) => i.id === itemId);
  if (!item) throw Error("Unknown cosmetic");
  return db.transaction(async (tx) => {
    await tx.query(
      "SELECT account_id FROM wallets WHERE account_id=$1 FOR UPDATE",
      [who],
    );
    const previous = (
      await tx.query("SELECT * FROM ledger WHERE logical_key=$1", [
        `shop:${who}:${key}`,
      ])
    ).rows[0];
    if (previous) {
      if (previous.reason !== itemId)
        throw Error("Idempotency key already used");
      return previous;
    }
    const owns = await tx.query(
      "SELECT 1 FROM inventory WHERE account_id=$1 AND item_id=$2",
      [who, itemId],
    );
    if (owns.rows.length) throw new GameError("ALREADY_OWNED", "Already owned");
    const wallet = await tx.query(
      "UPDATE wallets SET balance=balance-$2,version=version+1 WHERE account_id=$1 AND balance>=$2 RETURNING balance",
      [who, item.price],
    );
    if (!wallet.rows.length)
      throw new GameError("INSUFFICIENT_SHARDS", "Not enough Shards");
    await tx.query("INSERT INTO inventory(account_id,item_id) VALUES($1,$2)", [
      who,
      itemId,
    ]);
    return (
      await tx.query(
        `INSERT INTO ledger(id,account_id,delta,category,reason,logical_key) VALUES($1,$2,$3,'spend',$4,$5) RETURNING *`,
        [randomUUID(), who, -item.price, itemId, `shop:${who}:${key}`],
      )
    ).rows[0];
  });
}
export async function reverse(
  db: Database,
  actor: string,
  id: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const original = (
      await tx.query("SELECT * FROM ledger WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!original || original.category !== "earn")
      throw Error("Only earnings may be reversed");
    const existing = await tx.query(
      "SELECT * FROM ledger WHERE reversal_of=$1",
      [id],
    );
    if (existing.rows.length) return existing.rows[0];
    const changed = await tx.query(
      "UPDATE wallets SET balance=balance-$2,version=version+1 WHERE account_id=$1 AND balance>=$2 RETURNING balance",
      [original.account_id, original.delta],
    );
    if (!changed.rows.length)
      throw Error("Insufficient balance for reversal; manual review required");
    const row = (
      await tx.query(
        `INSERT INTO ledger(id,account_id,channel_id,delta,score_delta,category,reason,logical_key,reversal_of,score_at,faction_id) VALUES($1,$2,$3,$4,$5,'adjustment',$6,$7,$8,$9,$10) RETURNING *`,
        [
          randomUUID(),
          original.account_id,
          original.channel_id,
          -Number(original.delta),
          -Number(original.score_delta),
          reason,
          `reverse:${id}`,
          id,
          original.score_at,
          original.faction_id,
        ],
      )
    ).rows[0];
    await tx.query("INSERT INTO audit VALUES($1,$2,$3,$4,now())", [
      randomUUID(),
      actor,
      "ledger.reverse",
      JSON.stringify({ id, reason }),
    ]);
    return row;
  });
}
