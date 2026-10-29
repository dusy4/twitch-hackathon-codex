import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Security } from "./security.js";

/** Offline maintenance only. Never logs or returns decrypted provider credentials. */
export async function rotateEncryptedTokens(
  db: Database,
  oldKey: Security,
  newKey: Security,
  apply = false,
  actor = "maintenance-cli",
) {
  return db.transaction(async (tx) => {
    const connections = (
      await tx.query(
        "SELECT account_id,tokens FROM twitch_connections ORDER BY account_id FOR UPDATE",
      )
    ).rows;
    const channels = (
      await tx.query(
        "SELECT id,tokens FROM channels WHERE tokens IS NOT NULL ORDER BY id FOR UPDATE",
      )
    ).rows;
    for (const row of connections) {
      const replacement = newKey.seal(oldKey.open(row.tokens));
      if (apply)
        await tx.query(
          "UPDATE twitch_connections SET tokens=$2 WHERE account_id=$1",
          [row.account_id, replacement],
        );
    }
    for (const row of channels) {
      const replacement = newKey.seal(oldKey.open(row.tokens));
      if (apply)
        await tx.query("UPDATE channels SET tokens=$2 WHERE id=$1", [
          row.id,
          replacement,
        ]);
    }
    let auditId: string | null = null;
    if (apply) {
      // Explicitly revoke old overlay/native/card links, including after a key rollback.
      await tx.query("UPDATE channels SET token_version=token_version+1");
      await tx.query("UPDATE accounts SET share_version=share_version+1");
      auditId = randomUUID();
      await tx.query(
        "INSERT INTO audit(id,actor_id,operation,detail) VALUES($1,$2,'security.key_rotated',$3)",
        [
          auditId,
          actor.slice(0, 100),
          JSON.stringify({
            connections: connections.length,
            channels: channels.length,
            signedLinksRevoked: true,
          }),
        ],
      );
    }
    return {
      applied: apply,
      connections: connections.length,
      channels: channels.length,
      signedLinksRevoked: apply,
      auditId,
    };
  });
}
