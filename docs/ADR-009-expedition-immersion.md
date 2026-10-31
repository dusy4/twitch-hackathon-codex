# ADR-009: Native expedition and audiovisual immersion

2026-10-30. Owner prioritizes the existing Android app. Document current state first (`CURRENT_STATE.md`); defer IRL Pro/other capture compatibility. Obtain an independent review, then implement and validate.

## Experience

An explicit **Explore** action starts a session-local Rift Trail. Measured, stable surface candidates reveal a floating crystal with a contact seal and sparkle. The streamer approaches while keeping it visible; a dwell ring fills, then the crystal dissolves into a pickup burst. Further crystals require at least 1.5 m of newly counted movement and 1.25 m displacement **after the previous pickup**, plus fresh measured support and at least 1.2 m between sites. Three fragments reveal a rift shrine; approach it to restore the trail. A follow-up party objective observes fresh wave, dance or jump actions from two distinct present characters. These are existing independent chat actions; the streamer can simply watch the stub chat respond in practice. This is a local character-state condition, not authenticated viewer-origin proof. Completed trails stay completed until an explicit restart.

The mobile quest is local practice/progression, including when a live room is paired. No competitive Shards, wallet changes, server quest proof or unseen Twitch participants are invented. Existing backend quests/economy remain separate. Neither waiting nor camera panning counts as exploring. No GPS, private frames, remote perception/model or new physical-world instruction is needed.

## Grounding and lifetime

Use tracked horizontal polygons and current depth clearance, camera-aligned samples at bounded cadence, a small whole-footprint margin and stability debounce. Reject foreground obstacles/unknown depth on capable devices at placement. After placement, a missing depth sample gets at most 500 ms grace after actual clear evidence; blocked depth immediately stops collection, with two-of-three consensus before hiding the objective. Short view/radius interruptions drain dwell gently; camera or anchor tracking loss clears it. Maintain one active objective anchor and a bounded recent-site history; never attach objectives to the moving camera or shift them on look-away. A stopped objective can be rescanned/replaced at the same quest step, without fake collection. Background pauses observations and clears pending audio while retaining the session anchor; a new AR session, camera-mode switch or explicit trail stop releases it.

Movement evidence uses ordered unique camera timestamps, a deadband, plausible speed/gaps and recovery settling. Per-site displacement prevents farming progress by wrist jitter or orbiting the phone. This is a game heuristic, not a trusted anti-cheat proof. Fixed-stage characters stay behind by default. Walking mode is a separate explicit choice; viewers retain command ownership.

## Presentation and sound

Use original procedural geometry and the existing CC0 rigs: staged portal opening/closing, bounded orbiting energy motes and ground ripples, crystal facets, an anchored shrine, collection trails, short success bursts and readable world-space objective text. No camera shake, strobing, global tint or heavy always-on particle field. Respect reduced motion, performance budgets and tracking visibility.

Generate five short, original ElevenLabs SFX using the owner's configured paid starter plan and existing allowance: portal open/close, discovery, pickup and completion. Record prompts, generation/model, hashes, credit use and commercial-use basis in the shipped asset manifest. No uploaded recordings or copied game sounds. Normalize and limit mixed output. Provide master SFX gain, mute and phone monitoring controls.

Game effects must enter native relay AAC even with microphone off. Optional microphone mixes separately and keeps its existing explicit consent/runtime permission; mic mute must not mute game effects. Suppress phone speaker monitoring while the mic is publishing to avoid re-recording effects. Local MP4 recording remains explicitly video-only unless an actual muxed audio path is implemented and verified; never imply speaker playback is present in a silent recording.

## Validation

Meaningful pure-engine tests cover measured placement, camera jitter, duplicate timestamps, pause/gaps/relocalization, spawn displacement, visibility/proximity dwell, one pickup per objective, quest transitions, distinct viewer participation, bounded lifetime and PCM mixing/mute/clipping. Compile/unit/lint/signature/alignment followed by actual native camera-off render/quest/audio relay evidence where available. Emulated exploration must be visibly labeled and must exercise the same quest engine. Physical S25 walking/anchoring, spatial listening, thermal and AR-video A/V synchronization remain separate gates.

## Sources

- ElevenLabs generation API: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
- ElevenLabs paid output terms: https://elevenlabs.io/terms-of-use (read 2026-10-30; owner plan checked active starter; no account changes).
- Android PCM AudioTrack: https://developer.android.com/reference/android/media/AudioTrack
- RootEncoder 2.8.1 pinned source, already used in the app: https://github.com/pedroSG94/RootEncoder/tree/2.8.1/encoder/src/main/java/com/pedro/encoder
- ARCore pose/plane/anchor references from ADR-008 and existing pinned integration.
