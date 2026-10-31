# RaidRift MR — Unity phone client

Replacement for the native Kotlin AR client (`apps/android`). Decision 2026-10-31 after the 0.12.x
phone recording: the hand-built room understanding failed at landing, following, exploring and
furniture. This client uses the Project Phanto pattern on an Android phone, built from established
SDKs instead of our own:

| Layer | Provider |
|---|---|
| Room geometry | **Niantic Spatial SDK 4.1** meshing (non-LiDAR phones) through AR Foundation 6.4.2 `ARMeshManager`, loader `NsdkARCoreLoader` |
| Walkable area | **Unity NavMesh** baked live from the room mesh + ARCore planes every 0.8 s (`RoomNavigation.cs`) |
| Characters | **NavMeshAgent** per viewer + KayKit (CC0) legacy clips via glTFast (`Hero.cs`) |
| Occlusion | room mesh drawn depth-only after the camera image (`DepthOnly.shader`) |
| Video out | **Unity WebRTC 3.0** to the PC receiver over `/v1/media` signalling (`StreamOutput.cs`) |
| Sounds | original ElevenLabs cues from the native app (`Resources/Audio`, provenance JSON) |

Backend contract unchanged (`apps/api/server.ts`): `GET /v1/native/world` (~150 ms poll), `POST
/v1/native/chat`, `POST /v1/native/debug/event`, `GET /v1/debug/pair`, WS `/v1/media`. Offline test
raid and EN/UA phrase rules are ports of `Playground.kt` / `TextIntent.kt`.

## On the phone
1. **Scanning** — measured room glows (purple tops, pink sides); walkable floor is mint.
2. **Landing** — auto on ~1 m of open floor ahead (stable 1 s), or tap the floor.
3. **Test raid** — small voxel portal with sound; heroes step out and follow chat commands.
4. **Follow me** — party walks with you on NavMesh paths (around the bed, through doors).
5. **Trail** — 3 crystals on reachable floor → shrine → two viewers cheer.
6. Tap floor after landing = party goes there. **Scan off** = mesh becomes an invisible occluder.
7. **Setup** — server URL, optional Creator Studio token, Pair & go live, **Stream to PC**, sound.

## Build (this PC)
- Working copy: `E:\RaidRift-MR` (the repo path is too long for Windows' 260-char limit and C: is
  nearly full). `apps/unity-ar` in the repo is a synced copy of the source.
- Unity 6000.3.27f1 at `E:\Unity\Editors\6000.3.27f1` with Android SDK/NDK r27c/CMake 3.22.1/OpenJDK 17
  under `Editor\Data\PlaybackEngines\AndroidPlayer` (installed by `Tools/android-modules.py` from
  the module URLs Unity's release API lists).
- `powershell -File E:\RaidRift-MR\build.ps1 -Publish` with `GRADLE_USER_HOME=E:\Unity\gradle-home`,
  `TEMP=E:\Unity\tmp`, portable git on PATH (Niantic package is a git URL).
- This PC's network corrupts large TLS downloads ("bad record MAC", "Tag mismatch"). Unity registry
  packages are therefore fetched in verified chunks into `LocalPackages/` (`Tools/fetchpkg.py`, SHA-1
  checked against packages.unity.com) and referenced as `file:` tarballs. Gradle retries are set in
  `E:\Unity\gradle-home\gradle.properties`; re-run the build if a Maven download still fails.
- `Assets/Plugins/Android/gradleTemplate.properties` sets `android.uniquePackageNames=false`
  (ARCore's `arcore_client` and `unityandroidpermissions` share namespace `com.google.ar.core`).
- Classic Activity entry (GameActivity not needed); IL2CPP ARM64, GLES3, minSdk 25.

## Status (2026-10-31)
- 0.13.1 built with NSDK meshing + WebRTC + sounds: `RaidRift-MR-0.13.1.apk` on the Tailscale share.
- Compiled and packaged; **not yet run on a device**.
- NSDK auth: the meshing subsystem has no auth calls (auth is for cloud features); if the phone
  shows "planes only · no room mesh", sign in under Project Settings → XR Plug-in Management →
  Niantic Spatial and rebuild.
- Not ported: object-detection tracks (NSDK object detection is the candidate), RTMP relay.
