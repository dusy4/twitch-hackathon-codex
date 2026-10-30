# RaidRift: current product state

Updated 2026-10-31. This is the entry point for current capabilities; earlier progress logs are historical. The 0.9 table records the baseline, followed by the current 0.10 additions.

## Product and priority

RaidRift turns a Twitch raid into a portal and individual viewer characters in the streamer's physical surroundings. Each identified viewer controls their own character through chat. The owner has confirmed that native placement works and stays anchored, and that the subsequent natural-chat/movement build works. Current priority is native Android immersion and walking/exploration quests. IRL Pro and other broadcasting-app compatibility is deferred until this experience is solid.

## Native Android, through 0.9.0

| Area | Implemented behavior | Evidence and limits |
| --- | --- | --- |
| Camera/world | ARCore camera pose, planes, optional depth, session anchors, SceneView/Filament composition | Owner confirmed anchoring in earlier builds. Latest automatic placement requires physical S25 validation. Anchors do not persist across sessions. |
| Landing | Continuous 4 Hz measured footprint/depth evaluation; stable evidence before automatic placement; manual tap override | JVM tests. One stage, not a complete reconstructed room or navigation mesh. New arrivals wait for observed clear support. |
| Characters | Four existing CC0 KayKit rigs with authored clips; three fixed stub identities in practice | Smooth surface motion, facing, crossfades, jump envelope/contact shadows. Exact phone animation quality and prolonged thermal performance remain to test. |
| Commands | Bounded English/Ukrainian phrase parser, sequences and target resolution | Offline deterministic grammar, not an LLM. Each stub viewer controls only their own character. |
| Raid practice | Count-only raid, portal, three viewers' scheduled input chat messages routed through normal local command handling | Explicit STUB/TEST labels. Does not fabricate a Twitch raid roster, live users or currency. |
| Walking | Fixed stage stays behind by default; optional follow mode walks toward the camera using surface support | Physical walk-away/relocalization remains a test gate. Unknown geometry is not a guarantee of traversability. |
| Recognition | On-device EfficientDet-Lite, optional paired server tracks, manual measured target labeling | Object/seat quality remains limited. No YOLOE, EdgeTAM, Liquid model or trained seat-affordance network has been integrated. |
| Visuals | Original portal blocks/ring, confetti, shadows, optional experimental depth occlusion | Occlusion defaults off because low-resolution depth can hide small characters at floor contact. |
| Recording/output | Explicit local 20-second MP4, native composed H.264 to SRT/RTMP/RTMPS; optional mic AAC; private PC receiver | Actual camera-off native video received/decoded. ARCore paused in emulator; no physical AR-camera relay, A/V-sync or full live Twitch pass. Local clips through 0.9 are silent. HUD is excluded from output. |
| Readiness | ON AIR requires connection plus recent encoded video; WAIT for an unready video source | Does not prove remote viewer reception. Private Tailscale receiver must be running. |

Latest baseline: version 0.9.0-auto-landing / code 14; SHA256 c080a33ab09b1e409e31d312992b1e8e6c13d130923af03e390afba8042c6ada. 86 JVM tests passed; build/lint/signature/16 KiB alignment checked. Evidence: `artifacts/auto-landing/verification.json` and `docs/AUTO_LANDING.md`.

## Current native update: 0.10.0-rift-trail

Code 15 adds a session-local Rift Trail: measured anchored discoveries while walking, three crystal pickups with proximity/visibility dwell, shrine restoration and a fresh two-character party finale. Stub responses are incoming per-viewer chat messages. Quests do not teleport or commandeer characters and do not award Shards. Connected server quest status is visible separately. See [IMMERSION.md](IMMERSION.md) for the streamer flow, explicit following choice and labelled camera-off preview.

