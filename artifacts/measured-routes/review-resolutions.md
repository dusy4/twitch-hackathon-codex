# Independent review resolutions — 0.11.0

The requested independent design and code reviews used read-only tools with high effort. Review findings and their resolutions are recorded below. The code review inspected a changing worktree; findings are evaluated against the final source rather than accepted as a test pass.

- Infinite-floor and high follow-goal defects: removed movement extrapolation; follow uses current support layer. Manual anchor seeding is separate from walking support. No automatic recall is invoked (the earlier design review's reference to recall is not evidence that the app teleports).
- Moving-goal budget and stale queue: continue a currently validated leg toward the new goal while queued, cancel on stop/opposite direction, expire missing requesters after two callback generations, clear navigation with every motor clear. Twelve moving-goal actors, stale requester and stop tests cover these behaviors.
- Render cost: bounding boxes and per-callback standing cache, one search per callback, two per 500 ms maximum, 256 node cap, cooperative 2 ms deadline, skip further smoothing on deadline, revalidate only the next 30 cm of a cached leg. A single geometry callback cannot be preempted by this timer; no S25 p95 result is asserted.
- Obstacle cap: refresh insertion order on reconfirmation. Staleness/tracking/ground-layer clears are intentionally conservative about retaining stale coordinates; an expired obstacle does not prove free space. Finite planes still supply support. Occluded/out-of-view furniture may be missed; this is documented rather than called complete room collision.
- Shared depth: obstacle and quest sampling use the same main 250 ms cadence and a frame-local lazy snapshot. Internal trail timing remains for callers without that shared sampler. Camera-off preview timing remains independent.
- Preferred objective height: snap to the current measured plane and revalidate footprint/depth/view. Exclude recent sites during search so a held but ineligible candidate cannot starve new patches. Tests cover held candidates, changed blocking depth, missing evidence and fresh-site alternatives.
- Focus uses rememberSaveable. Test and local quest labels remain visible; full controls are reachable.
- Invalid starting geometry: intentionally waits rather than skipping swept collision samples or inventing an escape floor. This remains a physical usability limitation until there is a measured, collision-safe recovery path. No unsupported teleport/fade reset was introduced.
- Furniture sitting: no new climb/link/seat solution is claimed. Known occupied target centers can stop a ground route, including legacy selected-target sitting. Bypassing real target collision merely to preserve a visual sit would undermine this slice. The new docs mark this boundary explicitly; furniture interaction remains unfinished.

The owner has not yet tested this build's navigation through the room. Unit fixtures and emulator UI do not close that gate.
