# DATA — persistent identity, quests, economies, rankings

## Golden rule
Twitch numerical ID is a stable external key; system player UUID is internal key. All wallet changes originate from server-authenticated immutable transactions with unique idempotency keys and clear award reason. Stats must survive restarts, seasons and spending. A viewer's "earnings" are not equal to spendable balance.

## Proposed relational tables
- `accounts`: UUID PK, created_at, last_seen_at, status, privacy_mode, display_opt_out, email_optional; separate `twitch_identities` with Twitch numeric user ID UNIQUE, account ID, token connection state/refresh metadata encrypted, name cache, linked_at. Include safe unlink/relink and idempotent chat-created account -> OAuth linked account reconciliation.
- `streamer_channels`: Twitch channel ID PK, owner account UUID FK, public slug, config JSON validated, overlay token hash, live state, faction/world ID, camera processing consent and retention rules.
- `avatars`: UUID PK, account FK UNIQUE or per-player slot, skin id, palette, animation class, XP/level, cosmetics JSON; `avatar_locations`: room FK, position/rotation, world epoch, last-seen timestamp/TTL.
- `worlds`: UUID, streamer FK, status, world version, scene metadata; `world_sessions`: event stream start/end, video source transform, epoch, vision consent state; `scene_tracks`: **ephemeral Redis by default**, per session track ID/class/box/mask pointer/confidence/last_seen; expire aggressively, do not persist personal identity.
- `raids`: UUID, source Twitch ID, destination Twitch ID, Twitch event ID UNIQUE, reported viewers, start timestamp, status, portal animation config; `raid_participants`: raid FK/account FK with actual verified arrival mechanism, claim timestamp, one record per participant, `UNIQUE (raid_id, account_id)`.
- `action_requests`: UUID, actor account/room FK, prompt short-retained, compiler version, approved plan JSON, moderation/queue state, target scene epoch and timestamps, cost; `action_events`: action ID, sequential tick, server outcome, idempotency.
- `quests`: UUID, creator or system owner, world channel, template/conditions, verification_type ENUM('authoritative_state','visual_decision','streamer_attested'), rewards and eligibility rules, active interval, max completions; `quest_attempts`: account/team/world FK, quest FK, status, evidence count, correlation key, created/finished timestamps; `quest_evidence`: ephemeral signed pointer/hash + frame time/model version/question/result + expiry; strong privacy protections and TTL.
- `seasons`: UUID, start/end timestamps UTC, title, status, scoring policy; `season_scores`: season ID/account ID, verified score, tie-break timestamp, updated_at; `score_events`: source award ID, season ID, account ID, points, timestamp, unique source id. Weekly/leaderboard category rollups can be materialized and invalidated by ledger events.
- `wallets`: account UUID PK, current spendable balance BIGINT NOT NULL CHECK(balance >= 0), updated_at, version; `wallet_transactions`: UUID, account ID, delta BIGINT, action ENUM('earn','spend','refund','adjustment'), reason, external logical source ID, idempotency key UNIQUE, season ID, timestamp, ref to quest/raid/order; append-only; admin corrections are compensating transactions, not edits.
- `inventory_items`: owned digital cosmetic counts and ownership, locked/tradable flag (default no trading), obtained via transaction references; `shop_orders` with unique idempotency key and atomic debit.
- `achievements`, `account_achievements`, `streamer_contributions`, `factions`, `faction_membership`, `faction_scores`, `moderation_actions`, `audit_log`, `outbox_events`, `system_alerts`.

## Transactions and double-spend protection
- For credit: verify unique quest completion eligibility, create `wallet_transactions` with idempotency key `award:quest:<attempt-id>:<account-id>`, atomically increment wallet balance, append `score_event`, commit, enqueue rank update via transactional outbox. On duplicate request return existing transaction. Reject awards based only on client's reported completion.
- For spending: row lock wallet or compare-and-swap wallet version; ensure sufficient funds; debit once; add cosmetic item in the same transaction; fail atomically.
- For disputes/admin errors: append reverse compensating transaction; preserve original history; recalculate season scores where corrections affect earned scores.
- For team quest: generate per-player ledger entries with `UNIQUE (quest_attempt, player)`, only for eligible active participants.

## Example SQL (illustrative; migrations must be expanded)
```sql
CREATE TABLE wallets (
  account_id uuid PRIMARY KEY,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wallet_transactions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES wallets(account_id),
  delta bigint NOT NULL CHECK(delta <> 0),
  category text NOT NULL CHECK(category IN ('earn','spend','refund','adjustment')),
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  season_id uuid NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_tx_account_time_idx ON wallet_transactions(account_id, occurred_at DESC);
-- add canonical FK constraints, check against event types, audit + readonly permissions.
```

## Leaderboard queries and semantics
- Show **earned** Shards for weekly/monthly/season/all-time ranks, not `wallet.balance`; weekly starts Monday 00:00 UTC (configurable site policy), month UTC, season DB-defined boundary. Season competitive `score` can differ from actual Shards rewards; label clearly. Streamer/faction score from `streamer_contributions`, not treating a broadcaster as a viewer by default.
- Materialize `leaderboard_snapshots` (scope, type, period, subject, score, rank, first_reached_at, updated_at) for fast SSR; incrementally update on committed ledger events; deterministic sort (`score DESC`, `first_reached_at ASC`, `subject_id ASC`). Query fresh immediately after award for player's rank while global snapshot has a small documented lag. Redis cache, invalidation and websocket updates.
- Profile: show user display name and Twitch-linked banner only when visible; users can opt out of rankings or appear pseudonymously; account deletion handles PII removal/score policy while preserving game economic reconciliation.
- Anti-farm: unique reward source ID, quest per-session cap, repeat intervals, role eligibility, disconnected idle avatars don't earn passive rewards without explicit opt-in rules, synthetic viewers never credited, rate anomaly auditing and bounded creator adjustments.
