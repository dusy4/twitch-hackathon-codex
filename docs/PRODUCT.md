# PRODUCT — interactions, game loops, worlds, growth

## Users and jobs
- **Viewer:** owns a tiny distinctive avatar across creators; can direct it with chat, browser or prompts; earns Shards by participation and verified quests; climbs public rankings; sees their character do delightful things on a real stream.
- **Streamer:** installs overlay easily, feels the raid spectacle, controls on-screen chaos, selects quest styles, grows a participatory community and sees analytics; no unsafe uncontrolled effects or excessive setup.
- **Raiding creator:** sends a visible invading faction/army with identity and shared visual motifs, gets a cross-channel legacy and optional rewards; may appear in destination stream raid history.
- **Spectator/nonparticipant:** instantly understands what's happening, can join with `!join`, sees summaries, portal events and player leaderboard; doesn't need an account to watch.

## First-session flows
1. Creator visits website -> connects Twitch -> chooses one-click preset -> generates secret-scoped OBS Browser Source URL -> adds overlay at matching canvas resolution -> tests raid and chat commands with a *clearly labeled simulated test* -> adjusts placement, scale, permissions and sound -> goes live.
2. Viewer in stream types `!join` -> bot/chat UI explains how to link identity if necessary -> server creates avatar keyed to Twitch ID; chat identity may be known without separate browser login, but manage permissions separately -> choose skin/color in web control panel.
3. `channel.raid` EventSub fires -> raid encounter begins with name, count, portal sequence and deterministic spectacle -> raiding participants who actually interact are resolved to authentic identities; anonymous crowd stays anonymous. Portal remains interactive for a time and carries faction score to recipient world.
4. Viewer uses `!rift <prompt>` -> command status acknowledged in overlay (do not spam Twitch chat) -> planned/validated -> avatar executes -> streamer and viewers see actions -> result recorded (reasonable privacy) -> social share link optional.
5. Streamer approves or activates a quest -> sampled scene evidence -> Decisions evaluates observable conditions -> backend verifies across frames -> Rift Shards awarded to eligible participants with explicit rules -> `/leaderboard` live updates.

## Three spatial layers
- **UI layer:** portal warnings, player labels, HUD, leaderboards, speech bubbles, quest cards; legible independent of 3D scene.
- **Stage layer:** 2.5D virtual floor/props within a source video; projected anchor points and collision illusions. Can use ordinary OBS footage/webcam with no real world depth. All realism that cannot be supported by detector geometry is clearly stylized.
- **AR world layer:** on-device AR camera pose, depth, plane detection and occlusion. Virtual actors may be genuinely world-anchored as camera moves. Enables a portal attached to a wall/sidewalk, avatars behind furniture, synchronized spatial action, AR world objects.

## Portal and raid — cinematic art direction
- 0s: quiet audiovisual hint; original low note, dust tremor, flickering violet reflections.
- 0.5–2s: blocky cracked black obsidian frame materializes: magnetic attraction, bursts, shards and camera-relative perspective.
- 2–4s: membrane fills with swirling animated distortion, parallax stars and subtle refraction; deep resonant audio; accessibility photosensitivity setting.
- 4–12s: charged rift explodes open; users come out in a mass but with controlled density/capped draw calls, names where legible; raider faction banner; character exits are individualized for actual known players.
- 12s+: portal stabilizes or fades; arriving avatars remain and have activities; streamer can close portal manually; the raid carries a world-state impact. Original sounds: summon, block-clunk, hum-loop, portal-open, creature footsteps, cheers, magic and close. SFX designed for OBS mix and loudness-normalized.
- Dynamic raid size tiers: 1–9 intimate party; 10–99 crowd; 100–999 huge invading army; 1000+ epic visual amplification with instanced rendering and no naive one-entity-per-viewer CPU overload.
- Distinct look: charcoal/obsidian, electric purple, magenta cracks, icy cyan highlights, pearlescent particles, whimsical low-poly anatomy; Minecraft is **inspiration**, not redistributed IP. Include original procedural voxel skins. Offer streamer-safe positioning and FX intensity presets.

## Game loops and system depth
- **Moment-to-moment:** movement/emotes, natural language improvisation, cooperative antics, quest card pops, on-screen multiplayer fights and parties (friendly cartoon), persistent items.
- **Session:** streamer selects scene adventures and goals; visitors earn participation and achievement rewards; raid boss / cross-stream challenges; large group constructions and social interactions.
- **Long-term:** avatar leveling, cosmetics, factions, rare titles, collections, streaks (with anti-farm limits), season ranks, season quests, streamer prestige, raid history. Shards are non-transferable virtual game credits unless an explicit future design requires otherwise; no outside cash value.
- **Share loop:** auto-generate a short streamer-approved replay clip of the unexpected event with correct user credit, one-line headline and link to participant profile and live world. Never auto-publish without creator consent.

