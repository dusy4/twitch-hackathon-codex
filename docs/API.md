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

## Implemented community construction

`POST /v1/worlds/:id/construction` performs creator-enabled, revision-checked `create`, `place`, `remove` and `delete` operations with a UUID `requestId`. Authoritative world snapshots include active `structures`. Strict bodies, lease/budget rules, idempotent replay semantics and moderation permissions are described in `CONSTRUCTION.md`. No wallet endpoint is called by construction.

## Implemented IRC Live mode (2026-10-31)

These routes use `Authorization: Bearer <paired capture token>` with the same expiry, room, role and token-version revocation checks as `/v1/native/world`. No cookie or CSRF token is required. They do not require Twitch app credentials.

| Route | Request | Response |
| --- | --- | --- |
| `POST /v1/live/channel` | `{channel: string}` Twitch login, optional leading `#`, case-insensitive, 1–25 letters/numbers/underscores | Live status; start/switch asynchronously |
| `DELETE /v1/live/channel` | No body | Idle Live status; stops reconnects |
| `GET /v1/live/status` | No body | Live status |

```json
{
  "channel": "your_channel",
  "channelId": "123456",
  "connected": true,
  "lastMessageAt": 1793450000000,
  "viewersSeen": 3,
  "raidsSeen": 1,
  "error": null
}
```

`channelId` is optional until Twitch supplies `room-id`. `connected` means the selected room acknowledged the connection; it becomes false on disconnect, timeout or stop. `lastMessageAt` is epoch milliseconds for the last PRIVMSG/USERNOTICE, or null before any. `viewersSeen` is distinct valid chat user IDs observed this selection, capped at 100,000; it is not concurrent audience or hero count. `raidsSeen` counts valid deduplicated raid notices observed this selection. Counters reset on start/switch, not reconnect. Error is null when healthy; it describes transport errors/notices, not viewer-command failures. Idle status has `channel:null`, `connected:false`, timestamps null, counters zero, error null.

`GET /v1/native/world`, ordinary snapshots and world transport now include optional `live` containing this full status. Older consumers may ignore it; absence means no IRC selection. Starting Live changes `mode` to `LIVE TWITCH`; deleting it restores `SIMULATOR` for demo-owned rooms, otherwise the connected OAuth world's `LIVE TWITCH` or `OFFLINE`. Resetting practice actors preserves a selected IRC reader's Live mode. Selection is process-local, not restored from a save. Existing heroes remain. Live reads cannot impersonate another player through `/v1/native/chat` (403). Stop/kill/pause and moderation remain server-authoritative. See [TWITCH_EXTENSION.md](TWITCH_EXTENSION.md) for the owner workflow and optional credentialed EventSub boundary.

## Implemented held steering / Unity contract

Each `avatars[]` hero may contain the following additive field:

```json
"steer": { "x": 1.0, "y": 0.0, "seq": 42, "until": 1793450000600 }
```

`x,y` are finite floats in `[-1,1]`, relative to the **streamer's current camera view**: positive x = right, negative x = left, positive y = forward/away, negative y = back/towards the camera. They are directions, not target coordinates. Diagonal speed is normalized to avoid a speed boost. `seq` is a server-assigned increasing integer in this world process and resets on process restart. Reset the consumer's comparison baseline on world-epoch changes and ignore older samples from the same epoch. `until` is server epoch milliseconds. `steer:null` or absent means idle input. Stop at `until` even if the next snapshot is lost. Use server time/HTTP Date for clock offset; never extend expiry based on the phone clock or packet arrival time.

Extension steering (`POST /v1/ext/steer {x,y}`) refreshes a **600 ms** lease. Send at most 10 updates/s, including release; the frontend spaces requests at least 110 ms apart and permits only one steer request in flight. `{x:0,y:0}` releases. Server enforces both a 100 ms minimum interval and ten requests per rolling second, returning 429 on excess. A lost release times out. Chat `!w/!up`, `!a/!left`, `!s/!down`, `!d/!right` uses the identical action with a **1,200 ms** lease, since chat cannot express a continuous held key.

