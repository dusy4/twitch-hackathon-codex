# GAMEPLAY SYSTEMS — make this a living multiplayer universe

The minimum viable product is not the ceiling. The target is a stream in which every visible little character feels like it has an ongoing life, personality and memory. The camera feed is the world background, not an immutable video. Build a curated sandbox of composable *visual* actions before attempting unlimited generative assets.

## 1. Viewer-specific agent identity
- Each viewer has a persistent voxel adventurer: class/role, quirky idle personality, walk style, name badge, skin colors, pet, inventory, title and emote kit. These cosmetics persist across participating Twitch worlds.
- Optional personality settings: curious, chaotic, brave, sleepy, theatrical; affect animation and small emote decisions, never autonomous unwanted world changes.
- Command history translates into stories: "Alice climbed the table then summoned a frog". Store game events, not sensitive real-world footage.
- A Twitch raider whose known account enters the destination world retains equipment and earned achievements. Portal exit animation can vary based on their history.

## 2. Collective natural-language intent
- Commands like `!rift everyone assemble next to the dog` create invitations; eligible group leader or consenting squad members can opt in. This allows 20 viewers to form a conga line, recreate an artwork, launch a rescue expedition to a visible object, form an arrow or do coordinated dance moves.
- Squad commands support typed roles: 2 builders, 3 dancers, 1 knight, 1 wizard, without letting one person forcibly control all others.
- User's `!rift create a castle around the bicycle` builds a temporary voxel mini-castle near the visually detected bike; group can cooperatively add blocks, paths and banners. Server maintains synthetic structures in stage/world coordinates, with lease/TTL and depth-aware sorting.
- `!rift make the floor lava`, `!rift spawn a toy meteor` trigger streamer-enabled ambient visual-only scene effects with cooldown/budgets and participant scoring.

## 3. Party system and avatar-to-avatar interactions
- Challenges: sword-duel emotes, race to a detected bench, hide-and-seek around source-visible props, dancing battles, mini chess/table games with a tiny board, mount races.
- Emotes with physics: bumping into another player, cheering, forming human pyramid, carrying each other as cartoon avatars, leapfrog, shoulder ride, backflips.
- Item interactions: `!rift hand my lantern to @Bob`, `!rift put a crown on @Alice`, `!rift build a bridge between two chairs`. Use inventory, target consent/permissions and server game state; no real-world side effects.
- Creators can enable chaos levels: Cozy / Standard / Mayhem; these determine max animation intensity, spawning concurrency and SFX loudness, not privacy risk.

## 4. Raid as a first-class game mechanic
- Persistent **raider banners and factions**, with different color palettes, heraldry and portal entrances. Source streamer initiates raid in Twitch; destination gets live portal arrival + event provenance.
- Scoring: a raid creates shared world events (collect shards while the portal is open, defend the rift, contribute to a collaborative build). Authenticate individual contributors; reward only real participants, not anonymous silhouettes.
- Cross-stream **Rift Atlas** website: recent portals between participating channels, faction rankings, epic events, active destination portals; optional globe/graph view of Twitch communities (not physical geolocations).
- Raid credits: sending creator and receiving creator have a visible role, but no per-viewer credit without actual identity. One creator's raid does not automatically grant rights to control another creator's stream; destination settings remain sovereign.
- Larger raid spectacle changes level: a 20-person raid is a squad drop, a 250-person raid is a dramatic invasion, a 2000-person raid is portal storm with instanced stylized crowd and boss spawn.

## 5. Real-world-camera affordance creativity
- Choose visual gags that use *visible scene structure*: dogs/cats as temporary "mounts"; chairs as thrones; benches as obstacle courses; plants as miniature forests; someone's hat as a little campsite; coffee cups as swimming pools for a toy character; roads as rivers for tiny boats; real books as mountains to climb.
- Affordances are inferred only if target attributes/geometry are visible or confidently grounded. If one cannot be inferred, substitute a clearly fictional effect (tiny trampoline or hover platform) rather than claim impossible precision.
- Mixed reality physics are intentionally funny: characters are light as popcorn; all contact is on-screen. Add screen-space contact shadows, squash/stretch, dust particles, tiny cloth/ribbon trails and sound.
- The creative engine can choose from a configurable library of 50–100 expressive animations and effects, not rely on generating video for every action. Use procedural props for original castles, ladders, trees, portals, magical rings and hats.

## 6. Quest world and narrative
- Quest arcs: The Doggo Throne, Bicycle Expedition, The Red Object, Bench Party, Portal Siege, Find the Color, Build Under Pressure, Raid Ambassador, Dragon Delivery.
- Daily/weekly missions from deterministic available categories; opt-in contextual quests generated by vision and streamer preferences, reviewed by creator when real-world actions are implied.
- Separate participant quests, cooperative quests, streamer prestige quests, raid quests and seasonal special events; align reward policies to anti-farm rules and server verification.
- Boss encounters arise in *virtual* stage: players defeat giant shadow living inside portal through cooperative commands, dodge patterns and spells. Both camera and game mode remain legible.

## 7. Shards as a meaningful game mechanic
- Shards earned from verified quests, meaningful social contributions, seasonal missions; global leaderboard earned score (not current spending balance).
- Spend on cosmetics, entrances, pets, tiny vehicles, animated silhouettes, username plate color, portal textures, creative spell effects and avatar home furniture. Cosmetics cannot buy top weekly score.
- Faction prestige and streamer prestige distinct from player Shards; public leaderboard includes them as separate tabs with definitions.
- Seasons have distinct aesthetic changes and archived Hall of Fame, but wallet survives resets. Seasonal contest anti-farming + soft newcomer matchmaking.

## 8. Autonomy, friendliness and stream reliability
- Player avatar can continue with a short creator-approved default behavior when user isn't typing (idle, wander, wave), within max CPU budget; NEVER automatically draw unauthorized camera-person interactions from model guesses.
- Don't create an overwhelming sea of labels. Nearby active actors are detailed; crowd at distance becomes instanced visual sprites; names fade except hovered or highlighted protagonists.
- Outages and streaming delays should degrade gracefully: human-facing status, frozen/pause animation, resync. Bot users and unverified chat cannot farm balances.
