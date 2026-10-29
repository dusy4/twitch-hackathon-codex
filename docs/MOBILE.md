# Native AR capture: source implementation and device gates

## Browser AR path added 2026-10-29

`/ar?room=<world>` now uses genuine WebXR `immersive-ar`, runtime camera pose, horizontal surface hit-testing and session anchors with the same licensed rigged characters and authoritative world snapshots. World/controller stages link to Room AR. This is separate from the Unity project below.

The page requires trusted HTTPS and compatible hardware/browser; ordinary desktop browsers show an explicit unsupported state without opening a camera. The user starts the session, finds a desk/floor and selects to place the community. If anchors are unavailable, it explicitly reports placement in tracked local reference space. Tracking-origin reset requires placement again; lost pose hides content; ending or navigating away releases the session and assets. No room geometry, frames or anchor coordinates are persisted or sent to the server.

Official IWER + SEM tests exercise the actual XR API lifecycle, surface hits, anchor creation, rendering, camera movement, authoritative wave command, recentering and session end. These tests are labelled emulator evidence and do not establish real device drift, surface accuracy, depth occlusion or physical collision behavior. Browser depth occlusion/room meshes and passthrough recording are not enabled. Do not use `canvas.captureStream()` alone as evidence that the runtime-owned camera background was captured. A physical device is still required for AR acceptance.

See `RESEARCH_3D_2026-10-29.md`, `LUCAS_MR_REFERENCE.md` and `artifacts/webxr-emulator.json`.

## Native implementation

**Status: uncompiled, untested native source. No APK/IPA or working-device claim.** This workstation has no Unity Editor, Android SDK, AR handset, Apple signing identity or configured Unity license. Do not equate the browser overlay or browser WebRTC transport test with native AR completion.

`apps/mobile` targets Unity 6 with AR Foundation/ARCore/ARKit 6.1.1 and Unity WebRTC 3.0.0. The project includes:

- Explicit runtime camera consent, AR availability/install checks and a truthful unsupported-device message.
- Plane raycast placement with asynchronous AR anchor creation; virtual world coordinates are placed relative to the local anchor, not guessed from image coordinates.
- Depth occlusion requested where supported and capability text when unavailable.
- Read-only authenticated polling of authoritative server avatars; pausing, token expiration and camera/background lifecycle handling.
- Original procedural portal/avatar geometry.
- Composite framebuffer capture into a RenderTexture, Unity WebRTC video track and authenticated signaling to the browser `/receiver` page. This is a source-level implementation requiring device verification. It uses direct LAN ICE; TURN and microphone/SFX transmission are incomplete.
- Editor menu to create and save the AR scene and a development Android build entry point.

## Reproduce native validation

1. Install a properly licensed Unity 6 editor with Android build support from [Unity’s official download page](https://unity.com/download). The recorded editor version is a target pin and has not been verified installed. Confirm package/editor compatibility before resolving packages. Accept provider licenses as the account owner.
2. Open `apps/mobile`; resolve the pinned package manifest. Enable XR Plug-in Management → ARCore for Android, ARKit for iOS. Verify required graphics APIs, camera permissions, background rendering and managed stripping for Unity WebRTC on the selected device. No MCP bridge is required for the repository workflow.
3. Run **RaidRift → Create AR capture scene**. Inspect the generated scene and all AR components; build to supported hardware. The batch entry point is `RaidRift.Editor.BuildProject.Android`.
4. On an owned HTTPS/LAN-accessible app instance, connect a creator. Generate a one-hour mobile pairing in Creator Studio. Paste the server URL and capture token into the app. These tokens cannot submit viewer actions or mint Shards. Use TLS for real capture; loopback on a phone points at the phone, not the workstation.
5. Explicitly enable camera processing in the native consent panel. Move slowly until tracking is ready; tap the lower two thirds of the display to anchor on a detected surface.
6. Pan and rotate around the portal. Confirm anchor stability, scale and tracking-loss behavior. Confirm actual occlusion on depth-capable devices and truthful fallback otherwise. Browser tests cannot establish these properties.
7. Select **Share composed video to OBS**. Open the paired receiver URL as an OBS Browser Source on the same network. Verify that real camera + virtual objects are encoded and received together. Test device codecs, resolution changes, overheating, disconnect/reconnect, app backgrounding and emergency stop. The current source explicitly reports missing native audio.
8. Repeat on ARKit hardware after provisioning/signing. Record device/OS/GPU, frame rate, tracking drift, thermal duration, latency, depth capability and actual OBS recording. Do not publish footage without the creator’s permission.

## Known native implementation gaps

Compilation/API compatibility, XR-loader setup automation, hardware rendering/occlusion, camera image target-to-AR-anchor association, full animation parity, video orientation/thermal adaptation, native microphone/SFX transport, TURN/internet relay, reconnection UX and iOS signing remain open. The desktop 2.5D mode remains separately available and never claims world-locked mobile AR.

Official references consulted: [AR Foundation anchor manager](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.1/manual/features/anchors/aranchormanager.html), [ARCore/AR Foundation capabilities](https://developers.google.com/ar/develop/unity-arf/features), [Unity WebRTC video](https://docs.unity3d.com/Packages/com.unity.webrtc@3.0/manual/videostreaming.html), [Unity WebRTC audio](https://docs.unity3d.com/Packages/com.unity.webrtc@3.0/manual/audiostreaming.html), [WebRTC package license](https://github.com/Unity-Technologies/com.unity.webrtc/blob/main/LICENSE.md).
