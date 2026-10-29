# Android phone capture

For the downloadable test APK and laptop-over-Wi-Fi setup, start with **[Android LAN test](ANDROID_LAN_TEST.md)**. The debug APK now accepts RFC1918 IPv4 HTTP servers; release builds still require HTTPS. The LAN launcher creates an isolated two-character simulator without external credentials.

The owner confirmed **Android phone** as the target on 2026-10-29. `apps/android` is a Kotlin/Compose client using pinned SceneView 4.62.0, ARCore 1.57.0 and Filament 1.72.1. It is separate from the preserved Unity source in `apps/mobile`.

Current evidence: debug APK compilation, 19 JVM tests and Android lint (zero errors, six version/target warnings) pass. Four skeletal GLBs pass Khronos validation. Actual native camera-off 3D has been encoded over SRT, decoded and recorded in OBS through a private MediaMTX/custom WHEP bridge. Latest measured action-to-OBS upper bound is 1.948 seconds; authoritative pause-to-cleared content is 4.579 seconds. This does not pass tracked AR. A direct ARCore diagnostic detected up to six horizontal planes, while integrated tracking/performance is still being isolated. Physical-phone and field acceptance remain open. Exact build scopes: `artifacts/android-runtime-qa.json`. Ready-stack comparison: `AR_OPEN_SOURCE_RESEARCH.md`.

## 0.5.0-northstar (versionCode 6): raid portal, chat, on-device detection

Build evidence (2026-10-29): `testDebugUnitTest` 39/39 JVM tests pass (16 new in `NorthstarTest`), `assembleDebug` and `lintDebug` succeed (0 errors). Nothing below has run on a phone yet.

- **Server over Tailscale.** Debug builds prefill `https://raidrift-pc.tail7252b4.ts.net` and accept `http://` to private IPv4, loopback and Tailscale CGNAT `100.64.0.0/10`; release still requires HTTPS. The debug network config permits cleartext globally (XML cannot scope by IP range); `ServerAddress` enforces the ranges. **Quick pair (test server)** in the pairing dialog calls `GET /v1/debug/pair` and connects. Debug builds remember the server URL and token in app-private SharedPreferences and reconnect on relaunch; disconnect or revocation clears the token. Broadcast is prefilled with `rtmp://raidrift-pc.tail7252b4.ts.net:1935/live/raidrift` (RTMP over TCP; SRT/UDP does not traverse this setup).
- **Chat bar** (when paired): text field and Send, chips `run to the dog`, `sit on the dog`, `dance`, `jump`, `!join`, and an `as Streamer` / `as <random viewer>` toggle. Posts `POST /v1/native/chat`; the reply (plan summary or an error such as "Couldn't find a dog") shows for 5 s.
- **DBG panel** (debug builds): raid (from/viewers/chatters 0-12), chat as random viewer, duplicate raid, revoke (`authorization_revoked` / `user_removed`), create quest (sit near dog, 2 players), reset; 1 Hz `GET /v1/native/debug/state` (log, inbox, AI provider/latency/error, quests, leaderboard); local AR state/failure, planes, depth, FPS, detector Hz/latency, detections with 3D source, anchor, connection, relay/LAN output, last tracks POST; toggles for detection boxes and the detector.
- **Detection.** MediaPipe Tasks Vision 1.2.0 + EfficientDet-Lite0 float16 (COCO) on ARCore CPU images, at most 5 Hz on one background thread (YUV to a ~320 px upright bitmap). Boxes are mapped to the displayed view with `Frame.transformCoordinates2d(IMAGE_PIXELS -> VIEW_NORMALIZED)` (rotation and crop), tracked with an IoU/centroid tracker (`ph-dog-3`), and posted to `/v1/native/tracks` every 400 ms while paired. Each track's bottom-centre is hit-tested (plane, then depth/feature point, then a ray onto the lowest floor or 1.4 m below the camera) into a smoothed 3D foot map (dropped after 2 s, held 5 s for resting heroes).
- **Targets.** A hero whose `target` is a known track runs (1 m/s, `Running_A`) to a ring slot around it; with `sit`/`lie` it goes onto the object, lifted to about 80% of the estimated box height (`Sit_Chair_Idle`), or beside it on the ground. Others keep Follow-me/room-anchor goals. Heroes now face their walking direction (or the camera) and play `Walking_A` while moving.
- **Portal.** A new raid id opens a ring portal (two tori and a "RAID FROM NAME · N" banner) 2.5 m ahead on the ground, or on a wall hit at screen centre, for 10 s; heroes with `spawnedAt` in the last 10 s start at the portal. `confetti` props burst 24 small cubes for 2 s; other prop kinds are listed in DBG as not rendered.
- Compose overlays (chat, toast, DBG, detection boxes) are not in the SurfaceMirrorer output, so they never reach the relay or recording.

