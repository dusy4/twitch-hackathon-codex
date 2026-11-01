# RaidRift

RaidRift turns Twitch chat and raids into a mixed-reality adventure: viewer heroes emerge from an original voxel rift, navigate surfaces scanned by an Android phone, and respond to their viewers' commands. The Unity app can send the composed camera view, microphone and game audio directly to Twitch; the PC server handles chat input, plans and world state. An optional Twitch Extension provides viewer controls.

**Twitch × Codex hackathon deadline: November 2, 2026, 2:00 PM Pacific.** The implementation is under active validation, not a production release. Current source review: October 31, 2026, branch `fix/android-ar-recovery`.

- [RaidRift MR: complete phone, server, Twitch, build and troubleshooting guide](docs/RAIDRIFT_MR.md)
- [Street test: one-page three-minute stream checklist](docs/STREET_TEST_RUNBOOK.md)
- [Devpost video: shot-by-shot 2:45 script](docs/DEMO_VIDEO_SCRIPT.md)

## Current status

“Done” below means implemented with the stated evidence; it does not imply every release gate passes.

| Status | Area | Evidence / exact remaining gate |
|---|---|---|
| Done in source | Unity room meshing, live NavMesh, landing, KayKit heroes, jump links, roaming/following, numbered targets, HUD and effects | Live project **`E:\RaidRift-MR`**. Overnight builds 0.20.0 → **0.21.29** (Nov 1, 04:39 Kyiv) were published to the private APK share after Unity self-tests and the Play Mode gameplay smoke test (`PlaySmoke`: every HUD button, landing, test and real raid, `!join`/wave, WASD, 90 s chat soak, 10 m street walk with the party in frame) passed. Repo `apps/unity-ar` is a synced copy and may lag. |
| Done in source; untested on device | Direct Twitch publisher, YOLOX-S labels, selfie mode and current grouped settings | RootEncoder standalone checks exist; current combined AR/detector/selfie/Twitch A/V and thermal tests remain open. The Nov 1 noon street test is the first device pass for 0.21. |
| Done with local integration evidence | Anonymous Twitch IRC chat/raid adapter, held steering, Extension EBS and four viewer surfaces | [Receipt](artifacts/extension-verification.json): 91 Node passes, one conditional PostgreSQL skip, fixture-authorized browser tests. Actual read-only `#twitch` acknowledgement passed; real two-viewer/raid/phone-broadcast rehearsal remains untested. |
| Done with earlier local evidence | Website/controller/creator tools, database-backed identity, ledger/leaderboards, bounded planner and optional PC detector | See [setup](docs/SETUP.md), [assets](docs/ASSETS.md) and [progress](docs/PROGRESS.md). The private tailnet harness is in-memory and loses state on restart. Phone Rift Trail grants no Shards. |
| Blocked: hosting + review | Public Twitch Extension installation | Private **Local Test** is registered (Oct 31): hosting paths, capabilities, `EXT_*` values in the owner's private env, testers, installed on the owner's channel; the owner still activates it. The EBS accepts JWTs signed with the configured secret. A public HTTPS EBS addressing the same world is required; private Tailscale Serve is unreachable to ordinary viewers. Twitch hosted testing/review remains outstanding. [Exact checklist](docs/TWITCH_EXTENSION.md). |
| Blocked for credentialed path | Production OAuth/EventSub delivery | Requires owner-controlled Twitch application credentials/authorization and a public HTTPS callback. Private harness intentionally clears OAuth credentials. Anonymous IRC is a separate available input path. |
| Open release gates | Current phone acceptance, public durable deployment and asset distribution review | Exact-APK device evidence, received A/V/reconnect, tracking/recognition corpus, public operations and exact model provenance/notices remain required. [Acceptance](docs/ACCEPTANCE.md), [MR limitations](docs/RAIDRIFT_MR.md#privacy-safety-and-limits). |

## Run

For the website/API locally (Node 24+):

```powershell
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3400**. This normal local API persists simulator data; `npm start` does not automatically load `.env`. For the owner's private phone rehearsal, use the [street checklist](docs/STREET_TEST_RUNBOOK.md), which specifies port **3412**, Tailscale and the existing env-file launch command. Install the phone APK from the [private APK share](https://raidrift-pc.tail7252b4.ts.net/apk/) with Tailscale connected.

`npm test` runs backend/domain integration tests; `npm run test:e2e` runs browser checks. These are commands to reproduce validation, not newly claimed test results. No build, device run or live stream was performed during this documentation refresh.

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
