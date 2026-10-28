# AI RUNTIME — from natural language to persistent on-screen behavior

## Architectural choice: constrained world action language
A text prompt is NOT code. Use OpenAI Responses Structured Outputs/function calling to compile natural language into a schema; reject/adjust actions against deterministic policy; execute in our own engine. Never `eval`, shell, inject JS, dynamically execute user-generated code, let chat trigger HTTP requests, or trust prompt text returned by OCR / images.

Pipeline: `Chat/OAuth -> authenticate identity -> queue/rate-limit -> normalize command -> target discovery from synchronized frame/object tracker -> action compiler -> schema validate -> authorization/content policy -> target resolution (per frame + confidence) -> world route planner -> server authoritative timeline -> broadcast action snapshots -> renderer animations+SFX -> success/failure log`.

### Examples
**Input:** `!rift sprint towards a dog and sit on it` (camera currently sees one dog at x=.68 y=.52).

**Typed plan (illustrative action DSL):**
```json
{
  "version": 1,
  "actor": {"kind": "self"},
  "intent": "perform_choreography",
  "target": {"kind": "observed_object", "class": "dog", "qualifiers": [], "resolution": "best_visible_match"},
  "steps": [
    {"op":"navigate","speed":"sprint","destination":"target_front","timeout_ms":5000},
    {"op":"jump_to_surface","surface":"target_upper_silhouette","height":"stylized","timeout_ms":1500},
    {"op":"play_animation","name":"sit","duration_ms":3000},
    {"op":"attach_to_track","anchor":"top_center","max_duration_ms":7000},
    {"op":"emote","name":"satisfied","duration_ms":1000}
  ],
  "fallback": {"op":"emote","name":"searching","message":"Can't see a dog right now!"},
  "estimated_cost_units": 3
}
```
**Input:** `!rift climb onto the table and start dancing` -> `resolve table -> navigate near edge -> climb animation -> attach actor foot to top plane -> dance loop -> leap down`.
**Input:** `!rift follow the red-hat person` -> `detector/vision identifies person in red hat on a specific frame -> assign ephemeral track_id -> nav follow target image/world trajectory -> lost track stop -> reacquire only visually and transiently`; never identity/face re-identification.
**Input:** `!rift summon a tiny dragon and ride it` -> `spawn_catalog_asset(dragon_small) -> mount_actor -> flight animation -> pop purple sparks -> despawn`.

### DSL schema contracts
See `examples/action-plan.json` for sample and build runtime validators from a single shared Zod/JSON schema. Allowed primitive `op`s: `navigate`, `jump`, `climb`, `jump_to_surface`, `follow_track`, `attach_to_track`, `detach`, `face_target`, `play_animation`, `emote`, `spawn_effect`, `spawn_catalog_asset`, `ride`, `build_voxel`, `interact_virtual_object`, `group_invite`, `say_bubble`, `wait`, `stop`. Limits: <= 8 steps and <= 15s action by default, <= 2 spawned temporary objects per player, bounded velocity & motion, predictable despawn, creator override. Maintain action sequences and allow interrupts. Token budget and cooldown configurable by creator.