## Build and install

From the repository root in PowerShell:

```powershell
./scripts/setup-android.ps1 -InstallSdk
./scripts/build-android.ps1 -Tasks testDebugUnitTest,assembleDebug,lintDebug
```

The setup downloads verified official Microsoft JDK 21, Gradle 9.8.1 and Google SDK tools into ignored `.tools/`. It changes environment variables only in the current process. Node is required to prepare the same pinned KayKit CC0 models used by the browser. The generated derivatives remove root displacement and unused hand weapons while retaining the skeletal animations; source assets remain unchanged. The Gradle wrapper also pins the distribution SHA256.

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Application ID: `world.raidrift.capture.android`. Minimum Android API 24 with a 64-bit ARM phone (x86_64 is also built for emulation); the device must separately support ARCore for room mode. Ordinary 3D preview works independently of AR availability. You can also choose Start room AR before pairing to place one explicitly labelled LOCAL PREVIEW character; the shared live community requires pairing. Debug signing is local, with no store publication or release-signing claim.

For an attached, developer-authorized phone:

```powershell
./.tools/android-sdk/platform-tools/adb.exe devices
./.tools/android-sdk/platform-tools/adb.exe install -r ./apps/android/app/build/outputs/apk/debug/app-debug.apk
./.tools/android-sdk/platform-tools/adb.exe reverse tcp:3400 tcp:3400
```

No phone was attached during the recorded build checks. USB debugging authorization happens on the handset. The reverse tunnel lets this debug app use `http://127.0.0.1:3400`. Without USB, use the private IPv4 HTTP LAN setup in `ANDROID_LAN_TEST.md`, or a trusted HTTPS deployment reachable by the phone. Only debug builds permit private IPv4/loopback HTTP; production requires HTTPS. Redirects are refused.

## Use the actual world

1. Start the existing server on port 3400. In Creator Studio choose **Pair native AR + share composed video**, which explicitly creates a one-hour scoped camera token. Paste that token into the Android pairing form. Tokens remain in memory, outside saved state, URLs and application logs.
2. Use the local 3D preview first. A disconnected preview is labelled **LOCAL PREVIEW**; a paired simulator is labelled **SIMULATOR** in the actual 3D scene, including recordings. Real account identities come only from the authoritative snapshot. Reported raid counts never create named actors.
3. Choose **Start room AR** and grant camera access. Move slowly to detect a desk/floor, then tap the visible surface. ARCore creates a real anchor. No image-coordinate or stationary-camera substitute is used for native tracking.
4. Move around the anchored characters. Depth is requested only where supported; the status distinguishes support from actual current depth frames. The library's depth composition is enabled, but accuracy and dynamic-hand occlusion need device validation.
5. Up to 12 named models render locally, following server choreography targets through a bounded 0.45 m/s presentation motor. Measured horizontal planes and recent depth provide support and gravity; a detected lower floor permits a desk-to-floor fall. Unknown support freezes existing movement and prevents unsupported new actors from appearing. Detected finite vertical plane polygons now block the character capsule; their geometric crossing and disappearance behavior have JVM coverage. Arbitrary mesh navigation, object recognition, hand grabbing, full gesture/cosmetic parity and physical collision accuracy remain incomplete. Anchor pose corrections rebase the local contact bodies; tracking loss clears them before reacquisition. These local contacts never grant rewards or overwrite authoritative server coordinates.
6. **Record 20s** explicitly starts a silent local MP4 of the rendered scene. This includes the native camera background in AR plus the virtual characters through SurfaceMirrorer, rather than an ARCore dataset recording. Capture is bounded to 20 seconds/12 MB and stops on backgrounding, tracking loss, pause, disconnect or revoked pairing. The scene's mode label is included; Compose controls are excluded. Viewer names and camera footage are visible, as the UI warns before recording. **Review** plays the file inside the app with the camera off; a pending local file is recovered after an app restart. **Share** opens Android's chooser only on user action; **Discard** deletes the clip. No automatic upload occurs. Actual encoded camera-plus-character frames remain unverified until runtime testing.

