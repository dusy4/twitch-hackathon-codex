# Selfie camera research and integration notes

Researched 2026-10-31 for Unity 6000.3.27f1, built-in RP, AR Foundation/ARCore 6.4.2,
NSDK 4.1.0-26051913 (`NsdkARCoreLoader`), Android IL2CPP ARM64 / Galaxy S25 Ultra.
Unity was not launched. Hardware behavior below remains a device test requirement.

## Findings

### Runtime camera switching

Set `ARCameraManager.requestedFacingDirection` to `CameraFacingDirection.User` or
`World`. This is a feature request, not synchronous camera selection. The session
configuration chooser determines which compatible configuration actually runs;
`currentFacingDirection` can lag by several frames or fail to match the request.
The default chooser counts matching features, so enabled plane/world/depth/light
features can outweigh a user-camera request. Stop conflicting consumers first.
Use a temporary chooser that selects only descriptors supporting the desired
camera, then restore the original chooser when world tracking returns.

- [Unity camera component](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.4/manual/features/camera/camera-components.html)
- [Unity ARCore face tracking and configuration selection](https://docs.unity3d.com/Packages/com.unity.xr.arcore@6.4/manual/features/face-tracking.html)
- [Unity configuration chooser](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.4/manual/features/session/configuration-chooser.html)
- [Niantic staff on camera feature selection and delayed current direction](https://community.nianticspatial.com/t/ios-toggling-between-forward-and-rear-facing-cameras/5627)

Exact installed sources checked (relative to project root):

- `Library/PackageCache/com.unity.xr.arfoundation@5d6e4088a194/Runtime/ARFoundation/ARCameraManager.cs`: setter forwards `requestedCamera`; current direction is provider state.
- Same package, `Runtime/ARSubsystems/Configuration/DefaultConfigurationChooser.cs`: feature count, then descriptor rank, determines selection.
- Same package, `Runtime/ARSubsystems/SessionSubsystem/XRSessionSubsystem.cs`: public configuration descriptors and chooser.

### Front camera capabilities and face setup

ARCore Augmented Faces supplies a head center pose, region poses and a 468-vertex
face mesh. It requires the front camera. There is no usable room-scale 6DoF SLAM,
plane detection, room meshing, environment depth or world anchor placement in
this configuration. Treat selfie as a face/camera-relative presentation. Although
AR Foundation exposes an orientation-only (3DoF) tracking request, ARCore explicitly
returns an identity display-oriented camera pose and a PAUSED camera tracking
state on the front camera; do not assume a live 3DoF camera pose. Do not depend on
positional camera tracking or `SessionTracking` to render the front-camera fallback.
Automatic depth, environmental HDR and geospatial features conflict with the
front camera. ARCore eye tracking is not supported.

`ARFaceManager` belongs on the existing `XROrigin`, starts disabled and requests
one face. Its prefab may be null: AR Foundation creates `ARFace` objects and
updates their pose/vertex data. `ARFaceMeshVisualizer`, a mesh filter and renderer
are required only if a prefab should display the face mesh. A default visible
face prefab would cover the streamer's face, so this implementation uses the
null prefab and a separate depth-only mesh. No ARCore Extensions package is needed.

Unity's face origin is inside the head behind the nose; local +X points toward
the left ear, +Y up, +Z into the head. Perches use these axes and measured face
width. Shoulder locations are an approximation from the face, not body tracking.

- [Google Augmented Faces for AR Foundation](https://developers.google.com/ar/develop/unity-arf/augmented-faces/developer-guide)
- [Google front camera limitations](https://developers.google.com/ar/reference/c/group/ar-camera-config)
- [Google configuration restrictions](https://developers.google.com/ar/reference/java/com/google/ar/core/Session#configure(com.google.ar.core.Config))

Installed `ARFaceManager.cs`, `ARFace.cs`, ARCore `ARCoreFaceSubsystem.cs` and
`Documentation~/features/face-tracking.md` were checked for these API contracts.

### Niantic loader and subsystem lifecycle

Installed `Runtime/Loader/NsdkARCoreLoader.cs` derives from `ARCoreLoader` and
calls `base.Initialize()` through `InitializePlatform()`. Installed ARCore's
loader creates its camera, session and face subsystems. NSDK's
`Runtime/Loader/NativeLoaderHelper.cs` replaces/adds depth, meshing, segmentation,
scanning, VPS and mapping; it does not replace the ARCore face subsystem.
Therefore the loader exposes the necessary APIs, but this is **source-based
evidence, not a guarantee of front-camera support for all NSDK native features**.

NSDK staff report front-camera incompatibilities with some AR features, and
camera-configuration failures have been reported with older ARDK versions.
Stop NSDK world consumers before switching. `ARMeshManager.OnDisable()` calls
the mesh subsystem's `Stop()` and retains its generated meshes. Loader `Stop()`
itself is a no-op for this purpose; do not unload/reinitialize the loader.

SelfieMode disables the mesh manager/NSDK extension and world consumers, then
stops any remaining running subsystems whose concrete namespace is NSDK.
Only those running subsystems are restarted. This includes depth if meshing
left it running. No reflection-based private API calls or loader swap is used.
If new AR managers are added later, include them in `worldConsumers` too.

- [Niantic staff discussion of front-camera feature conflicts](https://community.nianticspatial.com/t/no-valid-camera-configuration-found/5210)
- [NSDK source repository](https://github.com/nianticspatial/nsdk-library-upm)

### Reset, coordinate continuity and CPU images

ARCore documents that selecting a different physical camera resets internal
session state, and warns about trackables/anchors and paused tracking after
configuration changes. Avoid an additional `ARSession.Reset()`; it destroys
trackables and invalidates world placement. There is no documented promise that
the previous room coordinate system survives a rear/front/rear round trip.
Retaining the Unity scan/NavMesh is possible; proving that they still align with
the physical room requires device testing. Do not infer alignment from a tracking
state alone. If the S25 resets its origin, a fresh room scan or an independently
validated relocalization/alignment strategy is required before shipping this mode.

Outstanding `XRCpuImage` objects can also prevent camera configuration changes.
The installed NSDK loader explicitly documents its PAM image lifetime and
Tracking-to-Initializing release path. The detector's disable path disposes its
work; scene capture is disabled and its generation invalidated before selfie
frames can become room targets. The implementation holds no CPU camera images.

- [ARCore setCameraConfig lifecycle warning](https://developers.google.com/ar/reference/java/com/google/ar/core/Session#setCameraConfig(com.google.ar.core.CameraConfig))
- Local NSDK `NsdkARCoreLoader.cs`, `UpgradeCameraConfigurationIfNeeded`, notes 1-3;
  `Runtime/PlatformAdapterManager/DataSources/SubsystemsDataAcquirer.cs`.

### Background, mirror, permissions and streaming

Keep the existing `ARCameraBackground`, its provider material, display transform
and culling. In installed 6.4.2, the built-in command buffer is rebuilt on camera
frames, including rendering mode, material and invert-culling changes. Caching a
background material or manually mirroring the whole render target would risk
misalignment and reversed text. The provider owns the selfie image reflection.
WorldTags compensates glyph X scale when the selfie projection has negative X
scale; label roots remain positive-scale. Confirm reflection and culling on device.
Google's front-camera specification explicitly documents this horizontal
projection flip. SelfieMode temporarily disables the tracked pose driver and
aligns the same camera to XROrigin's session/trackables space while front frames
arrive, matching ARCore's identity pose. The saved pose and driver are restored
before world logic resumes, without moving the origin or the room geometry.

The same Android CAMERA permission covers both cameras. ARCore's installed
session/camera providers request/check `android.permission.CAMERA`; there is no
separate selfie permission. Permission denial and Android camera privacy controls
still need testing. No permission or player/build setting changes were needed.

The controller never assigns `Camera.targetTexture`, creates another capture
camera, or changes LivePublisher/StreamOutput. Heroes, name tags, depth mask and
halo render into the existing AR camera composite, including its live texture.

## Implementation and integration

- `SelfieMode`: `IsSelfie`, `Toggle`, `Changed`, `TryGetPerch`; also `WorldPaused`,
  `IsSwitching`, `HasFace`, `HeroScale`, `Notice` for the app. Three camera frame
  callbacks confirm a direction. Rear confirmation additionally requires positional
  tracking. A failed front request rolls back; a failed rear request keeps scans
  paused and permits retry. Rapid taps during a switch are ignored.
- `Hero.Selfie`: disables the agent, cancels entrance/link traversal and stale
  destinations, scales the complete hero and keeps existing emote animations.
- `RaidRiftApp.Selfie`: pauses room logic and detector/scene capture, hides world
  scenery, synchronizes live/demo joins and commands, and restores heroes on
  sampled floor near the camera. Room-targeted poses play at the perch. Commands
  continue through the existing server/offline source. Unavailable floor placement
  retries; it never warps to an unsampled zero point.
- The generated scene wires the component and disabled face manager. Small hooks
  in shared files are marked `// SELFIE:`. Hud.cs was left to the other engineer;
  its concurrent version already supplies the `selfie` action.
- No explicit session reset, room reset, NavMesh destruction, changes to streaming,
  build settings or existing self-test logic.

## Verification and device acceptance

Standalone Roslyn checks use Unity's bundled compiler and installed reference
assemblies, without starting Unity or taking its project lock. They check C# and
API signatures, not Unity serialization, shaders, native behavior or IL2CPP linking.
The integrator must regenerate the scene through BuildTools, compile in Unity,
run existing self-tests, and build ARM64 IL2CPP.

Completed checks: standalone runtime compile with Editor symbols, standalone runtime
compile with Android player symbols, and editor compile of BuildTools plus existing
RoomSelfTest, DetectorSelfTest, LiveSelfTest and CameraFeelSelfTest. All passed.
The standalone runtime compiles report only CS1701 for the installed Newtonsoft
netstandard 2.0 reference against Unity's netstandard 2.1 reference set. These checks
do not execute the self-tests. Concurrent HudPreview editing was excluded from the
editor verification; the files listed above were included.

Device acceptance checklist:

1. Establish a scan/NavMesh, start a raid, then switch in both portrait and landscape.
   Confirm actual front frames, tracked face perches, plausible shoulders, correct
   hero scale, halo depth masking, readable names and correct left/right movement.
2. Turn away, cover/leave the camera, reacquire a face and test multiple people.
   No-face heroes should remain in the lower view approximately 0.4 m away.
3. Test join/leave and repeated jump/dance/wave/sit/stop commands, including room
   targets and switching during entrance, link jumps, emotes and a raid charge.
4. Round-trip repeatedly while stationary, then while moving. Check scan alignment,
   floor height, NavMesh paths, floor placement and resumed mesh updates. Watch
   for origin resets, stale NSDK mesh integration and permanently paused tracking.
5. Go live before and during selfie. Confirm phone preview matches encoded output,
   no reversed names, unchanged texture ownership, uninterrupted mic/audio and no
   publisher capture failure. Brief provider camera-switch frame gaps may occur.
6. Test rapid taps, front-switch failure, rear-switch timeout/retry, camera permission
   denial, background/resume and Android camera privacy toggle. Verify no front
   frames become room detections/tracks and world scanning stays off until rear
   positional tracking returns.
