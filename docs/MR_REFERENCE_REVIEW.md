# Phone MR reference review and measured routes — 0.11.0

Reviewed 2026-10-31. The owner supplied `VR. One by raidrift others references.zip` in Documents. The three MP4s were extracted to ignored local storage; contact sheets at four-second intervals plus a one-second sequence of the first 12 seconds of the phone clip were inspected. This is sampled visual review, not instrumented tracking measurements or an audio assessment. No private recording was uploaded for external review or bundled in the app.

## What the actual recordings show

- Owner `Screen_Recording_20261030_234118.mp4`, 68.09 seconds, 1080x2340: three characters in walking/follow mode; extensive detection rectangles and opaque HUD; characters cluster near furniture; crystal 1 is discovered and collected; the card remains at 1/3 through the doorway/return; a replay waits for arrivals near the end. It demonstrates an actual physical AR session and one successful physical pickup. It does not establish the cause of every visible motion or an anchor-drift number.
- `h2K1VTTChdJu6LJG-1.mp4`, 80.58 seconds, 1920 square: a spatial window containing a virtual game world; an animated Mario character also appears on the real tabletop and on a tracked virtual hand. Much of the level geometry shown is virtual game geometry. This is not evidence that a phone automatically reconstructed all the furniture.
- `dUYOV99vCU-KOb9l.mp4`, 37.50 seconds, 1920 square: a floating Mario head and virtual hands, including dragging/deforming facial features. This shows expressive hand interaction rather than autonomous room navigation.

The portfolio describes Quest 3 MR experiments. The previously reviewed original Mario author post mentions PICO CLI. Neither the pixels nor that portfolio establishes the exact hardware/runtime of both supplied MP4s. We do not repeat the earlier ChatGPT claim that both are definitely the same Quest implementation.

## SDK decision

