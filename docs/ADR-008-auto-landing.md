# ADR-008: Prepare a measured landing area before a raid

Date: 2026-10-30. The owner wants continuous scene scanning while streaming, so a raid can land without a streamer placement tap. This slice prepares one fixed stage before the raid; existing characters are never relocated automatically to chase the camera.

Pipeline: existing ARCore tracking/planes/depth -> bounded 4 Hz landing candidates -> whole-footprint polygon test -> upper-surface rejection and depth clearance probes -> one second of stable evidence -> plane-attached, camera-facing stage -> queued raid portal and individual arrivals. Rendering and relay encoding continue independently. No LLM is needed to decide whether an observed surface contains a rectangle.

The first automatic footprint is 1.10 m wide by 0.84 m deep, enough for the three initial heroes and portal entrance. Actual motion retains measured support checks; automatic placement does not extrapolate infinite desk/floor geometry. Depth-capable devices wait for useful depth. Devices without depth can use tracked surface geometry with an explicit surface-only label. Depth probes are conservative line-of-sight observations, not a watertight 3D reconstruction or physical safety guarantee. Manual placement remains an explicit fallback.

Existing fixed stages are retained while the scene continues to be checked. Incoming raid arrivals wait if their automatic stage is not currently observed/clear. Existing avatars retain their own current positions. Automatic placement does not re-home an established crowd; independent stages per later raid and a full room navigation map are separate future work. Looking away may pause new arrivals until the stage is observed again.

ARCore reference checked: https://developers.google.com/ar/reference/java/com/google/ar/core/Plane . Plane polygons are convex local X/Z coordinates, must be transformed through centerPose, tracked/subsumed planes must be filtered, and createAnchor takes a world-space pose.

Relay check: Tailscale forwarding existed but MediaMTX was stopped. The existing loopback-only infra/tailnet-relay.yml receiver was restarted. Only synthetic video/audio is used for verification; no live Twitch broadcast or phone camera access is inferred. Relay video works independently of AR; AR is required for scene understanding and world-anchored content. Physical S25 -> PC/OBS camera and audio synchronization remain explicit validation gates.

A read-only independent review caught low-obstacle probing, delayed raid/portal entry and tracking-pause readiness cases; these were corrected and covered by unit tests. Dense probes use the support itself and require depth agreement for floor samples, with a distance-dependent noise margin. Polygon support is bounded to 256 vertices per plane. Terminal anchor loss is deliberately recovered by an explicit stage move rather than automatically teleporting the existing crowd.