Portal construction/energy/motes/closing, arrival/pickup bursts, original faceted crystals/shrine/runes, compact quest HUD and objective direction/distance hints are implemented. Five original owner-authorized ElevenLabs effects (79 existing credits) and synthesized footstep/landing ticks play offline. Native relay AAC includes game sound with the microphone off, and optional mic mixing/mute remain separate. Persistent sound level/mute/monitor and reduced-motion controls are available; reduced motion preserves walking cycles. Local MP4 and experimental WebRTC remain silent.

Exact current APK: SHA256 **bd6aaf3b5c5b42a5419e816c60cf7254cd01b55539e0490ff4def8ff37148852**, **122092479 bytes**. 110 native JVM tests and build/lint/signature/alignment pass (0 lint errors/12 warnings). Complete actual native UI quest rehearsal passed on the exact APK: four discoveries, three pickups, shrine restore and distinct character emotes completing the trail. The exact native H.264+AAC composition was received/decoded on the PC with microphone permission denied. Output sound/mute checks and final receipts are under `artifacts/immersion/final` and `verification.json`. This is camera-off software-emulator evidence; new walking/depth behavior on the physical S25 and real AR/mic A/V sync remain open.

## Backend and browser surfaces

The repository also contains OAuth/EventSub ingestion, numeric viewer identity, server-owned worlds/actions, an idempotent Shards ledger and inventory, quest evaluation, public profiles/rankings, creator tools, browser controller/overlay and consented source capture. Earlier synthetic signed Twitch-event and backend/browser suites are documented in `PROGRESS.md`; they are not a completed two-account live Twitch rehearsal. Last unchanged backend suite: 84 passes plus one conditional PostgreSQL skip.

Browser source capture uses camera or an explicitly selected raw OBS source projector. It does not secretly read another app's camera, and its image-space detection/tracking is not native ARCore geometry. Camera-derived competitive rewards remain gated; native device geometry must never directly mint Shards.

## Deferred compatibility

IRL Pro supports URL web overlays. No public native SDK exposing frames/intrinsics/ARCore pose/depth was established in the compatibility research. A browser portal/chat integration is plausible, but the APK's anchored AR is not a drop-in web overlay. Future choices are an agreed native integration or synchronized incoming-video analysis/compositing in the existing relay/PC/cloud setup. Neither equivalent full-AR path has passed end to end. Do not replace the current native priority with this work.

## Remaining product gates

- Physical S25 test of automatic placement, following, tracking loss, long walks, depth and sustained rendering/temperature.
- Actual AR-camera + sound/microphone relay to OBS, framing, latency and A/V synchronization.
- Real Twitch OAuth, raid and chat rehearsal with two accounts and correct individual ownership.
- Better affordance/object-relative interaction and robust measured navigation beyond simple surface contact.
- Expand the new session-local Rift Trail into richer contextual content and server-attested progression; validate the new visuals/audio/onboarding on the owner's phone.
- Server-attested native quest evidence and audited rewards before any competitive Shards for physical exploration.
- Public release asset/model terms review and store/deployment checks. This is a private development build, not a production-ready release.

## Source map

- `apps/android/app/src/main/java/world/raidrift/capture/MainActivity.kt`: camera/session, streamer controls, rendering and output wiring.
- `NorthstarScene.kt`, `LandingPlanner.kt`, `SurfaceMotor.kt`, `HeroAnimator.kt`, `MotionState.kt`: scene, support, movement and animation.
- `Playground.kt`, `TextIntent.kt`: practice inputs and deterministic command grammar.
- `WorldConnection.kt`, `WorldFrames.kt`: authenticated room/native protocol.
- `RelayOutput.kt`, `CompositeOutput.kt`, `LocalClip.kt`: output transports and local recording.
- `apps/api`, `apps/web`, `packages`: authoritative service and browser product. See root README and `docs/SETUP.md` for exact runtime commands.

Source repository: `raidrift-codex-handoff`, branch `fix/android-ar-recovery`. Preserve prior QA artifacts and distinguish recorded synthetic-room/emulator evidence from real handset results.
