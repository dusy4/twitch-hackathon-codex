# ADR-007: Natural chat and continuous native character motion

Date: 2026-10-30. Owner priority: the streamer starts a raid and watches; each viewer directs their own avatar using ordinary language. Object detection is not required for basic movement.

## Implementation

Keep the already licensed KayKit Adventurers rigged GLBs: all four have 41 joints and 76 named clips in the pinned files, including forward/backward walks, running/strafe, and full/start/land jump clips. The author advertises 75 animations (the manifest additionally includes the T-pose). Mixamo is Adobe's animation service and remains a viable later art/retargeting source; a different skeleton would not fix the current rendering faults.

The camera-off preview previously assigned snapshot coordinates straight to a model and therefore teleported. It now uses the same measured-speed SurfaceMotor as AR, with continuous rendering, portal entry, intermediate positions, and a correctly level stage. At the 30 cm character scale, default walk/run speeds are 0.22/0.44 metres per second. Yaw turns on the shortest arc with a 540 degrees/second cap, retaining heading when stationary. Explicit walking mode uses bounded catch-up speed rather than deleting and recreating distant actors. Fixed stages remain anchored.

HeroAnimator owns one animation clock per model instance, applies short cross-fades, adjusts stride speed without restarting the clip on every snapshot, and samples the jump once. A render-time 13 cm jump envelope adds takeoff, flight, landing and an appropriate contact shadow. It does not claim collision-tested vaulting over real objects. Repeating jump in midair cannot snap the actor back to ground. The surface motor continues to reject unknown support and excessive steps. Optional weapons have their mesh references removed as well as detached socket children, preventing unused weapons from rendering at the feet.

TextIntent (Android local fixture) and chatIntent (backend) recognize complete bounded English/Ukrainian instructions without a bang prefix, preserve explicit legacy commands, and support up to four clauses. Examples: `walk right then jump`, `come closer`, `turn around then dance`, `йди ліворуч`, `стрибни`. Relative directions use the placed stage axes; `come closer` means its camera-facing side at placement, rather than continuous camera following. This is an offline intent grammar, not unrestricted LLM comprehension. Unknown conversation stays chat. Object-specific legacy commands retain measured-target refusal behavior.

Per-viewer local queues are interruptible and tracking/background gaps pause their time. Incoming scheduled stub messages use that same handler; no direct animation/transform choreography is scheduled. The scenario demonstrates natural movement, turns, jumps and emotes with the same three fixed viewers. Server EventSub accepts recognized plain text only for already participating avatars, plus an explicit join intent. Plain WASD letters remain conversation. No ordinary-chat implicit account, join reward or raid-slot creation. Existing authorization, cooldown, moderation and authoritative economy gates remain intact. Existing optional server AI planning is not enabled or called by this change.

## Assets and research

- Official pinned asset source and CC0 terms: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- Mixamo free access and royalty-free use in games: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- SceneView v4.62.0 SceneScope/ModelNode source was inspected: animationSpeed is captured when the animationName effect starts; custom frame work requires Continuous rendering in preview. Filament Animator applyAnimation loops time internally; the jump controller therefore clamps phase explicitly.
- No new downloaded models, paid assets, dependencies, provider keys or model inference. Source GLBs remain unchanged. Native asset receipts record derivative hashes and hidden accessory counts.

## Validation and limits

Actual counts, APK hash and final emulator evidence are in `artifacts/natural-motion/verification.json`. Original and generated GLBs have zero validator errors and six NODE_SKINNED_MESH_NON_ROOT warnings per model; these warnings are inherited from the source skeleton hierarchy. They are not a new successful rig-quality benchmark.

Physical S25 AR walk/jump/facing and thermal/frame rate checks remain open. Boat software-rendered native UI/video can show movement and skeleton playback; it cannot establish phone performance, real-world drift, occlusion or collision geometry. The real Twitch account rehearsal and OBS camera output remain open. Existing workstation services are preserved; changed server source is independently tested in isolated fixtures. The local APK test does not require pairing. Browser renderer turn parity is not claimed by this native-focused slice.
