package world.raidrift.capture

data class TestViewer(val id: String, val name: String, val characterId: String, val character: String)
data class TestChatLine(val id: Long, val speaker: String, val text: String, val system: Boolean = false, val ok: Boolean = true)
data class StubChatEvent(val atMs: Long, val viewerId: String, val text: String)

/** Twitch-input stub. Scheduled inputs are chat messages, never animation/position mutations.
 * No network, Twitch identity, persistence or currency is fabricated. The regular renderer/motor
 * consumes the resulting world. A real raid has a count, not a list of identified participants:
 * these three fixed test identities claim their own characters by sending !join afterwards.
 */
class LocalPlayground {
    val viewers = listOf(
        TestViewer("stub-alice", "Alice", "test-alice", "Mage"),
        TestViewer("stub-bob", "Bob", "test-bob", "Rogue"),
        TestViewer("stub-charlie", "Charlie", "test-charlie", "Barbarian")
    )
    val scenario = listOf(
        StubChatEvent(1400, "stub-alice", "!join"),
        StubChatEvent(2300, "stub-bob", "!join"),
        StubChatEvent(3200, "stub-charlie", "!join"),
        StubChatEvent(6500, "stub-alice", "wave at me"),
        StubChatEvent(8500, "stub-bob", "walk right"),
        StubChatEvent(10500, "stub-charlie", "танцюй"),
        StubChatEvent(13000, "stub-bob", "стрибни"),
        StubChatEvent(15500, "stub-alice", "go forward"),
        StubChatEvent(18000, "stub-charlie", "run right"),
        StubChatEvent(20500, "stub-bob", "sit down"),
        StubChatEvent(23500, "stub-alice", "turn around then dance"),
        StubChatEvent(26500, "stub-charlie", "jump"),
        StubChatEvent(29500, "stub-bob", "walk left then jump"),
        StubChatEvent(33000, "stub-charlie", "помахай рукою"),
        StubChatEvent(36000, "stub-alice", "сядь")
    )
    var world = NativeWorld("local", "LOCAL TEST CHAT", false, false, emptyList(), null); private set
    var messages = listOf(TestChatLine(0, "Test room", "Tap Test raid. Three test viewers will join and send commands while you watch.", true)); private set
    var running = false; private set
    var elapsedMs = 0L; private set
    var delivered = 0; private set
    private var lastTick: Long? = null
    private val expires = mutableMapOf<String, Long>()
    private val bubbleExpires = mutableMapOf<String, Long>()
    private var serial = 0
    private var messageSerial = 0L
    private val queued = mutableMapOf<String, Pair<Long, List<String>>>()
    private var actionSerial = 0L

    private fun log(speaker: String, text: String, system: Boolean = false, ok: Boolean = true) {
        messages = (messages + TestChatLine(++messageSerial, speaker, text, system, ok)).takeLast(80)
    }

    /** Viewer identity determines ownership. A message cannot supply an actor ID. */
    fun send(viewerId: String, text: String, targetId: String?, tracks: List<TrackView>, now: Long): ChatReply {
        val viewer = viewers.firstOrNull { it.id == viewerId } ?: return ChatReply(false, "Unknown test viewer")
        val value = text.trim().take(300)
        if (value.isBlank()) return ChatReply(false, "Write a message first")
        log(viewer.name, value)
        val intent = TextIntent.parse(value)
        if (intent == null && !value.startsWith("!")) return ChatReply(true, "Chat message · try “walk right”, “стрибни”, or “turn around then dance”")
        queued.remove(viewer.id)
        val reply = applyCommand(intent?.first() ?: value, viewer, targetId, tracks, now)
        if (reply.ok && intent != null && intent.size > 1) queued[viewer.id] = (now + duration(intent.first())) to intent.drop(1)
        world = world.copy(heroes = world.heroes.map { if (it.id == viewer.characterId) it.copy(message = if (reply.ok) value else if (reply.text.startsWith("Couldn't find")) "Target not found" else "Command refused") else it })
        bubbleExpires[viewer.characterId] = now + 5000
        log("RaidRift → ${viewer.name}", reply.text, true, reply.ok)
        return reply
    }

