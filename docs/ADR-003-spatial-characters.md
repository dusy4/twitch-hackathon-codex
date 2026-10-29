# ADR 003 — rigged characters, runtime anchoring and sensed-room contact

Date: 2026-10-29. Status: implemented and software/emulator tested; device acceptance open.

## Context and decision

The owner rejected the orthographic screen-space presentation and supplied Lucas Martinic's room-anchored Mario demonstration. Keep the authoritative service and replace named render actors with redistributable CC0 KayKit skeletons. Use Three.js perspective for desktop and genuine WebXR reference-space poses, hit-tests and session anchors on capable devices. See `RESEARCH_3D_2026-10-29.md` and `LUCAS_MR_REFERENCE.md` for multi-source research, alternatives and licensing.

Room contact uses Rapier 0.21.0's capsule character controller, not a new collision engine. Optional WebXR `mesh-detection` is preferred; `plane-detection` is a coarse fallback. The same sensed geometry supplies local physics and a depth-only render pass before character pixels. Pose is read every frame even when `lastChangedTime` has not changed: the official mesh specification explicitly distinguishes geometry revision from pose. Unlocalized or disappeared surfaces are removed immediately. No inferred infinite floor replaces lost data; existing physical actors freeze and their grounded status becomes unknown.

References: [mesh detection](https://immersive-web.github.io/real-world-meshing/), [current plane detection](https://immersive-web.github.io/plane-detection/), [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/), [compatibility/WASM packaging](https://rapier.rs/docs/user_guides/javascript/getting_started_js/). Older plane-detection and a guessed Three.js mesh-example URL returned 404 and were not treated as working references.

## Boundaries

- Sensed meshes/polygons, camera poses and local physics stay ephemeral on the device. They are never uploaded, persisted or used to mint rewards.
- Authoritative normalized server positions remain desired choreography targets. Local sensed-room contact can block or lower the displayed character. This is **not** synchronized server physics or trusted physical quest evidence; that remains a separate producer/provenance integration gate.
- Mesh/plane occlusion is approximate static geometry, not per-pixel depth or dynamic hand/person occlusion. Capabilities are reported from actual localized data. No camera-passthrough recording claim is made for a WebXR canvas alone.
- Geometry is bounded to 64 entities / 120,000 triangles, checked for finite vertices/indices/poses, and disposed on end/reset. Geometry copies/rebuilds occur on revision; pose updates occur independently. Missing optional WASM/contact initialization preserves an explicitly limited anchored view.
- Rapier's roughly 4.34 MB JS/WASM compatibility chunk (~1.65 MB gzip) loads only after starting AR, not on the website's normal path. It still needs download/thermal/frame-time measurement on hardware. Apache-2.0 license is shipped in `public/notices/rapier-LICENSE.txt`.
- Local app startup snapshots built assets so subsequent development builds cannot leave its SSR document referring to deleted JS hashes. Snapshot cleanup verifies the managed absolute temp path and workspace-specific prefix before removal; production startup serves its immutable build directly.

## Evidence

Node tests exercise real Rapier desk support, walking off an edge to a floor 0.75 m below, wall blocking, lost-geometry freeze and invalid input. A plane-only bridge test checks triangulation, anchor-space transforms, pose-only updates and disappearance cleanup. A synthetic actual WebGL readback test sees red character pixels become background pixels behind a depth mask, then return when the mesh moves or is removed. `artifacts/spatial-depth-pixels.json` records pixel values. Official IWER/SEM tests additionally exercise two authenticated characters, sensed room meshes, grounded actors, anchor/camera motion, server command and session closure.

Latest backend suite: 59 passed, one conditional PostgreSQL skip. Focused spatial browser tests: three passed. Physical device tracking drift, noisy mesh penetration, moving/dynamic geometry, foot IK, hardware GPU cost, native builds, audio and real stream capture remain unvalidated. No screenshot or emulator result is a physical AR acceptance pass.