Accepted planner/command input cancels steer; steer cancels a running action and invalidates older pending target/model work for that hero. Pause, scene reset, explicit join command and expiry clear steer. Other heroes are unaffected. A viewer owns one hero keyed to its server account, never a caller-supplied actor ID. Steering is ephemeral, not restored from world saves, and has no wallet mutation.

The backend also advances legacy `avatar.x/y` normalized image coordinates at 0.25 units/s with a `[.02,.98]` boundary; positive steer y decreases image y. **Unity should consume the steer vector directly**, project current camera right and horizontal forward onto its measured support plane, use its existing movement speed/collision rules, and stop on untracked/unsupported geometry. Avoid applying both that movement and the image-coordinate delta. This backend contract is implemented/tested; no Unity source was changed and physical camera-relative navigation remains the Unity engineer's integration/validation task.

## Implemented Extension EBS

All `/v1/ext/*` requests use the Twitch helper JWT in `Authorization: Bearer <JWT>`. Verify HS256 against base64-decoded `EXT_SECRET`, expiry (seconds), viewer/moderator/broadcaster role, numeric `channel_id`, and `opaque_user_id`; external-role tokens and arbitrary actor/name/channel body fields are refused. CORS is restricted to the configured Extension CDN origin and same-origin Local Test. OPTIONS requires no token. `user_id` links to chat identity only if the JWT is not unlinked; otherwise `ext:<opaque_user_id>` stays separate, displayed as `viewer-xxxx`. Opaque accounts can play but receive no join/quest Shards before identity sharing. A shared token proves both identities for hero reconciliation. Known Twitch display names are refreshed by chat; no app credentials are required to resolve an existing chat account.

| Route | Body / result |
| --- | --- |
| `POST /v1/ext/join` | Strict `{}`; spawn/claim authenticated hero |
| `POST /v1/ext/steer` | Strict `{x:number,y:number}`; direction/release |
| `POST /v1/ext/emote` | Strict `{emote:"jump"|"dance"|"wave"|"sit"|"cheer"}` |
| `POST /v1/ext/prompt` | Strict `{prompt:string≤500,targetHint?:trackId}`; existing chat/planner path |
| `GET /v1/ext/state` | State below; no account allocation just for reading |
| `GET /v1/ext/events` | SSE `event: state`, same JSON state at 5 Hz; stream closes at JWT expiry, channel remap, slow-client backpressure or server shutdown |

State: `{serverTime:epochMs,roomId,live?,hero:Avatar|null,targets:[{id,number:number|null,label}],roster:[{id,name,color,animation}]}`. Number is parsed from the phone's exact `class:"spot N"`. Numbered markers use an observed attribute as their label (e.g. sofa), otherwise their class. Unnumbered objects use their class (e.g. chair), keeping appearance attributes such as red separate from the target noun. All targets remain selectable by ID. Targets mirror visible tracks, expire on the ordinary world tracking lifetime, and are never renumbered by the Extension. Roster is a small preview capped at 30. Mutation results contain the same state. SSE clients use streaming fetch so tokens stay in headers, never URLs; refresh/reconnect on `onAuthorized`. Maximum two streams per viewer/room, 20 reads/s per identity, ten steer requests/s, two join/emote/prompt requests/s combined, plus existing actor cooldown/AI/world gates. Model output and user text have no privileged authority. UI labels are schema-validated and rendered as escaped text.

`/ext/` serves `dist/twitch-extension` when built. Build-time `VITE_EBS_ORIGIN` points Hosted Test at its approved HTTPS EBS. Missing `EXT_SECRET` fails closed with 503; no fixture JWT is accepted by a normal deployment. Owner setup, review restrictions, public-origin options and test commands: [TWITCH_EXTENSION.md](TWITCH_EXTENSION.md).
