# Android phone capture

The owner confirmed **Android phone** as the target on 2026-10-29. `apps/android` is a Kotlin/Compose client using pinned SceneView 4.62.0, ARCore 1.57.0 and Filament 1.72.1. It is separate from the preserved Unity source in `apps/mobile`.

Current evidence: debug APK compilation, seven JVM tests and Android lint (zero errors, six version/target warnings) pass. Four prepared skeletal GLBs pass Khronos glTF-Validator with zero errors and warnings. **No native runtime/phone/recorded-frame pass is established yet.** An APK is a build result, not evidence of working camera tracking or encoding.

## Build and install

From the repository root in PowerShell:

```powershell
./scripts/setup-android.ps1 -InstallSdk
./scripts/build-android.ps1 -Tasks testDebugUnitTest,assembleDebug,lintDebug
```

The setup downloads verified official Microsoft JDK 21, Gradle 9.8.1 and Google SDK tools into ignored `.tools/`. It changes environment variables only in the current process. Node is required to prepare the same pinned KayKit CC0 models used by the browser. The generated derivatives remove root displacement and unused hand weapons while retaining the skeletal animations; source assets remain unchanged. The Gradle wrapper also pins the distribution SHA256.

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Application ID: `world.raidrift.capture.android`. Minimum Android API 24 with a 64-bit ARM phone (x86_64 is also built for emulation); the device must separately support ARCore for room mode. Ordinary 3D preview works independently of AR availability. Debug signing is local, with no store publication or release-signing claim.

For an attached, developer-authorized phone:

```powershell
./.tools/android-sdk/platform-tools/adb.exe devices
./.tools/android-sdk/platform-tools/adb.exe install -r ./apps/android/app/build/outputs/apk/debug/app-debug.apk
./.tools/android-sdk/platform-tools/adb.exe reverse tcp:3400 tcp:3400
```

No phone was attached during the recorded build checks. USB debugging authorization happens on the handset. The reverse tunnel lets this debug app use `http://127.0.0.1:3400` without publishing the local server. Without USB forwarding, use a trusted HTTPS deployment reachable by the phone. HTTP is allowed only for debug loopback/emulator hosts; production requires HTTPS. Redirects are refused.

## Use the actual world

1. Start the existing server on port 3400. In Creator Studio choose **Pair native AR + share composed video**, which explicitly creates a one-hour scoped camera token. Paste that token into the Android pairing form. Tokens remain in memory, outside saved state, URLs and application logs.
2. Use the local 3D preview first. A disconnected preview is labelled **LOCAL PREVIEW**; a paired simulator is labelled **SIMULATOR** in the actual 3D scene, including recordings. Real account identities come only from the authoritative snapshot. Reported raid counts never create named actors.
3. Choose **Start room AR** and grant camera access. Move slowly to detect a desk/floor, then tap the visible surface. ARCore creates a real anchor. No image-coordinate or stationary-camera substitute is used for native tracking.
4. Move around the anchored characters. Depth is requested only where supported; the status distinguishes support from actual current depth frames. The library's depth composition is enabled, but accuracy and dynamic-hand occlusion need device validation.
5. Up to 12 named models render locally, following server choreography targets through a bounded 0.45 m/s presentation motor. Measured horizontal planes and recent depth provide support and gravity; a detected lower floor permits a desk-to-floor fall. Unknown support freezes existing movement and prevents unsupported new actors from appearing. Wall collision, arbitrary mesh navigation, object recognition and hand grabbing remain incomplete in this native client. These local contacts never grant rewards or overwrite authoritative server coordinates.
6. **Record 20s** explicitly starts a silent local MP4 of the rendered scene. This includes the native camera background in AR plus the virtual characters through SurfaceMirrorer, rather than an ARCore dataset recording. Capture is bounded to 20 seconds/12 MB and stops on backgrounding, tracking loss, pause, disconnect or revoked pairing. The scene's mode label is included; Compose controls are excluded. Viewer names and camera footage are visible, as the UI warns before recording. **Share** opens Android's chooser only on user action; **Discard** deletes the clip. No automatic upload occurs. Actual encoded camera-plus-character frames remain unverified until runtime testing.

The app polls `/v1/native/world` with a scoped Authorization header. Responses are `private, no-store`; invalid/wrong-role/expired/revoked tokens fail closed. A camera token cannot submit viewer actions. Native world/clip controls do not mint Shards. Connection loss hides paired content and stops recording rather than silently presenting stale characters as live.

The existing Unity source contains a separate uncompiled WebRTC producer. This Android client currently exports a local MP4; it does **not yet send a live phone stream to `/receiver`/OBS**, mix audio, or provide internet TURN. Those remain implementation and device gates.

## Phone acceptance still required

Install/launch; denied and granted camera permission; ARCore missing/unsupported state; independent named actor actions; desk/floor anchor parallax and drift; loss/reacquisition and reset; plane/depth support loss; real occlusion; recording/decode/visual inspection; share/discard; pairing expiry/revocation; pause/background/camera shutdown; memory, frame cadence, battery and thermal behavior. Software/emulator rendering cannot establish physical measurement quality.

This PC reports firmware virtualization disabled and no hypervisor. Google's emulator documents software emulation as unsupported and very slow. Emulator experimentation is a separate gate, not a physical-phone pass. See [official emulator acceleration guidance](https://developer.android.com/studio/run/emulator-acceleration) and [ARCore emulator setup](https://developers.google.com/ar/develop/java/emulator).

Research decisions and license boundaries: `ADR-004-native-android.md`, `LUCAS_MR_REFERENCE.md`, `ASSETS.md`. No Grok stack assertion or Nintendo asset/code is used.
