# ADR-010: Measured local phone navigation before engine migration

2026-10-31. Owner supplied 0.10.0 physical test and two MR interaction references. Sampled frames show usable AR placement but cluttered HUD, bunching near furniture and stalled further discovery. Quest-only MRUK/Phanto room sensing is not an S25 library.

Keep Kotlin/SceneView/ARCore and licensed characters. Replace extrapolated AR walking floors with finite support, bounded fair local A*, and short-lived depth obstacles which never create support. Separate simulation practice from physical evidence. Improve candidate stability and actionable discovery hints before adding semantic models or moving engine.

Tradeoff: conservative unknown-space stopping can expose more pauses than the previous extrapolated floor. Do not solve those by secretly teleporting actors or inventing ground. Local depth is incomplete and cannot promise the reference's occlusion, furniture interaction or room-wide navigation. Retain device tests as release gates.

See MR_REFERENCE_REVIEW.md for exact behavior, official sources, remaining boundaries and verification location.

Current navigation callback bounds also include one search per callback, a cooperative 2 ms A* deadline, bounding-box rejection, next-30-cm cached-leg checks and continued valid old legs while follow goals queue. Missing requesters expire after two callback generations, independent of render FPS. Invalid-start escape and furniture climb links remain unfinished, as the review resolutions explain.
