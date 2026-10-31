# RaidRift — implementation workspace

**Current native update: 0.11.0-measured-routes.** See the [three-video MR review and measured navigation](docs/MR_REFERENCE_REVIEW.md) and [ADR-010](docs/ADR-010-measured-room-navigation.md). This adds finite AR walking support, bounded local routes, transient depth obstacles, stable following, clearer discovery hints and AR Focus controls. Final build/runtime receipts are in `artifacts/measured-routes/verification.json`. Physical S25 navigation remains unpassed.

**Previous immersion update: 0.10.0-rift-trail.** See the [current feature inventory and open gates](docs/CURRENT_STATE.md), [Rift Trail instructions](docs/IMMERSION.md) and [design/review decisions](docs/ADR-009-expedition-immersion.md). Native AR remains the priority; IRL Pro compatibility is deferred. The update adds measured walking/collecting/shrine quests, a fresh party-emote finale, original ElevenLabs effects mixed into native relay AAC, portal/arrival/pickup visuals, persistent audio/reduced-motion controls and labelled camera-off exploration preview. Trail progress is local and grants no Shards. Exact APK/test/runtime results are in `artifacts/immersion/verification.json` once final verification completes; physical S25 walking/depth/audio remains a separate gate. Local MP4 clips and experimental WebRTC remain silent.

**Previous native build: 0.9.0-auto-landing.** Start AR, scan a clear floor/table and wait for **Landing ready**; the app now prepares a measured stage automatically. Three stub viewers still use the same per-viewer natural-language grammar and animations. Broadcast can start while scanning, before any stage is placed. The private receiver has been restored and native camera-off relay output checked. Physical S25 auto-placement, AR camera/audio/OBS and live Twitch remain open. [Instructions and relay status](docs/AUTO_LANDING.md), [design](docs/ADR-008-auto-landing.md).

**Older LAN test instructions (not the current APK):** [LAN setup and phone checklist](docs/ANDROID_LAN_TEST.md). Run `npm ci`, then `npm run lan:test` on your laptop. The Android development APK is attached to the [Android LAN test prerelease](https://github.com/dusy4/twitch-hackathon-codex/releases/tag/android-lan-test-2026-10-29). Tracked AR character visibility remains an open test; this is not a production release.

Run `npm ci`, `npm run build`, then `npm start` from this directory. Open **http://127.0.0.1:3400**.

For the character demo, click **Try a portal event** or **Enter the world**. The controller's **Step through the portal** button visibly re-enters your own character. See [character implementation and actual recordings](docs/CHARACTERS.md). Camera perception is optional and requires `npm run setup:vision`.

This repository now contains a persistent server, original 3D overlay, browser website/controller/creator tools, Twitch/OpenAI adapters, local camera detector, transactional Shards economy, social duels/factions/share cards, native AR source, tests and deployment descriptors. **It is not release-ready.** Live Twitch/OpenAI, native AR hardware, model redistribution, container deployment and other acceptance gaps remain explicit. Native PostgreSQL concurrency tests pass locally.

- [Setup, integrations, OBS and operations](docs/SETUP.md)
- [Implementation progress and remaining gates](docs/PROGRESS.md)
- [Native AR source and device checklist](docs/MOBILE.md)
- [Asset licenses and QA-video attribution](docs/ASSETS.md)
- [Architecture decision and phase plan](docs/ADR-001.md)
- [Release scorecard](docs/RELEASE_SCORECARD.md)
- [Social play and consent](docs/SOCIAL.md)

`npm test` runs domain and HTTP/WebSocket integration tests. `npm run test:e2e` automatically launches an isolated QA server on port 3401. See setup for licensed video/model fixtures. Simulator identities and scores are always labelled. Version 0.10 used owner-authorized ElevenLabs allowance for five assets and an independent review; no public deployment or plan upgrade was performed.

---

The original handoff README follows unchanged:

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
