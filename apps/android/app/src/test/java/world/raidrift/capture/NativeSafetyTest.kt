package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

class NativeSafetyTest {
    private fun snapshot(heroes: String = "[]", count: Int = 700) = """{"roomId":"room","mode":"SIMULATOR","config":{"paused":false,"reducedMotion":false},"avatars":$heroes,"raid":{"id":"raid","started":123,"count":$count}}"""
    @Test fun reportedRaidCountNeverCreatesIdentities() {
        val world = NativeWorld.parse(snapshot())
        assertEquals(700, world.raid!!.count)
        assertTrue(world.heroes.isEmpty())
    }
    @Test fun namedCharactersRetainPositionsAndActions() {
        val world = NativeWorld.parse(snapshot("""[{"id":"42","name":"Juniper","x":0.25,"y":0.75,"animation":"sit"}]"""))
        assertEquals(Hero("42", "Juniper", .25f, .75f, "sit"), world.heroes.single())
        assertEquals("Sit_Floor_Idle", characterClip(world.heroes.single().animation))
        assertEquals("Idle", characterClip("untrusted-action"))
    }
    @Test fun invalidIdentityAndCoordinatesAreRejected() {
        val hero = """{"id":"42","name":"Juniper","x":0.25,"y":0.75}"""
        assertThrows(IllegalArgumentException::class.java) { NativeWorld.parse(snapshot("[$hero,$hero]")) }
        assertThrows(IllegalArgumentException::class.java) { NativeWorld.parse(snapshot("[${hero.replace("0.25", "2.5")} ]")) }
    }
    @Test fun pairingRequiresSecureOriginOutsideDebugLoopback() {
        assertEquals("example.com", ServerAddress.parse("https://example.com", false).host)
        assertEquals("10.0.2.2", ServerAddress.parse("http://10.0.2.2:3400", true).host)
        listOf("http://example.com", "https://user:secret@example.com", "https://example.com?token=secret", "https://example.com#secret").forEach {
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse(it, true) }
        }
        assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("http://10.0.2.2", false) }
    }
    @Test fun nativeTransportKeepsTokenOutOfUrlAndReadsShortResponses() {
        val request = nativeWorldRequest(ServerAddress.parse("https://example.com", false), "private-pairing-token")
        assertEquals("https://example.com/v1/native/world", request.url.toString())
        assertEquals("Bearer private-pairing-token", request.header("Authorization"))
        fun response(code: Int, body: String) = Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
            .code(code).message("fixture").body(body.toResponseBody()).build()
        response(200, snapshot()).use { assertEquals("room", readNativeWorld(it).roomId) }
        response(401, "revoked").use { assertThrows(ExpiredPairing::class.java) { readNativeWorld(it) } }
        response(403, "wrong role").use { assertThrows(ExpiredPairing::class.java) { readNativeWorld(it) } }
        response(302, "redirect").use { assertThrows(java.io.IOException::class.java) { readNativeWorld(it) } }
        response(200, "x".repeat(2_000_001)).use { assertThrows(IllegalArgumentException::class.java) { readNativeWorld(it) } }
    }
    @Test fun actorFallsFromMeasuredDeskToMeasuredFloor() {
        val motor = SurfaceMotor()
        fun floor(p: FootPosition): Float = if (p.x < .2f) 0f else -.75f
        motor.update("viewer", FootPosition(0f, 0f, 0f), 0f, ::floor)
        var foot = FootPosition(0f, 0f, 0f)
        repeat(240) { foot = motor.update("viewer", FootPosition(.6f, 0f, 0f), 1f / 60, ::floor)!! }
        assertEquals(.6f, foot.x, .001f)
        assertEquals(-.75f, foot.y, .001f)
    }
    @Test fun missingGeometryFreezesAndHighLedgesBlockMovement() {
        val motor = SurfaceMotor()
        val start = FootPosition(0f, 0f, 0f)
        motor.update("viewer", start, 0f) { 0f }
        assertEquals(start, motor.update("viewer", FootPosition(1f, 0f, 0f), 1f) { null })
        repeat(60) { motor.update("viewer", FootPosition(1f, 0f, 0f), 1f / 60) { if (it.x < .1f) 0f else .5f } }
        val blocked = motor.update("viewer", FootPosition(1f, 0f, 0f), 0f) { 0f }
        assertTrue(blocked!!.x < .1f)
        motor.clear()
        assertNull(motor.update("viewer", start, 0f) { null })
    }
}