## Natural-language actions
- `!rift sprint towards the dog and sit on it` => find visible dog track, choose route, run fast with footstep sounds, leap to dog's rendered surface, sit (with gentle cartoon squish, shadow); ride motion as dog moves; dismount when track disappears. If tracking unavailable, stage a stylized screen-space animation with a clear *visual target lost* state, not hidden teleportation.
- `!rift follow the person in the red hat` => target by observable clothing attribute, move avatar towards their on-screen bounding box while in frame; stop when they disappear; do not store face ID or real-world coordinates.
- `!rift climb onto the table and do a backflip` => detect horizontal surface and top region, path to its edge, ascend via stylized climb, keyframe backflip with landing and SFX.
- `!rift summon a tiny dragon and ride it` => spawn approved creature from asset registry or server-generated stylized primitives, apply rider attachment, execute fly path and despawn on TTL; bounded user-spawned world entities.
- `!rift build a castle near the chair` => detect chair anchor, place procedurally generated voxel geometry nearby; animate character construction; temporary structure unless streamer authorizes persistence.
- `!rift follow @Bob, then duel` => only resolve @Bob's *virtual player* ID; use player-vs-player interaction consent rules and status.
- `!rift everyone line up for a photo` => group action/vote/permission system: requester can't forcibly seize others' avatars without world/party ownership or prior opt-in. Send invitations or execute within designated group control context.

## Quest families
1. **Camera quests** (streamer opt-in): identify a red object; find a bicycle; show a book with a green cover; take three steps toward a landmark (requires suitable tracking and self-confirmation); show two contrasting colors in one frame.
2. **Avatar quests**: three avatars climb onto a bench; find and circle the visible dog; party around portal; perform a synchronized dance; build a small virtual castle. Verified from authoritative world state, not AI vision.
3. **Raid quests**: raiders escape portal within 30s; recover shards in recipient world; join faction defense; host/guest co-op boss.
4. **Narrative quests**: generated from scene + environment, with strict streamer controls; never require intrusive or risky real-world behavior. Preview before publishing if touching real-world streamer action.

## Website pages and essential content
- `/`: interactive hero demo, 15s wow video, live streams, "connect Twitch", "join world", demos, pricing only if added later.
- `/leaderboard`: **global**, weekly, monthly, season, all-time; player vs streamer/faction tabs; rank, avatar, name, verified earned Shards, seasonal score, quest wins, streak, status; `?period=week&type=players`; search; share cards; transparent rules; mobile-first, SSR pages, last-updated marker.
- `/players/[twitchId-or-slug]`: profile, vanity avatar with 3D viewer, achievements, rank trend, Shards earned/balance distinct, inventory, quest timeline, most visited worlds, privacy controls.
- `/streamers/[channel]`: creator world, faction, current online status, quests, community contributions, portal configuration link (owner-only), raid history.
- `/live`: discover participating worlds and open streams, latest raids, join info.
- `/quests`: active and past quests, rewards, eligibility/evidence policy.
- `/inventory`, `/shop`: cosmetic skins, particle trails, small pets, portal variations (non-cash).
- `/dashboard`: streamer onboarding, overlays, permissions, camera opt-in, quest builder, economy and live moderation.
- `/admin`: audited fixes, fraud flags, season resets, content moderation, stats, request budgets.

## Leaderboard fairness
- Weekly/season rankings are based on **eligible Shards earned** in period (not spendable wallet balance); specify UTC vs creator timezone; use UTC by default for global seasons.
- Raid event viewer count must never yield Shards to unidentified people; only validated participants collect rewards. Bot farming and repeats should be bounded per quest/event/user/channel/interval.
- Show last confirmed update, tie-breakers (score then first-achieved timestamp), pagination/caching, public opt-out or pseudonymous display; link avatars to real Twitch identity only with appropriate account/privacy handling.
- Weekly resets create historical season snapshots, not reset wallet balance. Players may browse previous leaderboards.

## Safety, privacy, creator controls
Keep things funny, not invasive. It is fine for virtual characters to sit on a dog in camera footage, follow a red-hatted figure *while in the scene*, or dance on a visible table. It's not a request to make the streamer do these things. Don't identify real people, track bystanders across sessions, publish location, or let prompts control real devices. Restrict explicit harassment/sexualized depictions of real people, hate symbols, doxing, unsafe offline tasks and unbounded visual spam. Streamer can disable individual object categories, user actions, targeted interactions, overlays, camera processing or AI. Low vision confidence must never trigger creator-action quest rewards.
