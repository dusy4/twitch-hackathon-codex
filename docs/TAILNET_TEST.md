# Tailnet phone test server

**Live input / Extension update (2026-10-31):** the paired capture token can start actual anonymous Twitch input with `POST /v1/live/channel {channel}` and inspect `GET /v1/live/status`. The world gains additive `live` and hero `steer` fields; [API.md](API.md) defines the exact Unity contract. Delete the selection to return to practice. Source changes require the integrator to restart the server; this development task did not restart port 3412. `--env-file` now allowlists `EXT_CLIENT_ID`, `EXT_SECRET`, `EXT_OWNER_ID` in addition to the existing planner keys. [TWITCH_EXTENSION.md](TWITCH_EXTENSION.md) covers Local/Hosted Test, the keyboard policy flag and owner setup. This remains a private debug harness even when input comes from real Twitch; never Funnel/tunnel the entire debug server to public viewers.

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
| `POST /v1/native/frame`       | `{frameId: string≤80, jpeg: base64 JPEG (decoded ≤ 400 KB), width: int, height: int}` → `{ok:true}`. The phone's displayed camera image (same space as track boxes), about every 1.5 s while paired. Memory only: the server keeps the latest frame per room (dropped after 60 s). Needs vision consent (`NO_CONSENT` 403 otherwise). |
| `POST /v1/native/debug/event` | see below → `{ok:true, queued:n}` (debug only)                                                                                                                                                                                                        |
| `GET /v1/native/debug/state`  | `{ov{up,device,lastMs,lastQuery,lastHits,lastError}, frame{id,ageMs,bytes}\|null, log[≤60], inbox{pending,done,failed}, ai{provider,model,lastLatencyMs,lastError}, avatars, tracks[{id,class,confidence,source?}], quests[{title,progress,completed}], leaderboard[{name,score}] (top 5)}` (debug only) |

While an avatar walks to / sits on a track, `avatar.target` is that track id; render the character at the phone's own
3D anchor for that id.

`Track` has two optional fields: `source: "phone"|"server"` (absent = phone) and `frameId` (string ≤ 80). `box` is
`[x, y, w, h]` normalized 0..1 with a top-left origin, in the phone's displayed camera image.

## Any object: server open-vocabulary detector

The phone detects the 80 COCO classes itself. For anything else a chat command names ("sit on the wooden crate",
"hide behind the boxes"), the server asks its local detector sidecar (`services/ov-detector`, OmDet-Turbo on the PC
GPU, `http://127.0.0.1:3420`, override with `OV_DETECTOR_URL`) on the latest phone frame:

1. Nouns are taken from the request (`the|a|this … <up to 3 words>`, last word singularized: "boxes" → "box"). A noun
   already shown by a fresh track (class word, head word "plant" ↔ "potted plant", synonyms like sofa ↔ couch,
   plurals) is not looked up.
2. If the latest frame is younger than 5 s, the sidecar is asked once (timeout 3 s, score ≥ 0.3). The best box per
   noun becomes a track `{id:"ov-<n>", class:<noun>, attributes:[], box, confidence, seenAt, source:"server",
   frameId}` held 10 s; then planning runs as usual (keywords first, then the AI planner). The AI planner may also
   ask for an unseen object as `target:"?<noun>"`, which goes through the same lookup.
3. No frame, no hit or sidecar down: `TARGET_NOT_VISIBLE` ("Couldn't find a pillow — I'll wait nearby.").
4. The phone should anchor the `ov-*` track and re-post it in `/v1/native/tracks` with the same `id`, `source:"server"`
   and `frameId`; ids are never renamed, and server tracks are accepted with confidence ≥ 0.2 (phone tracks ≥ 0.5).

Start the sidecar: `powershell -File services/ov-detector/start.ps1` (see `services/ov-detector/README.md`).

## Debug events

- `{type:"raid", from?, viewers?, chatters?: 0..12}`: real-shaped `channel.raid` notification into `inbox`, then
  `chatters` simulated raiders type `!join` (`channel.chat.message`, 400 ms apart). Twitch only reports a viewer
  count; raider names are simulated chatters.
- `{type:"chat", name?, text}`: one `channel.chat.message` into `inbox`.
- `{type:"duplicate_raid"}`: re-delivers the last raid with the same message id (expect `queued:0`, no second raid).
- `{type:"revoke", status?: "authorization_revoked"|"user_removed"|"notification_failures_exceeded"}`: revocation
  message. `authorization_revoked`/`user_removed` disconnect and pauses the room and revokes the phone pairing: call `/v1/debug/pair` again,
  then `reset`.
- `{type:"quest", action?: "sit"|"dance"|"wave"|"cheer"|"build_voxel", targetClass?: <any object noun, 1..40 chars,
  trimmed + lowercased>|null, minPlayers?, reward?}`: new active virtual quest (defaults: sit, dog, 2, 50). Verified
  from world state for any class ("plant" matches a "potted plant" track). Creator quests take the same `targetClass`.
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
