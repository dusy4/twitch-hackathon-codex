# Android recovery — 0.7.0

## 0.7.1 — streamer test raid (2026-10-30)

The owner installed 0.7.0 on an S25 and confirmed that it generally works and stays anchored. The new internal APK is versionCode 12 / 0.7.1-test-chat. Open AR camera → scan a floor/table → tap to place → **Test raid**. A 36-second fixture delivers a count-only raid followed by three viewers' !join messages and independent movement/emote commands. The broadcaster only watches. Alice, Bob and Charlie retain one character each; replay replaces the roster, and completing the chat leaves the characters in place. The feed and portal are clearly marked STUB/TEST. Setup can return to a saved paired room; the phone test needs no server.

The fixture injects messages into the local command handler instead of changing render transforms. Chat opens an optional manual test console, with a fixed viewer identity selector and per-viewer ownership. The automatic chair command uses measured targets or reports failure; it never invents a chair. Commands briefly appear above characters, including in capture output. New frame/track uploads are suppressed in local test mode. Fixed-stage object movement no longer triggers catch-up recall; the explicit Walking mode retains its five-metre recall and is labelled accordingly.

Final build/unit/lint checks pass: **68 Android JVM tests, 0 lint errors / 11 warnings; 82 backend tests pass / 1 conditional PostgreSQL skip**, web build/typecheck pass. A new backend test sends three named stub chatters and a raid through the actual EventSub inbox, verifying ownership, repeated joins and !w/!a/!s/!d support. That does not establish live Twitch integration. an independent reviewer reviewed the change read-only; its camera-upload and portal-lifetime/support findings were addressed. Details and remaining gates: [ADR-006](ADR-006-test-raid-chat.md).

SHA-256: `841a047593f64c7a0fa755defe1cbc899f80371d00110bcfe86f123ecaeffcfc`. APK signature and 16 KiB ZIP alignment pass. Boat renders the native portal, three named characters and completed 15-message replay, and encodes a valid camera-off H.264 clip. Software-emulator speed is not a phone performance benchmark. Physical validation of this build's AR portal entry, look-away/relocalization, camera-composited MP4/OBS output and thermals remains open. The owner's report of initial anchoring is recorded as feedback, not a measured drift benchmark.

The 2026-10-30 owner recording was inspected privately. Work is on `fix/android-ar-recovery`; decisions are in ADR-005. The requested consultant ran in an independent reviewer with independent review, effort `high`, read-only. Its findings were reviewed, not automatically accepted: Google's actual Raw Depth sample uses texture intrinsics, so its proposed CPU-intrinsics change was rejected after checking the primary source.

## Changes

- Fixed stage is the default. Camera heading no longer continually moves idle characters or their object-relative approach offsets. Idle facing stays stable. Walking mode is opt-in.
- Presentation time integrates across skipped display frames. Regression tests at 60/90/120 Hz prevent high-refresh screens from freezing locomotion. Walking-mode anchor replacement does not translate world-space bodies by the new anchor offset.
- Only a short single tap can place a stage. Subsequent taps select targets only in explicit selection mode; drags/pinches do not relocate characters. Stage relocation is under Setup → Move stage. Instant Placement's guessed distance is disabled.
- New characters start on measured support instead of falling from the probe height. Anchor changes reset contact state synchronously; backgrounding pauses the session and outputs without discarding the stage.
- Every local inference receives owned source-frame pose, calibration, planes and depth. Raw observation boxes sample that capture's geometry; smoothed boxes are presentation-only. Old generations, >900 ms results, and stale depth are rejected. Reprojection predicts screen positions for identity association. Inconsistent depth outliers cannot move an established anchor.
- Recognition sees the displayed image crop, filtered into a square with explicit neutral padding, with an exact inverse for boxes. EfficientDet-Lite2 int8 is the default; sustained >450 ms complete worker times fall back to Lite0. Inference and JPEG work stay off the rendering thread with one in-flight frame. No performance claim is derived from desktop measurements.
- Camera-only AR UI is mostly unobstructed by default: Play expands actor/action controls, Target selects a measured object/surface, Chat opens command entry, Capture contains recording/broadcast. The local playground works without a PC or pairing and stays visibly labelled LOCAL. Practice raids never claim authentic Twitch participation or issue currency.
- Tap-named surfaces appear in the paired room with stable IDs. `actorId` and `targetHint` address the exact selected simulator actor/target. Capture tokens cannot invent viewer identities in LIVE mode; real viewers use Twitch chat or their authenticated controller.
- A raid portal is attached near the measured stage and follows its own ARCore anchor. Original block geometry and bundled CC0 characters are used. Local preview can exercise the raid effect too.
- Chair sits compensate for the actual authored pelvis translation shared by all four rigs, instead of placing standing feet at the seat. This is a measured rig pivot correction, not general chair-pose estimation or foot IK.
- Static furniture anchors remain addressable for a bounded 15-second look-away interval; animals/people still expire. Remembered furniture is marked `world_anchor` in track attributes. Model initialization failure falls back to Lite0 as well as slow inference.
- Native targets use a matching .32 confidence gate after local temporal/geometry checks, without inflating the model score. The default web-source .5 gate stays intact. Unlocated native boxes are visible as candidates but are not published as usable AR targets.
- MPImage input bitmaps are owned per inference because MPImage.close recycles its Bitmap. Recorder input Surface identity is retained through stop/dispose; this prevents leaving a released surface attached to the mirror.

