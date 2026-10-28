# Implemented choreography behavior

The deterministic parser accepts movement, the shared animation catalog, temporary dragon/mount/confetti/castle assets and commands grounded in a currently visible supported object. It also accepts explicit `then`, `and then` or semicolon sequences, for example:

```text
wave then jump then bow
left then left then right
climb the table then dance on it
climb the table then wave then backflip
```

Compilation resolves the entire sequence before execution. Unsupported clauses do not partially execute. Relative movement accumulates from the preceding planned position; crop/mirror/rotation/viewport mapping is used when estimating position after a grounded action. `it` / `that object` require a preceding visible target. Following emotes retain the current target attachment unless an explicit move/stop/detach changes it. Redundant navigation/default poses are removed where clauses continue on the same observed object.

Every resulting plan still has at most eight steps, fifteen seconds and two temporary asset/effect spawns. A long sequence is rejected with a shortening explanation. This is a catalog-based parser, not unrestricted language understanding. Ambiguous/offscreen targets and unsupported multiplayer directions fail explicitly; consented activities use invitation controls. Advanced language compilation is an optional paid-gated Responses adapter.

## Timing and cancellation

The server validates an AI result against the input observation set at request time, then validates targets against current authoritative tracks before acceptance. It never invents fresh observation timestamps. Scene epochs prevent reusing IDs after a source change. Planning/creator-stop fences, current avatar presence and the latest accepted input time prevent delayed plans from overriding a newer command, returning after a creator stop, or controlling a transferred/deleted avatar.

Animation time starts **after** planning and database acceptance. Model latency does not consume the animation's duration. Movement retains walk/run/sprint pose names; jump-to-surface uses the jump pose. Timeline step events identify the actor, step count and pose, so the controller shows its own progress. The controller restores recent server action history on entry. Schemas remain declarative; unimplemented operations such as group control or face-target are rejected rather than silently treated as implemented behavior.

## Evidence and limits

`tests/choreography.test.ts` checks local sequencing, relative movement, target pronouns, invalid/over-budget input and emote normalization. Gated **mock** model responses check fresh target revalidation after delay, full animation time, creator-stop invalidation and newer-intent precedence without any live/paid call. Product browser tests submit a wave → jump → bow sequence and observe server step events.

Routes, richer object affordances, freeform spatial references, collision-aware planning, chess/formations, persistent structures and live model evaluation are still incomplete. Surface attachment remains estimated image-space placement. No choreography controls real people, animals or devices.