[Meta Project Phanto](https://developers.meta.com/horizon/documentation/unity/unity-sample-phanto/) is a useful architectural reference: scanned scene geometry, runtime floor/furniture navigation and links, collision and occlusion. Its documented hardware requirements are Quest 2/3/3S and its scene loading uses Meta Scene API/MRUK. Installing that Unity sample on an S25 does not supply those Quest sensing APIs.

[MRUK samples](https://github.com/oculus-samples/Unity-MRUtilityKitSample) have reusable examples; its root MIT license does not remove platform/dependency terms. No Meta/Phanto code or assets were imported. [ARCore Depth](https://developers.google.com/ar/develop/java/depth/developer-guide) supplies phone depth without requiring a ToF sensor, but plane/depth observations are not a complete semantic room mesh.

The current app is Kotlin + SceneView/Filament + ARCore, not Unity. The existing licensed CC0 KayKit rigged assets are already reusable 3D game assets. Changing engine does not create missing room geometry. Keep this phone runtime for this slice. A future Unity navigation/physics adapter remains possible once the same sensing/behavior tests can pass; no migration is asserted complete.

AR and MR are overlapping product terms here. Phone characters interacting with measured surroundings are feasible; headset hand tracking, stereo view and stored room scans do not automatically transfer to a phone camera. No verified end-to-end MR-plus-Twitch library was established by this research.

## Implemented slice

- Clean camera defaults: object rectangles off; target selection can reveal them. AR Focus controls leave Explore/Chat/Capture accessible, with the full controls and camera-off action one tap away. Smaller trail/chat panels; STUB/TEST labels retained. Compose HUD is still excluded from native output.
- Finite upward-plane support in every AR movement mode; removed the manual/follow infinite-floor fallback. Preview retains its explicitly simulated floor. Manual anchor placement can still seed an anchor on an extended measured-height ray, but cannot turn that into unbounded walking support.
- Local 16 cm A* detours: body footprint and swept wall/support/overhead checks, smoothing, 256 expanded nodes maximum, two searches per 500 ms globally, fair queued requests and cached routes rechecked against current geometry. Unknown/disconnected ground waits; a reachable frontier may be approached without claiming the destination is reachable. No automatic recall or teleport.
- Short-lived depth obstacle cells, about 12 cm, using at most about 1,200 depth samples at 4 Hz. Two of three observations confirm low clutter (8–34 cm above the measured main floor), two observed-floor votes can clear it; evidence expires in 3 seconds. Depth only blocks, never creates support. Missing depth does not imply free space. Map capped at 2,048 cells; clears after tracking gaps/ground-layer changes. This is not dense reconstruction, moving-object tracking or a guarantee of obstacle coverage.
- Follow goals stay at the character's support layer, rather than just below the phone. Heading holds through small wrist yaw and looking down. Facing follows actual motor displacement around bends. Stop/jump cancels cached travel. Phone SFX pan uses display-oriented camera right.
- Crystal search checks more view locations, reuses an observed world-fixed candidate while valid, reports missing floor/depth, small patch and blocking furniture separately. One unknown corner is tolerated only with three clear corners plus clear center/body; any blocking sample rejects the patch. Travel hints say how much new exploration remains. No automatic completion, invented pickup, reduced spatial separation or rewards were added.

## Limits and next spatial work

This is a bounded local route planner over current plane polygons and a transient obstacle layer. It does not provide a persistent multiroom navmesh, stairs, semantic seats, obstacle-complete geometry, full per-pixel occlusion or hand interaction. Thin chair legs, glass, reflections and unseen clutter may be missed. A new obstacle under an actor can make it wait rather than escape; disappearance of supporting geometry can also make it wait. No fade/teleport recovery was added because that would conceal the missing evidence. Crowd separation and object-relative movement remain open.

Experimental full ARCore depth occlusion remains off by default because the previous floor-depth noise hid small characters. This slice does not claim the references' contact/occlusion quality. It also does not prove the entire physical trail now completes; the new S25 recording must establish that.

Validation receipts, final APK identity and review resolutions are in `artifacts/measured-routes/verification.json`. Emulator UI/preview evidence and JVM geometry fixtures must remain distinguished from physical S25 room sensing. No backend protocol, viewer ownership, currency, real Twitch credentials or public deployment was changed. IRL Pro integration remains deferred.

## Try the 0.11 phone update

Scan open ground and the floor around furniture slowly before starting the test raid. In Explore, enable Party walks with me if desired. The party should visibly walk around measured obstacles; a waiting hint means the route or support is unknown, not that the characters have been recalled. Controls opens the full toolbar; Focus returns to the smaller camera UI. Discovery hints now distinguish missing floor, depth, blocked patches and remaining travel.

Repeat the owner's doorway walk and record it. The important physical checks are continuous walking without sudden floor changes, useful stopping at unknown ground, no new bunching on an open route, and crystals 2/3/shrine appearing only on measured fresh ground. If the room scan cannot support these, the next fix is improved geometry/recovery, not calling the emulator a passing room test.

## Phone-specific reuse candidates checked after the Meta comparison

[Niantic Spatial SDK's current Unity setup](https://www.nianticspatial.com/docs/nsdk/setup/?platform=unity) documents Android support and meshing/depth/occlusion/semantics through AR Foundation. This is a real phone SDK candidate for a future mesh adapter or Unity evaluation, unlike using Quest Scene API on an S25. Setup requires its account/authorization and supported Unity version. No NSDK runtime, account, dependency terms or S25 performance has been integrated/validated here. The older meshing guide's search-index passage says meshing supports non-LiDAR Android/iOS; the current setup page is the basis for current package scope, not an asserted local test.

[Google ARCore Depth Lab](https://github.com/googlesamples/arcore-depth-lab) contains avatar locomotion, depth mesh collisions and point-cloud examples. Its [current README](https://raw.githubusercontent.com/googlesamples/arcore-depth-lab/master/README.md) explicitly says the app/repository are no longer actively maintained and lists much older Unity/AR Foundation baselines. The root Apache-2.0 license was inspected; no source/assets were copied into this build. It is a useful algorithm/example reference, not a verified current turnkey production integration. Google's newer XR Blocks pointer also does not by itself establish an ordinary S25 capture pipeline.

Therefore, "there is no drop-in Meta-to-phone solution" must not become "phone meshing SDKs do not exist." They do. The decision for this update is to finish and test the bounded native repair, with a separate concrete evaluation required before replacing its already-working camera, relay, viewer and character pipeline.
