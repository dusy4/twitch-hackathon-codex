# Tailnet phone test server

A disposable, in-memory RaidRift server for testing the Android app from anywhere over Tailscale. It runs the
**real** EventSub inbox/drain path, chat command path, quest evaluation and Shards ledger; only Twitch itself is
simulated. Debug tools are on, so never expose it to the public internet.

## Run

```powershell
# tailscale serve proxies https://<pc>.<tailnet>.ts.net -> http://127.0.0.1:3400
npm run tailnet:test -- --origin https://raidrift-pc.tail7252b4.ts.net --env-file E:/Hermes/.env
```

Options: `--port 3400`, `--host 127.0.0.1` (default; or a `100.64.0.0/10` Tailscale address), `--origin <public
origin the phone/browser uses>`, `--relay <publish URL hint>` (default `rtmp://<origin host>:1935/live/raidrift`),
`--env-file <dotenv>` (reads only `OPENCODE_GO_API_KEY`). Any other host is refused.

The room is `900000001` (numeric, Twitch-style, `connected=true`, mode SIMULATOR, vision and AI on, unpaused), owned
by the dashboard's simulator host (Juniper). It starts with quest **Sit with the dog** (action `sit`, target `dog`, 2
players, 2 s hold, 50 Shards) and two characters (Mossling, Emberfox). Data resets on stop.

AI: `AI_PROVIDER=opencode`, `ALLOW_PAID_AI=true` when `OPENCODE_GO_API_KEY` is present; model `OPENCODE_MODEL`
(default `deepseek-v4.1-flash`) via `https://opencode.ai/zen/go/v1/chat/completions` with an
`x-opencode-session` header. Keywords are tried first; the model only plans what keywords cannot parse.

## Endpoints (phone)

All `/v1/native/*` routes take `Authorization: Bearer <capture token>` (role `capture`, current `token_version`);
they need no `Origin`/CSRF header.

| Route                         | Body / result                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/debug/pair`          | `{server, room, token, relayUrl?}`: fresh capture token for the test room (debug only, no auth)                                                                                                                                                       |
| `GET /v1/native/world`        | world snapshot                                                                                                                                                                                                                                        |
| `POST /v1/native/chat`        | `{text, name?}` → `{ok:true, plan, source:"keywords"\|"ai"}` or `{ok:false, code, message}` (HTTP 200). Plain text = `!rift <text>`; `!join` joins. Chatter `name` (default `Streamer`) gets a stable simulated numeric id and is auto-joined.        |
| `POST /v1/native/tracks`      | `{tracks: Track[≤50]}` → `{ok:true, epoch}`. Ids are kept as-is; `seenAt` is restamped on receipt (phone clock skew is irrelevant) and each track is held 4 s after its last report. Box/anchor are normalized to the phone's displayed camera image. |
| `POST /v1/native/debug/event` | see below → `{ok:true, queued:n}` (debug only)                                                                                                                                                                                                        |
| `GET /v1/native/debug/state`  | `{log[≤60], inbox{pending,done,failed}, ai{provider,model,lastLatencyMs,lastError}, avatars, tracks[{id,class,confidence}], quests[{title,progress,completed}], leaderboard[{name,score}] (top 5)}` (debug only)                                      |

While an avatar walks to / sits on a track, `avatar.target` is that track id; render the character at the phone's own
3D anchor for that id.

## Debug events

- `{type:"raid", from?, viewers?, chatters?: 0..12}`: real-shaped `channel.raid` notification into `inbox`, then
  `chatters` simulated raiders type `!join` (`channel.chat.message`, 400 ms apart). Twitch only reports a viewer
  count; raider names are simulated chatters.
- `{type:"chat", name?, text}`: one `channel.chat.message` into `inbox`.
- `{type:"duplicate_raid"}`: re-delivers the last raid with the same message id (expect `queued:0`, no second raid).
- `{type:"revoke", status?: "authorization_revoked"|"user_removed"|"notification_failures_exceeded"}`: revocation
  message. `authorization_revoked`/`user_removed` disconnect and pauses the room and revokes the phone pairing: call `/v1/debug/pair` again,
  then `reset`.
- `{type:"quest", action?: "sit"|"dance"|"wave"|"cheer"|"build_voxel", targetClass?: "dog"|"bench"|"bicycle"|null,
minPlayers?, reward?}`: new active virtual quest (defaults: sit, dog, 2, 50).
- `{type:"reset"}`: clears avatars, props, raid and tracks; reconnects and unpauses the room.

Without `DEBUG_TOOLS=true` (only the tailnet server sets it; refused in production) the debug routes return 404.

## North-star smoke

```text
GET  /v1/debug/pair                       -> token
POST /v1/native/debug/event {type:"raid", chatters:3}
POST /v1/native/tracks {tracks:[{id:"dog-1",class:"dog",attributes:[],box:[.4,.5,.2,.3],confidence:.82,seenAt:0}]}
POST /v1/native/chat {text:"run to the dog and sit on it"}
POST /v1/native/chat {name:"Raider2", text:"run to the dog and sit on it"}
GET  /v1/native/debug/state               -> quest completed, 50 Shards each on the leaderboard
```

Keep posting tracks (every 300 to 1000 ms) while the dog is in view, otherwise the target is lost after the hold.
