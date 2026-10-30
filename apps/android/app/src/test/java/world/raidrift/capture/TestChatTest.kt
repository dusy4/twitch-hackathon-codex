package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class TestChatTest {
    private fun join(room: LocalPlayground) = room.viewers.forEach { assertTrue(room.send(it.id, "!join", null, emptyList(), 0).ok) }

    @Test fun streamerOnlyStartsRaidAndStubMessagesDriveThreeIndependentCharacters() {
        val room = LocalPlayground()
        assertTrue(room.world.heroes.isEmpty())
        room.raid(0)
        assertEquals(3, room.world.raid!!.count)
        assertTrue(room.world.heroes.isEmpty())
        for (at in 100L..7000L step 100) room.tick(at)
        assertEquals(listOf("Alice", "Bob", "Charlie"), room.world.heroes.map { it.name })
        assertEquals(listOf("wave", "idle", "idle"), room.world.heroes.map { it.animation })
        assertEquals(4, room.delivered)
        assertTrue(room.world.heroes.all { it.spawnedAt != null })
        val beforeBobStep = room.world.heroes.associateBy { it.id }
        for (at in 7100L..9000L step 100) room.tick(at)
        assertEquals(beforeBobStep["test-alice"], room.world.heroes.first { it.id == "test-alice" })
        assertTrue(room.world.heroes.first { it.id == "test-bob" }.x > beforeBobStep.getValue("test-bob").x)
        assertEquals(beforeBobStep.getValue("test-charlie").copy(message = ""), room.world.heroes.first { it.id == "test-charlie" }.copy(message = ""))
        for (at in 9100L..43000L step 100) room.tick(at)
        assertFalse(room.running)
        assertEquals(room.scenario.size, room.delivered)
        assertEquals(3, room.world.heroes.size)
        assertEquals(room.scenario.map { it.text }, room.messages.filter { !it.system }.map { it.text })
        assertTrue(room.messages.filter { !it.system }.any { "then jump" in it.text })
        assertEquals("sit", room.world.heroes.first { it.id == "test-alice" }.animation)
        val finished = room.world
        room.tick(999_000)
        assertEquals("No hidden scene reset after replay", finished, room.world)
    }

    @Test fun repeatJoinIsIdempotentAndIncomingIdentityCannotControlAnotherPlayer() {
        val room = LocalPlayground(); join(room)
        val bob = room.world.heroes.first { it.id == "test-bob" }
        repeat(3) { room.send("stub-alice", "!join", null, emptyList(), 100) }
        assertEquals(3, room.world.heroes.size)
        assertFalse(room.send("stub-alice", "!rift make @Bob dance", null, emptyList(), 100).ok)
        assertFalse(room.send("unknown-viewer", "!dance", null, emptyList(), 100).ok)
        assertFalse(room.command("dance", "not-an-actor", null, emptyList(), 100).ok)
        assertTrue(room.send("stub-alice", "!dance", null, emptyList(), 100).ok)
        assertEquals(bob, room.world.heroes.first { it.id == "test-bob" })
        assertEquals("dance", room.world.heroes.first { it.id == "test-alice" }.animation)
        val before = room.world
        room.send("stub-alice", "great stream!", null, emptyList(), 200)
        assertEquals("Normal chat doesn't direct any hero", before, room.world)
    }

    @Test fun trackingPauseDoesNotBurstQueuedCommandsAndReplayReplacesRoster() {
        val room = LocalPlayground(); room.raid(0)
        for (at in 100L..1000L step 100) room.tick(at)
        val elapsed = room.elapsedMs
        room.tick(60_000, ready = false)
        room.tick(60_100, ready = false)
        assertEquals(elapsed, room.elapsedMs)
        assertEquals(0, room.delivered)
        room.tick(60_200)
        assertEquals(elapsed + 100, room.elapsedMs)
        room.tick(3_600_000)
        assertEquals(elapsed + 350, room.elapsedMs)
        assertEquals(0, room.delivered)
        room.tick(3_600_100)
        assertEquals(1, room.delivered)
        val firstRaid = room.world.raid!!.id
        room.raid(3_601_000)
        assertNotEquals(firstRaid, room.world.raid!!.id)
        assertEquals(0, room.delivered)
        assertTrue(room.world.heroes.isEmpty())
        for (at in 3_601_100L..3_605_000L step 100) room.tick(at)
        assertEquals(3, room.world.heroes.size)
        assertEquals(3, room.world.heroes.map { it.id }.toSet().size)
    }

    @Test fun chairMessageUsesRealSuppliedTargetAndLeavesOthersAlone() {
        val room = LocalPlayground(); join(room)
        val untouched = room.world.heroes.filter { it.id != "test-bob" }
        val chair = TrackView("measured-chair", "chair", TrackBox(.1f,.2f,.3f,.4f), .9f, "depth+anchor")
        assertTrue(room.send("stub-bob", "!rift run to the chair and sit on it", null, listOf(chair), 0).ok)
        val bob = room.world.heroes.first { it.id == "test-bob" }
        assertEquals("measured-chair", bob.target)
        assertEquals("sit", bob.animation)
        assertEquals(untouched, room.world.heroes.filter { it.id != "test-bob" })
        assertTrue(room.send("stub-bob", "!w", null, emptyList(), 100).ok)
        assertNull(room.world.heroes.first { it.id == "test-bob" }.target)
    }
}
