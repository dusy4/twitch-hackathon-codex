# IMPLEMENTATION ORDER — phases, not deadlines

Do not stop after any milestone. Each phase expands a running, testable product. Dependencies matter, no artificial timebox or hackathon submission shortcut. Keep state in `docs/PROGRESS.md`, log ADRs and actual test results.

## Phase 0 — repo & design foundations
- Choose monorepo architecture and justify. Set up dependency pinning, lint/typescript strict, CI, dev containers with Postgres + Redis, typed shared event schema, original asset pipeline and design tokens. Inspect prototype before transplanting.
- Implement deterministic data fixtures and test twitch event messages. Docs and independent demo mode. Establish screenshots and metrics baseline.

## Phase 1 — real twitch and worlds
- OAuth flow for broadcasters and viewers, token rotation, revoke handling, signed Twitch inbound raid/chat and moderation EventSub, subscription management, duplicate/replay prevention and stream join identity semantics.
- Multi-room world server, websocket auth/snapshots/deltas, persistent verified avatars, raid portal choreography and original SFX, OBS browser source + website onboarding, streamer controls.
- Live test: two Twitch accounts perform real raid, viewer `!join`, command, camera-independent portal; claim correctly and see identity persistent through reconnect and streamer changes.

## Phase 2 — interactive avatar language
- Deterministic D-pad commands and emote library. Create action schema + typed compiler, cache, validator, cooldowns, moderation and per-stream budgets. Natural-language multi-action sequencing; distinct characters with objects, mounts and interactions.
- Server-authoritative timeline and client interpolation; persistent cosmetic state. Test 25 parallel prompts, 2000 viewer raid reported vs actual linked players, object spawning and rate limit reliability.

## Phase 3 — camera-aware RealityQuest (desktop)
- Create genuine opt-in OBS-source capture/companion, source transform/calibration UI, low-latency frame ingestion and frame timestamp sync. Detector, temporal tracking and target resolver, optional SAM2 for masks, error/uncertainty fallback. Map bboxes to stage coordinate system; make dog/table/red-hat demos physically aligned and dynamically follow target movement.
- Test target ambiguity, moving objects, multiple OBS scenes, mirror/crop, video disconnect, arbitrary prompt target references and failure responses. Never imply OBS browser source can access camera frame automatically.

## Phase 4 — quests & shards economy
- Quest authoring/templates, server-state-only virtual quests, camera visual verification through OpenAI Decisions, multi-frame evidence, streamer attestation fallback, anti-farm; ledger transaction and strict idempotency, spendable wallet, cosmetics catalog, audit, admin reversals.
- Public leaderboard pages, time ranges/season history, player and streamer ranks, profiles and inventories, live updates + current player rank, signed share cards and mobile. End-to-end test quest completion -> ledger commit -> leaderboard update, duplicate proof.

## Phase 5 — AR-native IRL mode
- Unity AR Foundation phone capture app (Android first; iOS after), scene anchors/planes/depth/occlusion, avatar behavior tied to world coordinate and live video; streaming output with audio and camera permissions. Browser-only fallback is explicitly labelled limited 2.5D. Test moving camera, dog occlusion, portal attached to wall, frame rate and thermal/mobile networking.
- If platform-specific device permission or account signatures block real tests, document exact steps to verify later and complete host tooling and automated tests meanwhile.

## Phase 6 — deep creativity, community and hardening
- Faction alliances, raid defense and co-op quests, portal effects unlocked through progression, seasonal competitions, passive world NPCs, collaborative buildings, social clip exports with consent, streamer analytics, anti-cheat operator tools, robust observability and cost/rate management.
- Performance/load testing, data retention/deletion, streaming audio behavior, deployment in actual accessible cloud environments if authorized, secret rotation, moderation, security review, docs and real demonstration footage.

## Critical path prioritization
For first coherent end-to-end value, prioritize real Twitch raid -> real persistent chat-controlled avatars -> accurate overlay -> natural-language command -> camera object grounding -> quest verified -> Shards ledger -> public leaderboard. Each subsequent stage adds fidelity and expanded platforms rather than replacing earlier hardcoded mocks. Do not defer the leaderboard forever: it's core product and should enter by Phase 4 at the latest.
