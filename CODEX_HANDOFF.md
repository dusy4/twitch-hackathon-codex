# RaidRift — definitive autonomous Codex handoff

**Product:** RaidRift / RealityQuest. **Status:** complete product requirements and research handoff, with a previous visual prototype in `prototype/`. **Date:** 2026-10-27. **Owner directive:** no delivery deadline; maximize polish, realism, whimsy and production readiness; proceed autonomously with available tools.

## Vision in one paragraph
Turn each Twitch broadcast into a persistent multiplayer universe. A real Twitch raid tears open an enormous Minecraft-inspired obsidian-and-purple dimensional portal; raiders emerge as tiny **individual voxel avatars** and continue living on screen. Every authenticated viewer owns a persistent character who can move with commands or issue open-ended natural-language instructions such as `!rift sprint towards the dog and sit on it`. The app finds the dog visible in the **video**, synthesizes a safe, cartoonish in-world animation of the virtual avatar sprinting over and sitting on the dog's apparent location, and responds to camera movement, object movement and scene changes. Streamers and communities cooperate in AI-verified real-world quests and earn **Rift Shards**, tracked on a beautiful, publicly accessible website with lifetime, seasonal, weekly and channel leaderboards, persistent profiles and economies. Cross-stream raids are shared game events, not just alerts.

**CRUCIAL:** all scene agents and entities are virtual overlays. Commands refer to *visual objects in the streamed scene*. They do NOT direct the actual streamer, dog or bystanders to do anything. For example `!rift follow the person in a red hat` = render the avatar following the visible target's screen/world position while it is observable; never identify or persistently track a real person's identity/location.

## Product surface
- Public web: landing, live worlds discovery, player profiles/avatars, seasonal/weekly/all-time Rift Shards leaderboards, streamer/faction rankings, quest history, inventory, shop, activity feed, cross-stream raid history, optional replay/highlights and shareable cards.
- Streamer web app: onboarding with Twitch OAuth, OBS Browser Source URL, camera/source geometry setup, vision opt-in, world configuration, quests management, moderation, audio levels, reward rules, live monitoring, in-app test raid and diagnostic tools.
- OBS overlay: transparent low-latency 2D/3D composite with original Minecraft-inspired portal, voxel cast, particle/light/sound design, coherent collisions/shadows, queue-able per-avatar animations and multiplayer interactions.
- Viewer controls: simple Twitch chat commands plus `!rift <natural language prompt>` (support `!ourapp` alias); optionally browser controller with D-pad/touch, inventory, target selection, emotions, summonable cosmetic creatures, approved action history.
- RealityQuest: moving video analyzed for objects/poses/masks/anchors; virtual avatars interact with visual objects and each other; streamer-driven and viewer-cooperative quests; OpenAI Decisions verifies observable quest predicates.
- Mobile IRL capture: world-anchored AR with ARCore/ARKit (via Unity AR Foundation or rigorously justified native equivalent), pass-through compositing and live output, with capability-gated occlusion/depth and fallbacks.
- Operator/admin: fraud controls, cost/rate dashboards, moderation actions, leaderboard rollbacks, connected streamer health, user deletions, privacy and retention configuration, asset management.

## The nonnegotiable wow moment
An IRL broadcaster is walking a dog. A Twitch creator raids: the picture shudders, a colossal purple portal materializes next to the dog, and a stream of voxel characters pours out with personal names. Viewer Alice types `!rift sprint towards the dog and sit on it`; Alice's tiny character dashes across the image, hops atop the *visually rendered* dog position and sits, bobbing with the tracked dog. Bob tells his character to climb the park bench, dance, and throw a magical confetti burst; then a shared quest appears — "Get three tiny heroes onto the bench" — and the game verifies the **virtual** condition authoritatively, awards Shards, and updates the public leaderboard in real time. The streamer can remain wholly uninvolved, or choose an opt-in physical-world quest.

