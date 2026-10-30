# ADR 005 — Android recovery, 2026-10-30

Owner authorizes an end-to-end overhaul for a Twitch hackathon and a validated installable APK. This supersedes earlier instructions to avoid hackathon scope decisions. Preserve the existing authoritative Twitch/world/economy service; improve the native Android experience instead of migrating engines.

Evidence: owner's `Screen_Recording_20261030_123741.mp4` (27.7 s), inspected privately. The HUD obscures roughly half the camera, follow mode continually changes destinations with camera heading, detections are unprojected against a later frame, and bbox-derived heights masquerade as measured support. No footage is bundled or published.

Implementation order:
1. Fixed, measured AR stage by default; explicit placement and reposition mode. No instant-placement guessed distance. Keep walking-stream follow mode opt-in. Camera rendering remains independent of asynchronous inference.
2. Bind every local detection to an owned capture-time pose/depth/coordinate snapshot. Use unsmoothed observations for 3D, reproject known objects for association, reject stale generations/results and freeze geometry during tracking loss.
3. Improve detector input quality and sensitivity with temporal confirmation. Benchmark the bundled model on the owner's room and licensed fixtures; select a quantized higher-accuracy model only with measured evidence. Expose real detection state, never a silent empty result.
4. Tap-selected measured surfaces and objects, explicit target/actor selection and independent actions. A fully usable offline playground is clearly labelled LOCAL; it never impersonates Twitch events, persistence, or Shards awards. Live room uses server authority.
5. Camera-first compact UI, an actionable scan/placement guide, target-aware commands, one clear camera toggle, recording/broadcast in a sheet. Preserve private relay and reviewed local clip workflows.
6. Regression tests for camera motion, late results, identity, target loss and resource lifetime; Android build/lint; backend regression and end-to-end simulator/recorded media checks. Only after implementation use authorized Redmi/Boat for runtime checks. Describe device tracking limitations accurately.

EdgeTAM/YOLOE/Liquid remain optional candidates, not dependencies for the recovery. Android export feasibility and actual simultaneous rendering performance must precede adopting them. No paid inference, training, public publishing or credential disclosure is required.

Deliver an APK with SHA256, source changes, exact validation evidence and reproducible launch instructions. Build success alone is not evidence of physical AR stability.
