# Boat Android QA

## Latest evidence — 2026-10-29 afternoon

This section supersedes older latency/tracking observations below. Official emulator 35.6.11, API30 Google APIs x86_64, swangle software graphics and one emulator CPU core run on the disposable Boat VM. Native camera-off 3D → SRT → private MediaMTX → custom WHEP receiver → OBS33 measured 1.948 seconds action-to-decoded-frame and 4.579 seconds pause-to-cleared-frame, with actual recordings. The stock relay player previously held stale frames; our decoded-frame watchdog fixes that path. Injected microphone signal is present but later distorted, so microphone fidelity/A/V sync remain unpassed. A direct ARCore diagnostic separately reached six horizontal planes and valid center hits; integrated SceneView still needs successful sensed-surface placement. These are distinct gates. See `artifacts/android-runtime-qa.json` and `AR_OPEN_SOURCE_RESEARCH.md`. Google sample and SceneView performance/default-camera comparisons are in progress.

The owner explicitly requested Boat on 2026-10-29 and specified **their Chrome with Google sign-in** for account access. Do not use an isolated/in-app browser for this login.

## Verified documentation and local preparation

Boat's official [virtualization guide](https://docs.boat.dev/machines/virtualization) says every sandbox exposes `/dev/kvm` and documents an accelerated Android emulator. This can address this workstation's disabled firmware virtualization and crashing unsupported Windows software emulator. It is still an emulator, not evidence of a physical phone's tracking/depth accuracy.