## Invariants and product choices
1. **Real Twitch raid ≠ roster of all raiders.** EventSub `channel.raid` supplies broadcaster IDs and viewer count, not each attendee's identity. Show beautiful anonymous silhouettes for unclaimed participants; authenticated/chat-participating viewers resolve to individual persistent avatars. Never mislabel anonymous silhouettes with random Twitch usernames.
2. **Stable identity:** Twitch numerical user ID, never display name. OAuth authorization links account; chat EventSub's chatter ID can route actions to Twitch ID; use verification/permissions as needed. Twitch Extension opaque IDs are not equivalent to known Twitch IDs until identity is explicitly shared/linked.
3. **No client-side balance mutation.** Keep an immutable, idempotent Shards ledger. Separate lifetime earned, spendable balance, season XP, competitive score. Never mint money-equivalent currency or promise Twitch Bits/Channel Points awards.
4. **Natural language is a *declarative choreography planner*, never remote code execution.** The model emits typed game actions within engine capabilities; the server validates targets, resource budgets, moderation policy, rate limits and authorized game scope.
5. **Video semantics != physics.** 2D overlays can convincingly fake target-following and contact in static/framed footage using detection/tracking; truthful 3D world locks and occlusion on moving phones require AR pose/depth or explicit coarse fallback. Do not advertise unimplemented real-world geometry.
6. **Quest verification != invention.** OpenAI Decisions returns probability estimates about observable evidence; reward state transitions are evaluated and minted only by our backend after temporal evidence rules and anti-cheat checks.
7. **Creators control participation:** connect/disconnect, explicit camera processing consent, allowed command categories, SFX levels, max players and rendering density, kill switch, filter, blocked users, cooldown, anonymous participant policy, privacy and opt-out.
8. **Creative excellence:** original, highly legible game quality, coherent color and audio language, cinematic raid choreography, satisfying micro-interactions, replayable emergent multiplayer moments and polished responsive website. Prioritize moment-to-moment fun, not generic SaaS controls.
9. **Build all modules, not just prototype.** No deadline. The phases in `docs/IMPLEMENTATION.md` are ordering, not scope cuts.

## Command semantics examples
```text
!join                                      => claim/spawn player's linked avatar
!left / !right / !up / !down / !jump       => deterministic movement primitives
!dance / !wave / !sit                      => expressive actions
!rift sprint towards the dog and sit on it
!rift climb onto the table and do a backflip
!rift hide behind the streamer and wave
!rift follow the person in the red hat
!rift summon a tiny dragon and ride it
!rift grab the coin on the ground and bring it to @Alice
!rift make a 5-person human pyramid in front of the portal
!rift follow @Bob then challenge them to a wizard duel
!rift build an obsidian throne beside that chair
!ourapp play chess against @Bob on the streamer's desk
```
Implement prompt parsing robustly: multi-action sequencing, pronoun resolution, semantic target search and disambiguation, object affordances, navigation, 3D/quasi-3D movement, original animations, speech bubbles and reactions, failure explanations. NPCs and effects must have bounded complexity and auto-expire. If a target is not visible or cannot be found, gracefully show "Couldn't find a dog — I'll wait nearby" or let the viewer select a target in the controller; never teleport pretending evidence existed.

## Suggested default stack (reassess with current docs)
- pnpm + TypeScript monorepo, Next.js for website/dashboard/SEO, Vite for separately optimized OBS overlay; React Three Fiber / Three.js for avatar and portal render; PixiJS for dense 2D particles and user labels; Rapier for deterministic virtual contacts; original Web Audio / licensed audio assets.
- Fastify or NestJS API, standalone durable WebSocket authoritative world service (room/shard), Twitch cloud EventSub webhook/Conduits as appropriate, independent jobs/workers; PostgreSQL via Drizzle/Prisma; Redis for ephemera, queues and cross-instance pub/sub. Do not host persistent world simulation solely as short-lived serverless functions.
- Twitch broadcaster OAuth Authorization Code + PKCE where applicable, secret management/refresh, webhook HMAC/nonce replay protection, OAuth account linking for viewers and scoped moderator/creator settings.
- OpenAI Responses API Structured Outputs for prompt -> typed action plan; OpenAI Decisions `gpt-6-luna` for multi-frame semantic quest evidence; local visual tracker/detector + optional server GPU SAM 2 (Apache 2.0), calibration and configurable model selection. Confirm every detector's model+code license; Ultralytics YOLO has AGPL/Enterprise constraints.
- Desktop: streamer grants opt-in source-frame access through companion app / OBS integration; transform image-space target anchors to OBS source-space; OBS browser source renders. Mobile IRL: Unity AR Foundation + ARKit/ARCore + RTMP/WebRTC output or rigorously validated alternative; try real AR before using web-only billboard effects.
- Playwright e2e and screenshots, Vitest unit/property tests, integration tests with real PostgreSQL + Redis and synthetic EventSub hooks; separate load test and multi-stream soak suite.

## What to do next
Read `AGENTS.md`, then `docs/PRODUCT.md`, `docs/AI_RUNTIME.md`, `docs/ARCHITECTURE.md`, `docs/DATA.md`, `docs/API.md`, `docs/QUESTS_ECONOMY.md`, `docs/UX_ASSETS.md`, `docs/IMPLEMENTATION.md`, `docs/ACCEPTANCE.md`, `docs/RESEARCH.md`. Inspect `prototype/` and refactor/reimplement rather than assuming it is production-ready. Start implementing vertical slice 1, then continue autonomously through all milestones; leave transparent progress docs. Do not ask for a deadline, and do not invent a delivery date.

## External constraints
Twitch OAuth/Developer app credentials, OpenAI key, domain, billing or production deployments may require owner authority. Exhaust all feasible local/preview work before treating them as blockers. Build configuration guidance and sandbox mocks, but do not pass them off as successful live integration. Do not initiate spending, paid model training, public Twitch production activation, or irreversible production actions absent authorization.