    /** Manual action buttons use the same incoming-message handler as the stub feed. */
    fun command(text: String, actorId: String?, targetId: String?, tracks: List<TrackView>, now: Long): ChatReply {
        val viewer = viewers.firstOrNull { it.characterId == (actorId ?: viewers.first().characterId) }
            ?: return ChatReply(false, "Choose a test viewer")
        return send(viewer.id, if (text.startsWith("!")) text else "!rift $text", targetId, tracks, now)
    }

    private fun applyCommand(text: String, viewer: TestViewer, targetId: String?, tracks: List<TrackView>, now: Long): ChatReply {
        var clean = text.lowercase(java.util.Locale.ROOT).removePrefix("!rift ").removePrefix("!ourapp ").removePrefix("!").trim()
        if (clean == "join") {
            if (world.heroes.none { it.id == viewer.characterId }) {
                val i = viewers.indexOf(viewer)
                world = world.copy(heroes = world.heroes + Hero(viewer.characterId, viewer.name, .28f + i * .22f, .5f + i * .05f, "idle", spawnedAt = now))
            }
            return ChatReply(true, "${viewer.name} owns the ${viewer.character} · one viewer, one character")
        }
        if (clean.contains('@') || Regex("\\b(everyone|all characters|all players)\\b").containsMatchIn(clean))
            return ChatReply(false, "${viewer.name} can only control their own character")
        val running = clean.startsWith("run ")
        if (running && clean in setOf("run left", "run right")) clean = clean.removePrefix("run ")
        clean = mapOf("w" to "forward", "a" to "left", "s" to "back", "d" to "right", "up" to "forward", "down" to "back", "backward" to "back")[clean] ?: clean
        val actor = world.heroes.firstOrNull { it.id == viewer.characterId } ?: return ChatReply(false, "Send !join to claim your character")
        val action = when {
            Regex("\\b(stop|stand|idle)\\b").containsMatchIn(clean) -> "stop"
            clean.startsWith("turn_") -> clean
            Regex("\\b(sit|perch)\\b").containsMatchIn(clean) -> "sit"
            Regex("\\b(sleep|lie)\\b").containsMatchIn(clean) -> "sleep"
            "dance" in clean -> "dance"
            "wave" in clean || "hello" in clean -> "wave"
            "jump" in clean || "hop" in clean -> "jump"
            Regex("\\b(run|sprint|walk|go|follow|move)\\b").containsMatchIn(clean) -> "run"
            clean in setOf("left", "right", "forward", "back") -> if (running) "run" else "walk"
            else -> return ChatReply(false, "Try walk right, come closer, jump, or walk left then jump")
        }
        val directional = clean in setOf("left", "right", "forward", "back")
        val refersToObject = Regex("\\b(to|towards|on|onto|near|follow)\\b").containsMatchIn(clean)
        val named = tracks.filter { Regex("\\b${Regex.escape(it.label.lowercase(java.util.Locale.ROOT))}\\b").containsMatchIn(clean) }.maxByOrNull { it.score }
        val target = when {
            action in setOf("idle", "stop") || action.startsWith("turn_") || directional -> null
            named != null -> named.id
            targetId != null && (!refersToObject || Regex("\\b(it|here|this|target|selected)\\b").containsMatchIn(clean)) -> targetId
            refersToObject -> return ChatReply(false, "Couldn't find that object · waiting here. The streamer can use Target to name a measured surface.")
            else -> actor.target
        }
        val next = actor.copy(
            x = (actor.x + when (clean) { "left" -> -.13f; "right" -> .13f; else -> 0f }).coerceIn(.04f, .96f),
            y = (actor.y + when (clean) { "forward" -> -.09f; "back" -> .09f; else -> 0f }).coerceIn(.15f, .9f),
            animation = action, target = target, actionSerial = ++actionSerial,
            facing = null
        )
        world = world.copy(heroes = world.heroes.map { if (it.id == viewer.characterId) next else it })
        expires.remove(viewer.characterId)
        if (action in setOf("jump", "dance", "wave", "walk", "run", "turn_left", "turn_right", "turn_around")) expires[viewer.characterId] = now + when (action) { "jump" -> 1250; "turn_left", "turn_right", "turn_around" -> 800; "walk", "run" -> 1500; else -> 6000 }
        return ChatReply(true, "${viewer.name} · ${if (directional) "step $clean" else action}${target?.let { " → ${named?.label ?: "selected target"}" } ?: ""}")
    }

