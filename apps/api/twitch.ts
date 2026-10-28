import { GameError } from "./compiler.js";
import type { Database } from "./db.js";
import type { Security } from "./security.js";
export class Twitch {
  constructor(
    private db: Database,
    private security: Security,
    private fetcher: typeof fetch = fetch,
  ) {}
  get ready() {
    return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
  }
  async token(params: Record<string, string>) {
    const res = await this.fetcher("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        client_id: process.env.TWITCH_CLIENT_ID!,
        client_secret: process.env.TWITCH_CLIENT_SECRET!,
        ...params,
      }),
    });
    if (!res.ok)
      throw new GameError(
        "TWITCH_AUTH",
        "Twitch authorization failed. Reconnect your account.",
        res.status === 400 || res.status === 401 ? 401 : 502,
      );
    return res.json() as Promise<any>;
  }
  async user(access: string) {
    const res = await this.fetcher("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${access}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw new GameError(
        "TWITCH_AUTH",
        "Twitch token is no longer valid",
        res.status === 401 ? 401 : 502,
      );
    const identity = (await res.json()) as any;
    if (
      identity.client_id !== process.env.TWITCH_CLIENT_ID ||
      !/^\d+$/.test(identity.user_id)
    )
      throw new GameError("TWITCH_AUTH", "Unexpected OAuth identity", 401);
    return identity;
  }
  async access(channel: any) {
    const connection = channel.owner_id
      ? (
          await this.db.query(
            "SELECT tokens FROM twitch_connections WHERE account_id=$1",
            [channel.owner_id],
          )
        ).rows[0]
      : null;
    let tokens = this.security.open(connection?.tokens || channel.tokens);
    if (tokens.expiresAt < Date.now() + 60000) {
      const data = await this.token({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      });
      tokens = { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
      await this.db.query("UPDATE channels SET tokens=$2 WHERE id=$1", [
        channel.id,
        this.security.seal(tokens),
      ]);
      if (channel.owner_id)
        await this.db.query(
          "UPDATE twitch_connections SET tokens=$2 WHERE account_id=$1",
          [channel.owner_id, this.security.seal(tokens)],
        );
    }
    return tokens.access_token as string;
  }
  async validateConnections() {
    if (!this.ready) return [];
    const stale = (
      await this.db.query(
        "SELECT tc.*,a.twitch_id FROM twitch_connections tc JOIN accounts a ON a.id=tc.account_id WHERE tc.validated_at<now()-interval '50 minutes'",
      )
    ).rows;
    const revoked: string[] = [];
    for (const c of stale) {
      try {
        let tokens = this.security.open(c.tokens);
        if (tokens.expiresAt < Date.now() + 60000) {
          const refreshed = await this.token({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          });
          tokens = {
            ...refreshed,
            expiresAt: Date.now() + refreshed.expires_in * 1000,
          };
          const encrypted = this.security.seal(tokens);
          await this.db.query(
            "UPDATE twitch_connections SET tokens=$2 WHERE account_id=$1",
            [c.account_id, encrypted],
          );
          await this.db.query(
            "UPDATE channels SET tokens=$2 WHERE owner_id=$1",
            [c.account_id, encrypted],
          );
        }
        const identity = await this.user(tokens.access_token);
        if (identity.user_id !== c.twitch_id)
          throw new GameError("TWITCH_AUTH", "Identity mismatch", 401);
        await this.db.query(
          "UPDATE twitch_connections SET validated_at=now() WHERE account_id=$1",
          [c.account_id],
        );
      } catch (error) {
        if (error instanceof GameError && error.status === 401) {
          await this.localUnlink(c.account_id);
          revoked.push(c.twitch_id);
        }
      }
    }
    return revoked;
  }
  async localUnlink(accountId: string) {
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM twitch_connections WHERE account_id=$1", [
        accountId,
      ]);
      await tx.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
      await tx.query(
        "UPDATE channels SET connected=false,tokens=null,token_version=token_version+1,config=jsonb_set(jsonb_set(config,'{vision}','false'::jsonb),'{paused}','true'::jsonb) WHERE owner_id=$1",
        [accountId],
      );
    });
  }
  async unlink(accountId: string) {
    const connection = (
      await this.db.query(
        "SELECT tokens FROM twitch_connections WHERE account_id=$1",
        [accountId],
      )
    ).rows[0];
    try {
      if (connection && this.ready) {
        const tokens = this.security.open(connection.tokens);
        await this.fetcher("https://id.twitch.tv/oauth2/revoke", {
          method: "POST",
          body: new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID!,
            token: tokens.access_token,
          }),
          signal: AbortSignal.timeout(10000),
        });
      }
    } catch {
      /* Local privacy cleanup must not depend on provider availability. */
    }
    await this.localUnlink(accountId);
  }
  async appToken() {
    return (await this.token({ grant_type: "client_credentials" }))
      .access_token as string;
  }
  async reconcile(channel: any, callback: string) {
    if (!callback.startsWith("https://"))
      throw new GameError(
        "HTTPS_REQUIRED",
        "EventSub requires a public HTTPS callback.",
        409,
      );
    const token = await this.appToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID!,
      "Content-Type": "application/json",
    };
    const existing = await this.fetcher(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      { headers, signal: AbortSignal.timeout(10000) },
    );
    if (!existing.ok)
      throw new GameError(
        "TWITCH_SUBS",
        "Could not inspect Twitch subscriptions",
        502,
      );
    const list = (await existing.json()) as any;
    const specs = [
      {
        type: "channel.raid",
        version: "1",
        condition: { to_broadcaster_user_id: channel.id },
      },
      {
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: channel.id, user_id: channel.id },
      },
      {
        type: "user.authorization.revoke",
        version: "1",
        condition: { client_id: process.env.TWITCH_CLIENT_ID! },
      },
    ];
    const statuses = [];
    for (const spec of specs) {
      if (
        list.data?.some(
          (s: any) =>
            s.type === spec.type &&
            JSON.stringify(s.condition) === JSON.stringify(spec.condition) &&
            s.transport?.callback === callback,
        )
      ) {
        statuses.push({ type: spec.type, status: "exists" });
        continue;
      }
      const result = await this.fetcher(
        "https://api.twitch.tv/helix/eventsub/subscriptions",
        {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            ...spec,
            transport: {
              method: "webhook",
              callback,
              secret: process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET,
            },
          }),
        },
      );
      statuses.push({
        type: spec.type,
        status: result.status,
        ok: result.ok || result.status === 409,
      });
    }
    return statuses;
  }
  async disconnect(channel: any) {
    try {
      if (channel.tokens && this.ready) {
        const access = await this.access(channel);
        const appToken = await this.appToken();
        const headers = {
          Authorization: `Bearer ${appToken}`,
          "Client-Id": process.env.TWITCH_CLIENT_ID!,
        };
        const list = await this.fetcher(
          "https://api.twitch.tv/helix/eventsub/subscriptions",
          { headers, signal: AbortSignal.timeout(10000) },
        );
        if (list.ok) {
          for (const s of ((await list.json()) as any).data || []) {
            if (
              s.condition?.broadcaster_user_id === channel.id ||
              s.condition?.to_broadcaster_user_id === channel.id
            )
              await this.fetcher(
                `https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(s.id)}`,
                {
                  method: "DELETE",
                  headers,
                  signal: AbortSignal.timeout(10000),
                },
              );
          }
        }
        await this.fetcher("https://id.twitch.tv/oauth2/revoke", {
          method: "POST",
          body: new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID!,
            token: access,
          }),
          signal: AbortSignal.timeout(10000),
        });
      }
    } catch {
      /* Provider outages do not prevent immediate local revocation. */
    }
    if (channel.owner_id) await this.localUnlink(channel.owner_id);
    await this.db.query(
      "UPDATE channels SET connected=false,tokens=null,token_version=token_version+1,config=jsonb_set(jsonb_set(config,'{vision}','false'::jsonb),'{paused}','true'::jsonb) WHERE id=$1",
      [channel.id],
    );
  }
}
