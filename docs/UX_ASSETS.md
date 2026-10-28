# UX & AUDIOVISUAL DIRECTION — joyful, viral and stream-safe

## Core visual personality
An original voxel fantasy meets contemporary streamer UI. Clearly Minecraft-*inspired* frame geometry and nether-like purple rift, but original obsidian pattern, particles, camera shake, skin designs, note design and sampled/original audio. Characters have ridiculously expressive readable silhouettes, large eyes, squishy responses to surfaces, satisfyingly animated limbs and accessories. Avoid over-designed generic AI/SaaS dashboard tropes. All interfaces feel like the same game.

## Key character states and animation library
`idle` variations, blink, walk, run, sprint, stop/skid, jump, double jump (if enabled), climb, sit, stand, lie, hover, celebrate, dance variants, wave, point, bow, laugh, stumble, surprised, take damage comic, throw confetti, ride mount, follow, build, dig, carry, cast spells, duel, group cheers, portal spawn and portal depart. Procedural locomotion with spring/damping, simple 3D skeletal/voxel hierarchy. Personalized sound cues; skin, hat, backpack, pet companion and faction crest slots. Reactions should be instantly readable in 1080p Twitch video even at 15–50 px character height: enlarge silhouette/effect for moments, limit name clutter.

## Portal sequence features
Original procedural soundtrack/sub-bass that rises as a raid emerges; block clunks, energy hum loop, low whoosh, fizzy particles, crowd skitter/footsteps, loud-but-controlled hero reveal and closing suction. Sound events have volume normalization, -dB ceiling and master volume; streamer chooses very quiet / default / epic. Animation tiers by raid size, screen-space orientation and reduced motion setting. Portal must not obscure streamer face/critical gameplay for more than user-configured duration. Dynamic sizing and camera-aware placement with optional scene anchors.

## Spatial comedy and interactions
- Dog: little avatar sprint/skid, leap, soft bounce onto visual outline, tiny sitting pose, ride tracking while dog moves; exclamation mark, motion lines and chirp sound.
- Red hat: person target highlighted briefly only to player/controller; virtual avatar zigzags after their image-space motion, then shrugs if track vanishes.
- Bench: character climbs with clumsy steps, sits at apparent surface and dangles feet with a shadow.
- Table: emote dance, moonwalk or backflip; no need to simulate real furniture collision if depth unavailable, but alignment must be convincing.
- Group: 10 players form an enormous arrow, cheer, cast spell circle, or construct the portal from blocks.
- Dragon: original miniature voxel dragon spawn, wing flapping, rider mount, glitter trail; asset selection from licensed art catalog or procedural shapes, not unreviewed remote download.

## Website design
- Landing: full-bleed **product-recorded** raid video loop (with creator permission), clear Twitch connection CTA, spectator try-demo without OAuth, live world feed and world map.
- `/leaderboard`: trophy hero but dense and legible data. Primary tabs Players / Streamers / Factions; controls Week / Month / Season / All-Time, global / channel; podium for top 3 with 3D avatar render and transparent ranking; searchable accessible table, filters retained in URL, mobile scroll and card view, live change ticks, user rank sticky area when logged in.
- Profile: cinematic 3D avatar preview, account progress, equipped gear, verified Shards earned, wallet balance, seasonal history/achievements, quest log, prestige, shareable social card with player consent.
- Creator dashboard: one-click OBS source copy, visual canvas transform/crop calibration, chat command toggle, profanity moderation, viewer rate, AI inference budget, physical camera processing permission, AR settings, SFX preview, emergency stop, quick replay and live health.
- Viewer controller: gamepad with D-pad + jump/emote buttons, natural-language prompt field with autocomplete examples, queued action status, tooltips for target resolution, inventory/equipment and quest card, responsive mobile portrait.
- Separate current status banners clearly show `LIVE TWITCH` vs `DEMO` vs `SIMULATOR`, and `CAMERA VISION ENABLED` vs off; never mislead.

## Accessibility, stream performance and safety
Color contrast AA, screen reader navigation for website, keyboard controls for controller, 60fps aspiration with quality fallback to 30, reduced motion/flash, low-audio mode, audio-onboarding, precise motion/flash warnings, GPU capability detection, on-screen captioned alerts. Let creator limit 3D particles, visual clutter, emoji reactions, camera overlays, high-contrast player labels. All text escaped/sanitized; Twitch names/chat never inserted as raw HTML.

## Creative quality acceptance shots
A real portal on top of actual Twitch broadcast (no black screen), 250-viewer raid treated as imposing crowd with ~30–100 legible figures (GPU budget adjusted), 2 identifiable raiders controlling avatars via chat, a dog-relative avatar sit as the dog moves, camera pan in native AR retains anchored portal with real occlusion where supported, 3-player quest reward & website leaderboard ranking change, viewer changes skin in website and sees it immediately on stream. Capture each as video/gif + screenshots from actual app.