    private fun duration(command: String): Long = when (command) {
        "jump" -> 1300; "left", "right", "forward", "back", "run left", "run right" -> 1600
        "dance", "wave" -> 3000; else -> 800
    }

    /** Pause feed time while camera tracking is unavailable. Never catch up a background gap in a burst. */
    fun tick(now: Long, ready: Boolean = true, tracks: List<TrackView> = emptyList()): Boolean {
        val before = world
        val previous = lastTick
        lastTick = now
        val gap = previous?.let { (now-it).coerceAtLeast(0) } ?: 0L
        val pausedGap = gap - if (ready) gap.coerceAtMost(250) else 0L
        if (pausedGap > 0) {
            expires.replaceAll { _, at -> at + pausedGap }
            bubbleExpires.replaceAll { _, at -> at + pausedGap }
            queued.replaceAll { _, pending -> (pending.first + pausedGap) to pending.second }
        }
        if (world.raid != null && ready && previous != null) elapsedMs += (now - previous).coerceIn(0, 250)
        if (running && ready) {
            while (delivered < scenario.size && scenario[delivered].atMs <= elapsedMs) {
                val event = scenario[delivered++]
                send(event.viewerId, event.text, null, tracks, now)
            }
            if (delivered == scenario.size) {
                running = false
                log("Test room", "Chat replay finished. The three characters stay here. Replay the raid or open Chat to send your own test messages.", true)
            }
        }
        if (ready) queued.toMap().forEach { (viewerId, entry) ->
            if (now >= entry.first) {
                val viewer = viewers.first { it.id == viewerId }
                val commands = entry.second
                val reply = applyCommand(commands.first(), viewer, null, tracks, now)
                log("RaidRift → ${viewer.name}", reply.text, true, reply.ok)
                if (reply.ok && commands.size > 1) queued[viewerId] = (now + duration(commands.first())) to commands.drop(1)
                else queued.remove(viewerId)
            }
        }
        val done = expires.filterValues { now >= it }.keys.toSet()
        if (done.isNotEmpty()) {
            world = world.copy(heroes = world.heroes.map { if (it.id in done) it.copy(animation = "idle") else it })
            done.forEach(expires::remove)
        }
        val clearBubbles = bubbleExpires.filterValues { now >= it }.keys.toSet()
        if (clearBubbles.isNotEmpty()) {
            world = world.copy(heroes = world.heroes.map { if (it.id in clearBubbles) it.copy(message = "") else it })
            clearBubbles.forEach(bubbleExpires::remove)
        }
        return world != before || running
    }

    fun pauseReplay() { running = false }

    /** A count-only raid event, followed by canned chatter events. No extra streamer characters. */
    fun raid(now: Long) {
        serial++; queued.clear(); expires.clear(); bubbleExpires.clear(); delivered = 0; elapsedMs = 0; lastTick = now; running = true
        world = world.copy(heroes = emptyList(), raid = Raid("test-$serial", now, viewers.size, "TEST VIEWERS", true))
        messages = emptyList()
        log("Test raid", "3 viewers raided. Waiting for their !join messages…", true)
    }
}
