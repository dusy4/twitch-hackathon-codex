# Native immersion and Rift Trail — 0.11.0

Current baseline inventory: [CURRENT_STATE.md](CURRENT_STATE.md). Design and engineering choices: [ADR-009](ADR-009-expedition-immersion.md). IRL Pro and other broadcasting-app compatibility remain deferred by owner instruction.

## Try it as the streamer

1. Open **AR camera**, scan an open floor slowly and wait for **Landing ready**.
2. **Test raid** opens the portal; Alice, Bob and Charlie join through predefined incoming chat messages. Each controls their own existing character. You can simply watch.
3. Open **Explore → Start exploring**. A measured, anchored crystal appears ahead once the surface is stable. Approach it and keep it in view; the floor ring fills and the crystal is collected. No per-object placement tap is required.
4. Explore new ground after each pickup. Three crystals reveal a shrine. Approach it to restore it; the test viewers then send fresh celebration messages. Fresh emotes from two distinct present characters complete the local trail.
5. The quest card gives objective direction/distance and pause/tracking hints. **Explore** opens progress, pause/resume, end/restart and connected-room quest status. If no test raid or joined characters exist, start a raid or bring in your connected viewers for the finale.

The AR camera starts in **Focus** with object rectangles hidden. **Controls** reveals the full toolbar and camera-off action; **Setup → Show detected objects** enables debug rectangles. **Hide** collapses the practice chat feed. Target selection can temporarily reveal object rectangles. These controls affect the phone HUD, which is already excluded from native broadcast output.

Fixed-stage characters continue to stay where they landed while you explore. **Party walks with me** in Explore (also Walking mode in Setup) is an explicit option; quests do not teleport the cast or take over viewer commands. Follow mode still depends on available ground and may stop at unobserved geometry. 0.11 adds finite-support local routes and temporary depth obstacles; it waits if no measured route is known. This is not a complete room navigation mesh. See [MR_REFERENCE_REVIEW.md](MR_REFERENCE_REVIEW.md).

## Camera-off preview

Choose **Preview test raid → Explore → Try trail preview**. The card explicitly says **SIMULATED TRAIL · LOCAL PRACTICE**. **Walk forward · preview only** advances a synthetic camera by 35 cm, smoothly, through the same quest state machine. The first objective needs a moment of stable observation. Further objectives require actual new simulated movement after the previous pickup; waiting cannot complete the trail. This is a reproducible interaction preview, not evidence of physical walking or phone anchoring.

## Presentation

- Portal blocks settle into place, the membrane has slowly moving energy lines, small motes orbit the frame, a ground ring establishes contact and the portal contracts before closing.
- Original faceted crystal geometry, floor runes, bob/rotation, an anchored shrine, sixteen-segment pickup charge, bounded discovery/arrival/pickup/completion bursts and world-space labels.
- Original ElevenLabs portal-open, portal-close, discovery, pickup and completion assets; quiet original synthesized footsteps/landing ticks. Effects have stereo pan/distance attenuation on the phone. Native relay AAC is currently mono.
- **Setup** includes persistent SFX enable/level, phone monitoring, reduced motion and a discovery-sound preview. Reduced motion defaults from the system animation setting on first use; it removes motes/bobbing/confetti/jump lift while retaining walk/run cycles and readable progress.
- No screen shake, strobe, copied Minecraft sounds, always-on music or unbounded particles.

## Sound and output

Native **Broadcast to OBS / relay** always includes an AAC game-audio track, even with the microphone unchecked. Microphone capture retains its separate explicit consent and Android permission. **Mic mute** suppresses microphone samples while game effects continue. Game mute/level affects effects, not the microphone. Phone monitoring pauses while broadcasting with the microphone to avoid re-recording the effects through the speaker. Phone volume/headphones still control actual local listening.

The phone and relay read independent PCM timelines. Effects are normalized, summed with headroom, softly limited and gently ducked under speech. All encoder-facing timestamps use RootEncoder's elapsedRealtime clock and rational sample-count timing.

**Local 20-second MP4 clips remain silent.** The separate experimental LAN WebRTC path remains video-only. The capture/review UI says so; speaker playback is not assumed to be present in a recording. Use the native relay when testing sound with video.

## Quest rules and boundaries

Placement runs at 4 Hz using actual upward-plane polygons, a 36 cm footprint, overhead-plane rejection and same-frame depth clearance where supported. It waits for stable evidence. Objectives get their own session anchor and stay at the discovered location. There is at most one active objective anchor, six recent locations and four brief visual bursts.

New discoveries after a pickup require at least 1.5 m newly counted travel and 1.25 m displacement from that pickup, plus 1.2 m separation from recent sites. An 18 cm movement deadband, unique frame timestamps, plausible speed/gap checks and settling after relocalization prevent wrist jitter, duplicated frames or a tracking jump from becoming normal progress. These are game heuristics, not trusted anti-cheat proof.

Collection needs proximity, observed visibility, tracked camera/anchor and dwell. Brief view/radius interruptions drain the ring; tracking loss clears it. A missing depth sample receives at most 500 ms grace after clear evidence. Obstacles immediately block collection; consistent blocking hides the objective to avoid single-sample flicker. This is coarse line-of-sight rejection, not a watertight room reconstruction or full per-pixel occlusion. Experimental ARCore depth occlusion remains a separate capability-gated setting.

A lost objective can be remeasured at the same quest step; it never counts as a pickup. Shrine recovery retains the already-completed restore step and party contributions. Pauses and stale/backwards action serials cannot bank unobserved cheers. Background pauses observation/audio; new AR sessions and mode switches reset ephemeral quest anchors.

All trail progress is **local to this session**. It grants no Shards, ledger credit, competitive score or camera-verified reward. The party step observes character state; it is not a server-attested proof of viewer-message origin. Real LIVE rooms already reject the native simulator's creator impersonation controls. Existing server quest evaluation and rewards remain separate and appear as connected-room status in Explore. A future reward-bearing native quest needs a separate server evidence/attestation protocol.

This feature adds no location, frame or quest-progress uploads. Existing paired object lookup retains its separately disclosed camera-processing behavior. No GPS or real-world identity tracking was added.

## Assets and validation

The owner's authorized active paid ElevenLabs starter allowance generated five original short SFX (79 credits total). No plan upgrade/overage or voice/media upload occurred. `assets/audio/manifest.json` ships prompts, provider/model, date, normalization, hashes and commercial-use basis; `scripts/generate-immersion-audio.py` retains existing assets on rerun and reads its key only from the environment. No provider credential is packaged in the APK. Existing character/dependency licenses remain unchanged; geometry and footsteps are original procedural work.

Final build, exact APK hash, unit/lint results and inspected runtime/media evidence are recorded in `artifacts/immersion/verification.json` when verification completes. Physical S25 walking/relocation/depth, real microphone listening and A/V sync, performance after sustained use and real Twitch rehearsal remain handset/integration gates. Software-emulator screenshots and camera-off video do not establish those passes.
