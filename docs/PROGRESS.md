# RaidRift implementation progress

Updated 2026-10-28. The handoff was extracted and all supplied specifications, examples and prototype implementation inspected. **Product is not release-ready.** The original prototype remains untouched. Local source is in this directory; the durable development app uses `http://127.0.0.1:3400`. Browser QA now launches its own fresh database/server on port 3401.

## Implemented and locally tested

- Modular TypeScript application, PostgreSQL SQL migration, embedded PGlite local runtime and external PostgreSQL adapter; production build and strict typecheck pass.
- Persistent numeric Twitch identity, distinct viewer avatars, restart save/recovery path, multi-room authoritative simulation, read-only WebSocket snapshots, bounded raid population with correct anonymous count semantics.
- Append-only ledger, atomic wallet debit/inventory ownership, idempotent credits, compensating reversals, separate earned rankings and spendable balance, UTC periods, privacy modes.
- Constrained action schemas and deterministic parser, optional strict Responses adapter, moderation, cooldown and room AI budget, target ambiguity/staleness, scene epoch reset and safe tracking loss.
- Signed EventSub endpoint and durable inbox, exact raw HMAC and timestamp checks, challenge/replay handling; encrypted OAuth tokens, state/browser binding, refresh adapter, subscription management and disconnect paths.
- Working browser site: discovery, controller, creator studio, quests, shop/equip, profiles, leaderboards, atlas/history, privacy/deletion and restricted operator UI. Original Three.js portal, voxel cast, bounded anonymous instanced crowd, procedural sound, responsive styles and reduced motion.
- Consented browser camera/display/file companion with local MediaPipe detector, ephemeral box association, source geometry mapping and no frame storage. Decisions adapter with multi-frame evidence gate; **camera payouts disabled by default** pending calibration/source attestation.
- Expanded tests cover native PostgreSQL concurrency, first-join reward guards, deletion/recovery/privacy, hybrid proximity and same-target rules, faction score history, OAuth unlink/relink and periodic revocation, generated API contracts, SSR escaping, share-card consent and duels. Latest combined run: **37 passed, 1 conditional native-PostgreSQL skip**; the native test passed separately.
- Native PostgreSQL 17 Windows binaries downloaded from EDB (official PostgreSQL Windows distributor), isolated loopback database initialized with SCRAM credentials, independent pg connections tested: 100 duplicate awards, concurrent spending, UTC daily caps and rollback. Server shut down after each test. Evidence: `artifacts/native-postgres.json`.
- Browser matrix: **17 passed / 15 intentional once-only integration skips** across Chromium, Firefox, WebKit and mobile. Actual dog-video detection → server choreography → silhouette-relative sitting passes. Subsequent focused Chromium checks pass for quest → purchase → equip → unchanged lifetime score → signed-card render/revoke → faction join/leave, plus axe checks on seven public pages and controller/creator forms.
- Local 1000-spectator socket smoke passed: 0 connection errors, ~26.9 ms event-loop p95, ~426 MiB process RSS on this machine. This did not test 1000 active avatars or internet throughput. Separate 25-actor concurrent action test passes.
- Original 3D profile preview, public streamer detail pages, public SSR rankings/profiles/discovery, live ranking polling (5-second visible-tab lag), API route/schema inventory, shared emote invitations and immutable faction-at-award accounting added.
- Thirty-seven procedural animation states/aliases, expressive rig/blink, mount motion and grounded shadows. Renderer pose offsets no longer accumulate into server position. Separated spawn positions and immediate post-join wallet refresh correct two issues found in visual QA.
- Consented two-player turn-based wizard duels, bounded turns/rooms, replay protection, timeout/leave/stop/transfer cancellation and no currency stakes. Faction join/leave website and owner-consented, signed/revocable 24-hour profile SVG cards are implemented and browser-tested. See `SOCIAL.md`.
- Concurrent cold-room loads now share one initialization promise; 25 parallel requests return one authoritative world instance. Formatting check passes; dependency audit reports zero known vulnerabilities, with 128 license records and zero unknown license fields.

## Active work

Local source checkpoint, operational scorecard and continuing acceptance work. A source/artifact credential-pattern scan found no private-key/OpenAI/AWS-key patterns; runtime data, credentials, SDK binaries, model weights and fixture video bytes are excluded from Git. Review is a local check, not a complete security audit. `RELEASE_SCORECARD.md` distinguishes implemented, experimental and externally blocked gates.

## Real perception evidence

Licensed prerecorded QA videos are downloaded with authors/license/hashes under `tests/fixtures/ATTRIBUTION.json`. Initial detector evaluation (`artifacts/video-evaluation.json`) found objects in 13/15 sampled close-dog frames, 6/15 rainy-dog frames (including a dog/cat confusion), and 0/15 early chair-clip frames. These are observations, not a calibrated benchmark. Red hats and a full occlusion/moving-camera corpus remain unvalidated.

Bounding-box-only perching visibly floated above the dog when the tail raised the box. An optional background worker now computes a local MagicTouch silhouette anchor for animals/furniture; the close-dog composite interaction passes and screenshots show body-relative placement. The newer v2 segmenter stalled at decoding in this environment. The smaller, documented legacy checkpoint was tested successfully instead. This mode remains experimental, does not segment bystanders, and does not unlock camera payouts.

## External and remaining acceptance gates

No configured Twitch/OpenAI credentials, Unity Editor, Android SDK or AR device were found. No public deployment or paid calls authorized or performed. Two-account live raid/chat, broader real source-video alignment corpus, red-hat inference, calibrated visual reward verification and actual native AR build/device/thermal/stream-output tests remain unpassed. Native AR source and authenticated video relay exist; browser WebRTC transport is tested with synthetic composed frames, not a native phone. Native audio, TURN/internet media, multi-process room sharding/Redis, deep social mini-games, advanced persistent structures/physics, clip exports and production operational drills remain implementation/validation gaps.

## Evidence

`tests/`, `artifacts/`, `docs/SETUP.md`, `docs/MOBILE.md`, `docs/ASSETS.md`, `docs/ADR-001.md`. Screenshots of creator source links are masked in current tests. Licensed-video screenshot derivatives retain attribution requirements. No passing live-service or native-device result is claimed.