## Model checks

Official checkpoint: `efficientdet_lite2/int8/1`, 7,515,971 bytes. Hash and upstream sources ship in assets/models/efficientdet_lite2_int8.provenance.json; notices are retained. No new model runtime dependency, Ultralytics, EdgeTAM or Liquid is bundled.

`artifacts/recovery/fixture-letterbox-comparison.json` compares the same licensed chair/dog frames before/after padding, with both existing Lite0 and new Lite2 at score threshold .32. On the three sampled clear-dog frames, both unpadded models called the dog a horse; padded inputs correctly returned dog. On the three sampled rainy-dog frames, padded Lite2 returned dog in all three, whereas padded Lite0 returned cat, cat, dog. These are small reproducible samples, not a general recall estimate. The room recording contains already-rendered game characters, so recognition of those pixels cannot establish raw-camera accuracy; those limitations are retained in detector-comparison.json.

Private recording pixels and intermediate frames remain local and are not included in the APK or source commits. Standalone evaluation uses `scripts/evaluate-native-detectors.py` and optional Python libraries outside the app.

## Run

Open the APK → Open AR camera → slowly scan a floor/table → tap once to place. Use Play to choose a character and action. Target → tap an object or exact seat/surface → name it → Sit here. Recognition is helpful but a missed label does not block measured tap selection. Use Setup to connect the existing room; simulator quick-pair is available in the internal build. Capture contains silent local MP4 review/share/discard and the existing private RTMP/SRT relay workflow.

Building: `./scripts/build-android.ps1 -Tasks @('testDebugUnitTest','assembleDebug','lintDebug')`. Backend/web: `npm run build`, `npm test`. Live Twitch requires the existing owned OAuth/EventSub setup; an APK does not replace the world service. Camera quests remain untrusted for physical rewards.

## Validation status

Final automated checks: 64 Android JVM tests pass; Android APK assembly and lint pass (zero errors, 11 warnings); 80 backend tests pass with one conditional PostgreSQL skip; web build/typecheck/formatting pass; three Chromium integration checks pass. APK signature and 16 KiB ZIP/native-load alignment pass. No physical 16 KiB runtime claim is made.

Boat exercised actual native preview rendering, independent local actions, quick pairing and selected-actor command through the real private HTTP server (Emberfox danced while Mossling remained idle). Screenshots and a sanitized authoritative snapshot are in artifacts/recovery. These runtime screenshots came from intermediate 0.7.0 candidates; the final APK hash is in verification.json. Later resource/timing corrections also have JVM/source review evidence.

**Open physical gates:** ARCore camera feed rendered in Boat, but camera/IMU timestamp errors prevented a trustworthy plane/anchor/drift pass. The older candidate's MP4 lacked a moov atom; final code caches recorder Surface identity and validates a video track before presenting a clip as ready, but final physical capture/playback remains unpassed. Late software-emulator install/control attempts timed out and are retained as failures. Do not call those passes or infer S25 performance from them. Redmi was online through Tailscale but refused TCP ADB. S25 walk-around, occlusion, thermal/FPS, final clip and live Twitch/relay checks remain required.

The final build is an internal signed APK. It is available locally and through the existing private tailnet /apk route. The private test-room server is SIMULATOR mode, keeps original configured planner/sidecar adapters, and runs from the updated source. No live Twitch event or paid QA inference is claimed. An actual LIVE backend still requires the owner OAuth/EventSub setup documented in SETUP.md.
## 0.8.0 natural-language movement

Latest internal build: RaidRift-0.8.0.apk, versionCode 13, SHA256 ea8740147f1a3443acf7c55dd9e34666917da820ff1405e4d3c6a08613b62085, 123385425 bytes. It updates the same debug-signed package.

Open AR camera, scan and tap a surface, then Test raid. Alice, Bob and Charlie now send ordinary English/Ukrainian messages for walking, turning, dancing and jumping. The streamer only starts the raid. Optional Chat accepts `walk right then jump`, `come closer`, `turn around then dance`, `йди ліворуч`, `стрибни`. Recognized language is a bounded offline grammar, not unrestricted model comprehension. Directions refer to the placed stage. Existing `!` commands remain compatible.

Preview and AR both move through intermediate positions. Models turn smoothly and use separate walking/running clips; jumping has a visible root lift, one-shot animation and landing. No new rig pack or scene-understanding model is required for these actions. See ADR-007 and artifacts/natural-motion/verification.json. A new physical S25 walk/jump test is still required.