### Video perception and spatial state
1. Source capture input must correspond to the broadcaster's actual selected source, not random post-OBS frames. Explicit user permission and clear data flow.
2. Use a detector for common objects and poses, e.g., MediaPipe / suitable properly licensed ONNX model; use OpenAI vision or other grounded referring-expression detector for `red hat`/`chair nearest doorway` disambiguation; persist short-lived object track IDs, confidence, bbox, silhouette mask and optional pose/estimated depth.
3. Tracking at video cadence must be local and incremental; do NOT send every frame to an LLM. A tracking system (optical flow/ByteTrack or licensed equivalent) bridges slower detector observations. SAM 2 can supply masks/occlusion on supported compute, with permissive Apache 2.0 license for released model/code; confirm redistribution of weights.
4. Normalize to source pixel coordinates, record frame timestamp and source transform matrix, apply crop/letterbox, scale/rotate/mirror correctly to align with OBS overlay. Failure to align coordinates makes characters miss targets.
5. Treat scene as a **temporal world graph**: nodes: `{id, class, attributes, bbox, segmentation, depth?, confidence, last_seen_at, ttl}`; relations: `on, beside, behind, in_front_of, near`, grounded by geometry and uncertainty; links to virtual actors, not real identity.
6. Route and animate: in stage mode infer ground line and platform regions and use stylized 2.5D paths; if the target moves, maintain a continuously evaluated anchor; if target is occluded/lost stop gracefully. AR mode uses ARFoundation anchors and depth/plane hit tests where supported.
7. World frames for multiplayer: authoritative `worldX` for stage; `cameraX` for source; `screenX` for UI; AR world coordinates for mobile. Maintain versioned transforms and timestamped observations; don't mix uncalibrated normalized xy with meters. When mapping apparent target top to a dog's silhouette for comic `sit`, do not imply a real physics simulation of dog contact.
8. Dynamic camera and real-world consistency: no false 'works anywhere' claims from screen-only overlays. On-device AR mode should own the camera rendering/composite, then broadcast the finished frame; server receives metadata (and opted-in sampled frames) for action target semantics, not source of truth for high frequency pose.

### LLM prompt compiler instruction (engine implementation should own policy)
"You are the choreographer for a multiplayer cartoon-avatar overlay. Convert the user's instruction into *only* permitted typed virtual-game actions. Never direct real people or animals, devices or off-screen things. Identify referenced scene entities only from grounded track IDs and observed attributes; do not invent targets. Separate planning from execution; be visually delightful but bounded by capabilities, CPU/GPU budget and creator settings. If no target matches, provide an achievable fallback and clear message. Return strict schema; no source code." Implement a strict model schema and server validator; use deterministic shortcuts for frequent commands. Include adversarial chat/OCR prompt-injection tests.

### Efficient model routing
- Deterministic parser for `!jump`, `!left`, `!join`, emotes and small pattern language.
- LLM compiler only for unknown natural-language prompts; result cached by normalized intent and asset/scene capability version where safe (not cached across different target facts).
- Detector/tracker local at ~5–15 observations/s where hardware supports; render at 30/60 FPS separately. Avoid 100 requests/s from hundreds of chat users; apply per-user cooldown, per-room concurrency budget, action queue and priority.
- OpenAI Responses Structured Outputs: action selection/choreography / quest writing. OpenAI Decisions: bounded yes/no or choice about quest evidence. **Decisions is not a general-purpose action-plan generator.**
- When third-party models fail or quota is exhausted, deterministic emote/movement and predefined camera quests keep stream usable. Display transparent status in dashboard.

### Object interaction / affordance matrix
- dog/cat -> follow, orbit, leap-on-as-visual-joke, sit on silhouette, pet via virtual sparkle, trail footsteps; no physical effect.
- table/chair/bench -> climb, perch, dance, jump, build small toy castle on top if collision and rendering budget permit.
- tree/wall/pole -> hide, scale with animations, portal placement or wall-run as stylization.
- person -> wave, follow *visible screen position*, pose nearby. Don't infer identity, location or persist tracking beyond short scene context.
- bike/car -> inspect, sit nearby, celebrate, ride **virtual vehicle**, not control/impersonate real vehicle.
- unknown -> gesture near, inspect, request viewer target selection or choose virtual environment target.

### Quality evaluation dataset
- still camera: dog walks left/right, partially occluded; table at varied perspective; mirror camera; bright sky/low contrast.
- moving camera: pan, rotate, zoom, switch OBS scene, mobile phone whip-pan, low-light, foreground occlusion.
- ambiguous: 3 dogs, 2 red hats, targets enter/leave scene; dog on a screen vs real dog; prerecorded footage detection and synthetic fake quest inputs.
- social: 100 players doing emotes, 25 users submit concurrent semantic commands, raid event duplicate deliveries, room switch mid-sequence.
- malicious: prompt injection in chat, text on printed sign, XSS in Twitch names, bots spamming expensive inference.
Record visual screenshot/video and alignment error. Set objective animation smoothness, command success rate and wrong-target error budgets, then tune from actual measured data.