The app polls `/v1/native/world` with a scoped Authorization header. Responses are `private, no-store`; invalid/wrong-role/expired/revoked tokens fail closed. A camera token cannot submit viewer actions. Native world/clip controls do not mint Shards. Connection loss hides paired content and stops recording rather than silently presenting stale characters as live.

The Android client also contains an **experimental, video-only direct-LAN WebRTC producer**, pinned to `io.github.webrtc-sdk:android:150.7871.04`. Enable its explicit sharing consent under LAN output, then Start sharing while an authorized AR room is tracking. SurfaceMirrorer feeds a SurfaceTextureHelper/VideoSource; the existing paired `/receiver` is the destination. Native authentication uses an Authorization header, not a query token. Receiver-first and producer-first signaling, one offer notification and session teardown pass server tests; real browser synthetic frame transport and shutdown pass. Actual native encoded frames and native phone→OBS transport remain unvalidated. No STUN/TURN, microphone or audio mix is configured. A 20-second connection bound, pause, tracking loss, backgrounding, revocation and receiver departure stop output; no automatic retry restarts camera sharing. The uncompiled Unity producer is a separate source path.

## Native relay output

**Broadcast** accepts the streamer's private SRT caller or RTMPS/RTMP ingest URL. The existing relay watch URL goes into the streamer's home/cloud OBS Media Source. This replaces the field encoder for this AR camera angle; no IRL Pro plugin or simultaneous second camera owner is assumed. `RelayOutput` encodes the Filament surface at 1280×720, with an optional permission-gated 48 kHz mono AAC microphone. Compose controls and pairing/ingest fields are absent from that surface. Ingest credentials stay in memory and transport logging is disabled.

Explicit output consent is required. Audio defaults off. Mute and 1/1.5/2.5/4 Mbps manual controls are available during output. AR output requires a tracked anchor; camera-off preview can be broadcast for an explicitly labelled setup test. Backgrounding, tracking loss, pair failure, pause, disconnect and review stop output. Initial connection is bounded to 20 seconds with up to three transport retries. Automatic bitrate adaptation, SRTLA bonding and managed OBS BRB configuration are still open. Plain SRT/RTMP do not imply encryption.

Private SRT → local relay → actual OBS 33 recording has decoded video and AAC signal evidence. Delay remains under investigation; this is not yet a passing real-time streamer trial. No live Twitch/paid provider or physical phone claim is made. Experimental LAN WebRTC remains video-only and has a different validation scope.

## Phone acceptance still required

Install/launch; denied and granted camera permission; ARCore missing/unsupported state; independent named actor actions; desk/floor anchor parallax and drift; loss/reacquisition and reset; plane/depth support loss; real occlusion; recording/decode/visual inspection; share/discard; pairing expiry/revocation; pause/background/camera shutdown; memory, frame cadence, battery and thermal behavior. Software/emulator rendering cannot establish physical measurement quality.

This PC reports firmware virtualization disabled and no hypervisor. Google's emulator documents software emulation as unsupported and very slow. Emulator experimentation is a separate gate, not a physical-phone pass. See [official emulator acceleration guidance](https://developer.android.com/studio/run/emulator-acceleration) and [ARCore emulator setup](https://developers.google.com/ar/develop/java/emulator).

Research decisions and license boundaries: `ADR-004-native-android.md`, `LUCAS_MR_REFERENCE.md`, `ASSETS.md`. No Grok stack assertion or Nintendo asset/code is used.

Native binary inspection also passes official 16 KiB zip alignment and structural PT_LOAD/RELRO checks for all 14 packaged .so files. This is not a 16 KiB device/runtime pass; see [Google's page-size guide](https://developer.android.com/guide/practices/page-sizes) and artifacts/android-native-alignment.json. Boat preparation and authentication state are documented in [BOAT_ANDROID_QA.md](BOAT_ANDROID_QA.md).
