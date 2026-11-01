# RaidRift

**Your Twitch chat, as tiny heroes in your real world.** RaidRift is an Android AR app for IRL streamers. The phone scans the space around you. A Twitch raid tears open a voxel portal on your floor, and every viewer who types `!join` gets their own named hero that walks on the real surfaces. Viewers then steer that hero from chat, in plain words or commands, or from a Twitch Extension d-pad. The phone streams the composited AR view, your mic and game audio **straight to Twitch over RTMPS**. No OBS and no PC in the loop.

Built for the **Twitch × Codex hackathon** (deadline November 2, 2026, 2:00 PM Pacific). Current app: **0.23.3** (November 1, 2026). Branch `fix/android-ar-recovery` (mirrored to `main`).

## Try it now

1. On an ARCore-capable Android phone, download and install **[RaidRift-latest.apk](https://raidrift.12industries.com/apk/RaidRift-latest.apk)**. Allow "install unknown apps" for your browser.
2. Open RaidRift and grant **camera** and **microphone** access. Sweep the rear camera slowly over the floor and furniture until the landing rune locks (or tap scanned floor).
3. **Setup → Twitch channel** (your login) and **Stream key** (Twitch Creator Dashboard → Settings → Stream). The key stays on the phone. Then tap **Go live**.
4. Going live pairs the app with the public server automatically. Each install gets its own room; no account, Tailscale or PC setup is needed. Setup shows `#yourchannel chat connected` once chat is being read.
5. In your Twitch chat, viewers type `!join`. Their heroes appear in your room with their names.

Before you go live, the app runs an offline demo room with three scripted test viewers and a local **Test raid** orb. That is useful for checking the AR. Nothing from the demo room reaches Twitch.

Public server: `https://raidrift.12industries.com`. Only these paths are public: `/ext/*`, `/v1/ext/*`, `/v1/native/*`, `/v1/live/*`, `/apk/*` and `/health`. Rooms live in memory. If the server restarts, the app re-pairs by itself to the same room, but heroes have to `!join` again.

## How chat drives the heroes

| Viewer types | What happens |
|---|---|
| `!join` (or plain `join`) | Spawns that viewer's own hero, named from their Twitch account. |
| `!jump` `!dance` `!wave` `!sit` `!stop` | Instant keyword actions. Plain `jump`, `dance`, `wave at me` and `turn around then dance` also work once you have joined. So do Ukrainian phrases: `стрибни`, `танцюй`, `помахай рукою`, `йди вперед`. |
| `!w` `!a` `!s` `!d` | A short step away, left, toward or right, relative to the streamer's view. |
| `!rift go to 3 and dance` | Walks to on-screen **spot 3** (the phone draws numbered markers on reachable floor), then dances. |
| `!rift go to the chair`, `!rift sit on the bench` | Natural language, planned by a small LLM (Groq `gpt-oss-20b` through an OpenAI-compatible provider) into a **bounded, typed plan**: walk/emote/sit steps on known targets only. Targets come from the phone's on-device **YOLOX-S (COCO-80)** detections lifted onto the scanned mesh, plus numbered spots, "there" (screen centre), "streamer" and "portal". Synonyms (sofa/couch, table, plant…) are in `apps/api/targets.ts`. If the object isn't detected, the request fails honestly. |
| Twitch Extension | Join button, hold-to-walk d-pad, emotes, tap a visible target, free-text idea box. Local Test only (see limits). |
| A real **raid** | The portal tears open on your landing spot with the raider's name and viewer count. Raiders who `!join` walk out of it, then the portal collapses and the heroes live in your room. |

Keyword commands never call the LLM. Any other `!` message goes to the planner first and falls back to the keyword compiler when the model is offline or over budget (25 plans/min per room). Model output is validated JSON choreography. No generated code runs.

## What you see on the phone

- The portal opens **only for a raid**. Viewers who join without a raid poof in with an arrival burst. Heroes then roam the scanned room, hop onto furniture tops and wave at the camera.
- **Follow me** is a manual button: the party walks along in front of you. There is no auto-follow, and the portal doesn't relocate.
- **Selfie flip** keeps every hero exactly where it stood. While you stand still, a gyro view draws them in the front camera when you turn towards them. Flip back and they are still there.
- **Live HUD** (IRL-Pro style): LIVE timer, bitrate, fps/drops, chat-connected state, mic mute, and End (two taps). Name tags, numbered spots, hearts and the "Type !join" caption are part of the broadcast. The buttons are not.

## Honest limits

- **Device-tested?** The full combination (AR + detector + selfie + RTMPS A/V on Twitch + walking) on 0.23.3 is **unverified on device** until the November 1 recording. Unity self-tests and a Play Mode smoke test (`PlaySmoke`) pass. Those prove no real tracking, encoding or Twitch receipt.
- **Test raids need a numeric room.** On the public server the Setup "Server test raid" is refused for per-phone rooms. A portal on Twitch currently needs a **real raid** from another live channel. Before Go live, the offline demo raid works locally.
- **Twitch Extension** is in **Local Test**: only allowlisted accounts see it, on the owner's channel. Twitch review takes 5–14 days, so judges can't install it. The deployed build has the touch/hold d-pad; keyboard WASD is only in the Local Test keyboard build.
- **Chat is read anonymously over IRC** (read-only). RaidRift never posts to chat. EventSub/OAuth code exists in `apps/api/twitch.ts` but is not used by the public server. No Bits, Channel Points or subs.
- **Vertical only:** the stream is 720×1280 portrait (desktop shows side bars). No Dual Format.
- **State is in memory.** No accounts, scores or Shards persist on the public server.
- **Object grounding is approximate:** labels can be wrong or missing. A hero on a "chair" is a virtual pose, not proof of contact. Microphone denial currently stops Go live, so grant it first.
- Android only (ARCore + Niantic Spatial SDK meshing). Not tested on iOS.

## Docs

- [RaidRift MR: phone, server, Twitch, build and troubleshooting guide](docs/RAIDRIFT_MR.md)
- [Three-minute stream checklist](docs/STREET_TEST_RUNBOOK.md)
- [Devpost video: 2:45 shot list](docs/DEMO_VIDEO_SCRIPT.md)
- [Twitch Extension status and owner steps](docs/TWITCH_EXTENSION.md)

## Build and run from source

Server (Node 24+), the same process the public server runs (in-memory rehearsal harness; it binds only 127.0.0.1 or a Tailscale address, so put a reverse proxy such as Caddy in front):

```powershell
npm ci
npm run build
npm run build:extension          # review build; build:extension:local adds keyboard WASD for Local Test
node node_modules/tsx/dist/cli.mjs scripts/tailnet-test.ts --host 127.0.0.1 --port 3412 --origin https://your.host --env-file <private .env>
```

The env file may provide `GROQ_API_KEY` (planner), `EXT_CLIENT_ID`/`EXT_SECRET`/`EXT_OWNER_ID` (Extension) and `APK_DIR` (APK download folder). Without a planner key, keyword commands still work. For the full website/API with a database: `npm start` on http://127.0.0.1:3400 (see [setup](docs/SETUP.md)).

Phone app: Unity 6000.3.27f1 project mirrored in `apps/unity-ar` (live copy `E:\RaidRift-MR`). Build steps are in the [MR guide](docs/RAIDRIFT_MR.md#unity-build). The app's default server is `https://raidrift.12industries.com` (`ServerConnection.cs`); change it in Setup → Server URL for your own host.

`npm test` runs backend/domain integration tests; `npm run test:e2e` runs browser checks. These are commands to reproduce validation, not newly claimed results. The historical receipt is [artifacts/extension-verification.json](artifacts/extension-verification.json) (91 Node passes, one conditional PostgreSQL skip).

## How Codex contributed

Codex (CLI and app) did the research and implementation passes behind this repo: the bounded planner and target words (`apps/api/compiler.ts`, `world.ts`, `targets.ts`), the anonymous IRC reader and Extension EBS (`twitch-irc.ts`, `extension.ts`, `apps/twitch-extension`), the Android RTMPS publisher (`Scripts/Live/*` + RootEncoder bridge), the YOLOX detector integration (`Scripts/Perception/*`), selfie mode, effects previews, and several code reviews. The session ids and the evidence list are in the [video script](docs/DEMO_VIDEO_SCRIPT.md#codex-evidence).

- [General setup, OBS and operations](docs/SETUP.md)
- [Implementation chronology and evidence](docs/PROGRESS.md)
- [Extension owner setup and public EBS requirements](docs/TWITCH_EXTENSION.md)
- [Asset provenance and licenses](docs/ASSETS.md)
- [Original release scorecard](docs/RELEASE_SCORECARD.md) — historical; current Unity limits are in the MR guide.

---

## Historical handoff (October 27)

The original brief below describes the broader product objective, not implemented features. Its “no deadline” language predates the current hackathon submission deadline above. Older Kotlin/native and prototype instructions are historical and are not the current Unity phone workflow.


# RaidRift / RealityQuest — complete Codex handoff

**What this is:** the complete autonomous software-build brief for a full immersive Twitch game and website, plus an earlier browser prototype as optional starting material. **What it is not:** a finished production app. The production app is what Codex is tasked to implement. There is NO product delivery deadline.

## One-shot instruction to Codex

> Read `AGENTS.md`, `CODEX_HANDOFF.md`, all documents in `docs/`, the examples and the included prior prototype. Autonomously implement the complete RaidRift × RealityQuest product end-to-end, not a demo. Use all available programming, browser, research, asset and testing tools, current API docs and best judgment. Keep `docs/PROGRESS.md` current, verify actual results and continue through all phases. Do not invent test results. Ask only when external account secrets, unapproved spending or irreversible publishing are unavoidable; otherwise keep working. No deadline and no shortcut to mere mockups.

## Top-level deliverables required of Codex
- Functioning production website incl. global/seasonal/weekly leaderboards, profiles, Shards wallets, streamer dashboard, viewer controller and live discovery.
- Functional Twitch EventSub raid & chat integration, OAuth, accurate participant identities and cross-stream persistent avatars.
- High-quality OBS browser overlay with original voxel portal cinematic, dozens of animations, sound effects and cross-stream game logic.
- Natural-language `!rift <prompt>` actions grounded in live camera objects, e.g. running toward and sitting on the visible dog **virtually**.
- Privacy-conscious, opt-in real camera perception, AI decisions for quests, Shards economy/anti-abuse ledger and synchronously updated leaderboard.
- Native mobile AR with camera-anchored effects and stream output when supported; clearly documented fallbacks.
- Operations: security, test suite, working deployments when authorized, migrations, observability, setup docs and demo proof.

## Contents
- `AGENTS.md`: operating instructions for autonomous agent.
- `CODEX_HANDOFF.md`: authoritative vision + end-to-end contract.
- `docs/PRODUCT.md`: gameplay, website UX, portal, social loops, natural commands and moderation.
- `docs/ARCHITECTURE.md`: services and real video/OBS/Twitch integration.
- `docs/AI_RUNTIME.md`: object grounding, animation DSL, planner and target tracking.
- `docs/QUESTS_ECONOMY.md`: OpenAI Decisions verification, real/virtual quests, currency.
- `docs/DATA.md`: data schema and ledger/leaderboard invariants.
- `docs/API.md`: proposed HTTP and WebSocket contracts.
- `docs/UX_ASSETS.md`: world art direction, SFX/character requirements.
- `docs/IMPLEMENTATION.md`: dependency ordering (not timeboxes).
- `docs/ACCEPTANCE.md`: hard pass/fail gates.
- `docs/RESEARCH.md`: verified official sources, integration and license gotchas.
- `docs/PROGRESS.md`: initial implementation checklist; agent must update.
- `docs/SOCIAL_DEMOS.md`: actual recordings and viral demos to create.
- `examples/`: sample JSON DSL and schemas.
- `prototype/`: previously created 2.5D demo with optional Node Twitch bridge; **demo-only features are intentionally incomplete**.

## Run existing visual prototype only
```bash
cd prototype
npm install
npm run check
node bridge.mjs       # works in demo mode with no Twitch credentials
# open http://localhost:8080
```
Copy `.env.example` to `.env` and configure as described by `prototype/README.md` to *experiment* with Twitch, but do NOT mistake the prototype's ephemeral wallet/single-demo-avatar for the product design. `prototype/ai-verify.mjs` independently illustrates OpenAI Decisions API (not wired to actual quest economy).

## Technology constraints to honor
- Twitch raid EventSub only supplies source/destination creator and viewer count; not the exact viewer roster.
- OBS Browser Source cannot just inspect other OBS webcam sources; vision needs an explicitly authorized camera-source ingestion path and correct source-to-canvas transforms.
- OpenAI Decisions is best for bounded visual predicates, Responses Structured Outputs for user prompt-to-action planning. Both require server-side validation.
- Twitch Channel Points and Bits are not Rift Shards; use our own points and game ledgers.
- Marketplace or source licensing matters: do not copy Minecraft assets or silently include AGPL YOLO in a closed-source commercial project.
