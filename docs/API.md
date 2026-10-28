# API CONTRACTS — proposed HTTP, WebSocket, external event mapping

All examples are proposed RaidRift endpoints; they are NOT existing Twitch endpoints. Version APIs (`/v1`), use Zod validators and OpenAPI generation, and only accept identities from authenticated sessions or verified EventSub (never arbitrary client `user_id`). API errors include `code`, `message`, `requestId`. Use unique `idempotencyKey` for mutation retries.

## Public HTTP
| Route | Access | Purpose |
| --- | --- | --- |
| `GET /v1/live` | public | Active opt-in worlds summary |
| `GET /v1/leaderboard?scope=global&period=week&type=players&cursor=...` | public | Paginated verified leaderboard, stable ranks and update timestamps |
| `GET /v1/leaderboard?scope=channel&channelId=...&period=season&type=players` | public | Streamer community leaderboard |
| `GET /v1/players/:publicId` | public | Profile, avatar & public stats based on privacy settings |
| `GET /v1/streamers/:channelId` | public | Channel world details |
| `GET /v1/quests?channelId=...` | public | Visible quests without privileged personal evidence |
| `GET /v1/seasons` | public | Current and archived competitive seasons |

## Authenticated viewer
`GET /v1/me`, `PATCH /v1/me/profile`, `GET /v1/me/inventory`, `POST /v1/worlds/:channelId/join`, `POST /v1/worlds/:channelId/actions` (`prompt` or typed action), `POST /v1/me/cosmetics/:id/equip`, `GET /v1/me/ledger`, `POST /v1/me/opt-out`. Twitch Authorization Code + PKCE where applicable, same-site HttpOnly secure cookies, CSRF defenses for cookie auth and strict CORS.

## Authenticated streamer
`GET/PATCH /v1/creator/config`, `POST /v1/creator/overlay-token/rotate`, `POST /v1/creator/test-raid` (clearly tagged TEST), `POST /v1/creator/quests`, `PATCH /v1/creator/quests/:id`, `POST /v1/creator/quests/:id/enable`, `POST /v1/creator/moderation/ban`, `POST /v1/creator/emergency-stop`, `GET /v1/creator/health`, `POST /v1/creator/vision/enable`, `DELETE /v1/creator/vision/data`. Never expose Twitch API token or OpenAI key in browser.

## WebSocket envelope
```json
{
  "type": "action.started",
  "version": 1,
  "eventId": "uuid",
  "roomId": "twitch-channel-id",
  "serverTime": "2026-10-27T21:15:00.000Z",
  "sceneEpoch": 34,
  "tick": 88712,
  "payload": {
    "actionId": "uuid",
    "actorId": "internal-uuid",
    "kind": "navigate",
    "targetTrackId": "track-8e4",
    "trajectory": [{"tMs": 0, "x": 0.2, "y": 0.8}, {"tMs": 1500, "x": 0.67, "y": 0.58}],
    "audioCue": "avatar_sprint_01"
  }
}
```
Events: `connection.ready`, `world.snapshot`, `world.delta`, `raid.started`, `raid.portal_phase`, `raid.participants_claimed`, `raid.completed`, `avatar.spawned`, `avatar.state`, `action.accepted/started/step/completed/failed`, `vision.track_updated/lost`, `quest.started/evidence_updated/completed/failed`, `wallet.balance_changed`, `leaderboard.changed`, `system.degraded`, `moderation.kick`. Include sequence numbers, ACK/replay or resync, heartbeat and reconnect policy. Overlay auth token is per broadcaster room, rotation supported, read-only to client; authenticated controller session may submit only that viewer's actions.

## Twitch EventSub examples and identity
Raid notification envelope provides `event.from_broadcaster_user_id`, `event.to_broadcaster_user_id`, `event.viewers`. It does not identify each viewer. `channel.chat.message` provides message ID, chatter user ID, broadcaster user ID, and message fragments/text. Preprocess bot commands without mistaking Twitch's own chatbot impersonation. Dedup external event ID and use a unique constraint. Webhook HMAC signs `message_id + timestamp + raw_body`; verify with timing-safe comparison and defend against replay before ACK, then enqueue. Verify subscriptions and auth scopes with official docs; don't copy the existing minimal prototype bridge as a production implementation.

## Command payload
```json
{
  "prompt": "sprint towards a dog and sit on it",
  "clientRequestId": "uuid",
  "source": "viewer_controller",
  "targetHint": null
}
```
Server MUST derive `viewerId` from authenticated session or Twitch EventSub chatter ID, derive `channelId` from verified destination, and prevent overriding actor via arbitrary prompt `@user` unless group action logic approves. Persist raw prompt for short privacy-configured duration, not indefinitely. If action queue rejected return deterministic `429` with retry hint and optional action/status link.

## Exact count semantics
A raid with count `247` yields `raid.reportedViewers = 247`, `raid.authenticatedArrivals` initially `0`, and a *visual crowd population budget*. Don't store `247` fake user rows or allocate 247 Shard rewards. When users join, update linked arrival count under a specific raid window and only then award eligibility after policy checks.

## Implemented equipment slots

`GET /v1/me` and public player profiles include `equipment: { skin?: string, hat?: string, pet?: string }`. `POST /v1/me/cosmetics/:id/equip` requires inventory ownership and changes only the catalog item's slot. `DELETE /v1/me/equipment/:slot` removes a skin, hat or pet without destroying ownership or altering wallet/earned totals. Both mutations require session, same-origin and CSRF checks. Per-account row locking serializes simultaneous equipment updates. Unknown catalog IDs/slots fail validation.

The old `cosmetic` field is retained for compatibility and reflects the selected skin after equipment changes; new clients use `equipment`. An explicitly empty map takes precedence over that legacy field. Base profile color remains independent of skin color. Accounts, world saves, transferred avatars, 3D profile previews and consented share-card art use the canonical loadout. Owned inventory survives removal.