Official sources read: [documentation index](https://docs.boat.dev/llms.txt), [virtualization](https://docs.boat.dev/machines/virtualization), [CLI](https://docs.boat.dev/cli-reference) and the supplied [Windows installer](https://boat.dev/install.ps1). The installer was inspected first. CLI **1.0.85** was downloaded from the installer's official endpoint into ignored `.tools/boat/boat.exe`, without changing the PowerShell profile, system PATH, Defender exclusions or existing Boat processes. Its local SHA256 is `02ebb405804f1bf353f5e3b651d3b3c51d3411858d33641e5b3847435d357fdc`; this is a locally recorded hash, not an independently published signature.

The owner completed Google sign-in in their Chrome on 2026-10-29. Account limits then confirmed an available trial allowance, a zero-dollar next start and no checkout requirement. One personal default VM was created with a one-hour TTL, no account environment, no snapshots, no command monitoring and no public ports. Actual readable/writable `/dev/kvm` and accelerated Android boot were verified. No subscription/payment activation was performed by the agent. Connection URLs/codes/tokens remain in ignored local files.

Boat's [trial documentation](https://docs.boat.dev/free-trial) says a card is required for its trial. The [pricing page](https://docs.boat.dev/pricing) documents the monthly minimum and per-VM compute. Do not activate a new subscription or enter payment details automatically. After login, read actual account limits before using already-authorized VM allowance.

## Prepared execution plan

Use one `default` VM (4 vCPU/8 GB), a one-hour TTL, no account environment/secrets, no provider snapshots or command monitoring, and no publicly hosted ports. The emulator needs roughly 3 GB; do not select `small`. Stop/delete the disposable VM after downloading evidence so it cannot run indefinitely.

```powershell
./.tools/boat/boat.exe --no-update --json limits
./.tools/boat/boat.exe --no-update --json new --type default --ttl 3600 --no-env --no-snapshots --no-monitoring --name RaidRift-Android-QA
./.tools/boat/boat.exe scp artifacts/raidrift-capture-debug.apk <id>:/home/user/raidrift-capture-debug.apk
./.tools/boat/boat.exe scp scripts/boat-android-setup.sh <id>:/home/user/boat-android-setup.sh
./.tools/boat/boat.exe exec <id> --detach -- bash -lc 'RAIDRIFT_APK=/home/user/raidrift-capture-debug.apk bash /home/user/boat-android-setup.sh'
```

The setup script verifies KVM access and official Android command-line archive metadata, installs a Google APIs Android 11/API 30 emulator and checksum-verified Google Play Services for AR 1.57.0, installs the APK, starts the actual Activity and collects an initial screenshot/accessibility XML. It uses `swangle` for Filament and disables the API 30 image's broken virtual Wi-Fi route in favor of its reachable emulated mobile network. This is not physical cellular validation. Inspect actual frames, Activity process and crash logs.

For independent named-character commands, `node --import tsx scripts/boat-android-world.ts` creates a disposable loopback server on port **3403**. It uses an in-memory database, random signing key, two explicitly synthetic actors and no Twitch/OpenAI credentials or paid inference. Pairing is saved in ignored `.data/boat-android-pairing.json`. Its action endpoint was checked locally: only Juniper changes to sit, while Moss remains idle. This fixture does not change the durable app on port 3400.

`boat forward <id> --reverse --local 3403 --remote 3403` makes only that loopback QA API available inside the VM through SSH. Then `adb reverse tcp:3403 tcp:3403` lets the emulator use `http://127.0.0.1:3403`. Do not expose port 3403 publicly or upload `.env`, the durable database, user camera footage or personal browser profiles. The temporary pairing token stays out of command history/public evidence.

Remaining runtime checks: inspect genuinely 3D model appearance; independent authored actions; camera permission and ARCore availability; actual hit/anchor placement and moving emulated-camera parallax; tracking loss/reset; capability reporting; record a real composited MP4, pull/decode/inspect it, review and discard; pause/revocation/background cleanup. Emulator measurements and video do not establish physical drift, true environmental depth, thermal behavior or native phone→OBS transport. LAN WebRTC inside a NAT-based emulator needs its own connectivity validation.

## Initial failures

**Boat execution is underway.** Android 14/API 34 booted, installed the APK and exposed a real Filament shader failure: the plain SwiftShader OpenGL driver reports only 256 vertex uniform vectors. Restarting the same VM emulator with the documented `swangle` backend renders the actual skeletal character and keeps the app alive. The first screenshot also exposed missing Compose content-color inheritance; wrapping the app in a Material Surface fixes that and the updated APK passes 12 JVM tests/build/lint.

ARCore session creation on this image fails because its camera HAL registers the virtual back camera as `10`, while the emulator ARCore profile requests `0`. This is a failed AR check, not a passing camera frame. A separate API 30 Google APIs x86_64 image is being tested. Initial paired-world testing correctly rejected an expired fixture token; a fresh disposable fixture was started. Anchor, recording, paired actors and lifecycle checks remain pending until inspected runtime evidence exists. Local Windows emulator failure remains separate in `artifacts/android-emulator-attempt.json`.

The CLI's generated Windows SSH configuration failed strict host-key lookup. File transfer instead uses the official signed HTTPS upload endpoint, or direct OpenSSH with the host key returned by the authenticated Boat `/sshkey` endpoint pinned in a dedicated known-hosts file. Strict host-key checking stays enabled. The QA API is routed through an SSH reverse forward bound only to VM loopback, then `adb reverse`; no public service is opened.

## Inspected runtime evidence — 2026-10-29

The first one-hour VM expired. A second default VM used the existing zero-dollar trial allowance, a two-hour TTL, no account environment/snapshots/command monitoring and no public ports. API 30 revision 16 exposes the expected camera ID `0`; emulator 37.2.12 with `swangle` renders the actual skeletal GLBs. The latest native build has 19 JVM tests, zero lint errors/six warnings and 154 resolved runtime components with license metadata.

| Check | Observed result |
| --- | --- |
| Two paired actors | Juniper and Moss render as distinct rigged models. A synthetic command changes only Juniper's authoritative position and the actual native scene. |
| Native MP4 | `android-native-preview.mp4`: actual 1280×720 H.264, 19.768 s/70 frames; decoded and visually inspected. Camera-off scene, not AR footage. In-app review/recovery and discard exercised. |
| Native SRT output | RootEncoder 2.8.1 → loopback MediaMTX 1.21.3, H.264 1280×720; a real receiver file is `android-native-srt-received.mkv`. |
| Actual OBS | Isolated official OBS 33.0.0 portable → private SSH-forwarded RTMP Media Source → actual x264 recordings `android-native-srt-obs.mkv` and `android-native-srt-obs-audio.mkv`. Other workstation audio inputs muted. No public channel connected. |
| Audio signal | Emulator gRPC injected an eight-second 1 kHz microphone tone. Decoded OBS PCM has non-silent samples during that interval, with a strong 1 kHz component in its first seconds; see `android-obs-audio-tone.json`. Physical microphone quality, mute, A/V sync and tone fidelity remain unpassed. |
| Real-time interaction | Native scene updates promptly; OBS eventually shows the same move. Measured action-to-decoded-frame bounds were roughly 6–9 s in this slow emulator/receiver setup. This fails the real-time acceptance gate. Receiver buffering/decoding remains under investigation; no physical-phone latency promise is made. |
| AR camera | Camera frames render, but ARCore remains PAUSED/INSUFFICIENT_FEATURES. No plane/anchor/parallax or depth pass. |
| Configuration change | Testing exposed a HUD/scene pairing mismatch after Activity recreation; pairing intent now belongs to the ViewModel's connection state. Follow-up runtime validation is required. |

The private receiver binds SRT, RTMP and its API exclusively to VM loopback, with loopback-only authentication permissions. Android reaches it through its host alias; local OBS reaches it through a pinned-host-key SSH forward. SRT output is plain in this private fixture. TLS/encrypted SRT and commercial provider credentials require their own tests. `scripts/obs-native-qa.mjs` controls only the explicitly configured disposable OBS instance; credentials stay in ignored `.data` files.

Native rendering is only a few frames per second under software GPU emulation. OBS's 30 fps output contains duplicated native frames and is not evidence of native 30 fps performance. Earlier six-second latency probes missed the delayed movement; their null results are retained, not converted into a pass. Later configuration changes also exposed a local-preview fallback, so those measurements cannot validate paired commands. Retest with a stable paired baseline after the fix.
