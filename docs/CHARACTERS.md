# Characters entering the world

## Perspective and room AR update — 2026-10-29

Owner rejected the flat appearance and authorized any true 3D model. Named avatars now load pinned CC0 KayKit GLBs with independently cloned 41-joint skeletons and AnimationMixers. Actual files contain 76 clips each. Authored locomotion/sit/combat clips, crossfades, a procedural wave gesture and existing bounded root choreography are used; unsupported special actions are not falsely described as having dedicated authored clips. The shared clip cache keeps immutable animation data separate from each player's mixer/bones. Body tint, earned crown and pet rendering remain independent.

The desktop stage uses a PerspectiveCamera, a ground plane, directional shadows, movement heading and orbit/zoom/reset controls. Ray-plane projection preserves normalized video foot anchors across landscape/portrait outputs, but this is a declared coarse scene model with no measured room pose/depth. OBS output remains transparent. Named models load only when needed; failures are visible and do not silently present the previous primitive rig as the imported asset. Source palette textures required allowing local `blob:` fetches in CSP; actual screenshots caught and verified this correction.

`/ar` provides a separate capability-gated real WebXR camera-pose/hit-test/anchor path. The renderer places roughly 25 cm characters relative to the selected surface; independent server commands still select only the authenticated actor. Optional runtime meshes/planes now drive bounded Rapier capsule contact and a real depth-only occlusion pass. This remains local sensed-room rendering rather than synchronized server physics; per-pixel depth, dynamic hands and physical-device quality remain open. The official emulator exercises placement and camera motion; physical-device validation remains open. Research and reference-video findings are in `RESEARCH_3D_2026-10-29.md` and `LUCAS_MR_REFERENCE.md`.

The earlier arrival/event evidence below remains relevant to identity/server authority. Updated character arrival captures use the imported perspective models; older CLI composites are identified in `ASSETS.md`.

Current priority, per owner steering on 2026-10-29: character arrival, visibility and control in the stream. Secondary feature expansion is deferred.

## See it locally

The running app uses http://127.0.0.1:3400. No camera/model download is needed for the character demo.

1. On the homepage, **Try a portal event** opens the labelled simulator raid and includes Juniper, the authenticated creator simulator character.
2. **Enter the world** claims the viewer simulator character. The controller marks its nameplate **YOU** and provides movement, emotes and summoning.
3. **Step through the portal** replays that character's own entrance. Repeat entry neither creates a duplicate character nor repeats a first-join reward. A paused world blocks entrance motion.
4. For OBS, generate the read-only overlay URL in Creator Studio and add it as a Browser Source above the video. The canvas is transparent. Sound requires explicit arming.

## Current implementation

The server starts a new claimed avatar at the same normalized portal threshold used by every renderer, then advances a 1.5-second walk to its standing position. Small bounded arrival staggering separates successive characters. Commands take precedence over automatic entrance movement; stop/reset cancels it. Saved positions recover without replaying old entrances. Server event time synchronizes visual timing, and the local viewer's nameplate and ground marker remain identifiable.

The anonymous crowd uses bounded instanced voxel bodies, heads and moving limbs. Reported raid viewers do not create accounts or invented named attendees. Persistent named characters come from authenticated browser sessions or numeric chatter identities in verified EventSub messages. The explicit chat command `!join` enters that chatter's character through the portal; `!rift` and `!ourapp` instructions control the corresponding avatar.

## Actual evidence

- `tests/arrivals.test.ts`: authoritative portal path, settlement, no duplicate on rejoin, command/stop precedence, repeat-entry reward guard and restart behavior.
- `tests/e2e/character-arrivals.spec.ts`: real transparent browser overlay, labelled simulator raid, anonymous visual population, independently authenticated viewer, named character, own-character marker, repeated entrance and command.
- `artifacts/character-arrival-qa.webm`: actual recorded original overlay, not a generated mock video. Simulator input; no private footage or source audio.
- `artifacts/chromium-character-arrival-overlay.png` and `chromium-claimed-character.png`: inspected rendered output. Pixel inspection confirms a transparent background.
- `scripts/twitch-cli-smoke.ts`: official Twitch CLI v1.1.24 sends a synthetic signed raid through real local HTTP, the durable inbox and WebSocket overlay. Two separately signed synthetic chat fixtures create two distinct characters, and one chatter's command moves only that character. A duplicate raid is suppressed; the reported viewer count creates zero player accounts. This CLI version does not generate chat messages, so the chat fixtures are ours.
- `artifacts/twitch-cli-smoke.json`, `twitch-cli-character-overlay.png` and `twitch-cli-character-composite.png` record that protocol-to-render result. The dog-video background in the composite is licensed QA footage; it verifies rendering/compositing, not scene grounding or native AR.

## Remaining critical gaps

No live Twitch raid, real viewer OAuth/chat, public HTTPS webhook deployment or OBS application test has passed without configured credentials/owner environment. Camera object following and perching still lose tracking intermittently. Native AR remains uncompiled/device-untested. These limitations remain release gates despite the working local character path.
