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
    @Test fun privateLanHttpIsDebugOnlyAndDoesNotAcceptPublicLookalikes() {
        listOf("192.168.1.20", "10.1.2.3", "172.16.0.1", "172.31.255.254").forEach { host ->
            assertEquals(host, ServerAddress.parse("http://$host:3400", true).host)
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("http://$host:3400", false) }
        }
        listOf("172.15.255.255", "172.32.0.1", "192.169.1.20", "8.8.8.8", "192.168.1.20.example.com", "0.0.0.0").forEach { host ->
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("http://$host:3400", true) }
        }
    }
    @Test fun nativeMediaUsesAuthorizationHeaderRatherThanUrlToken() {
        val request = nativeMediaRequest(ServerAddress.parse("https://example.com", false), "private-pairing-token")
        assertEquals("https://example.com/v1/media", request.url.toString())
        assertNull(request.url.query)
        assertEquals("Bearer private-pairing-token", request.header("Authorization"))
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
    @Test fun trackingOriginCorrectionRebasesExistingBodiesWithoutStaleRoomCoordinates() {
        val motor = SurfaceMotor()
        motor.update("viewer", FootPosition(0f, 0f, 0f), 0f) { 0f }
        motor.rebase { FootPosition(it.x + 3f, it.y + 1f, it.z - 2f) }
        val corrected = FootPosition(3f, 1f, -2f)
        assertEquals(corrected, motor.update("viewer", corrected, 0f) { 1f })
        assertThrows(IllegalArgumentException::class.java) { motor.rebase { FootPosition(Float.NaN, 0f, 0f) } }
        assertEquals(corrected, motor.update("viewer", corrected, 0f) { 1f })
    }
    @Test fun followFormationStaysAheadOfTheCameraWhicheverWayItFaces() {
        val camera = FootPosition(10f, 1.4f, 5f)
        // Facing -Z: centre actor lands 1.6 m ahead, left/right actors spread across X.
        val centre = Formation.goal(camera, 0f, -1f, .5f, .5f, 1.1f)
        assertEquals(10f, centre.x, .001f); assertEquals(1.1f, centre.y, .001f); assertEquals(3.4f, centre.z, .001f)
        assertEquals(9.3f, Formation.goal(camera, 0f, -1f, 0f, .5f, 1.1f).x, .001f)
        assertEquals(10.7f, Formation.goal(camera, 0f, -1f, 1f, .5f, 1.1f).x, .001f)
        // Turning to face +X moves the formation with the camera.
        assertEquals(11.6f, Formation.goal(camera, 1f, 0f, .5f, .5f, 1.1f).x, .001f)
        // Looking straight down has no heading; the result is still finite.
        val down = Formation.goal(camera, 0f, 0f, .5f, .5f, 1.1f)
        assertTrue(listOf(down.x, down.y, down.z).all { it.isFinite() })
    }
    @Test fun actorsLeftFarBehindAreRecalledToTheirGoal() {
        val motor = SurfaceMotor()
        motor.update("viewer", FootPosition(0f, 0f, 0f), 0f) { 0f }
        assertFalse(motor.recall("viewer", FootPosition(3f, 0f, 0f), 5f))
        assertTrue(motor.recall("viewer", FootPosition(8f, 0f, 0f), 5f))
        // Re-enters at the new goal on the next update.
        assertEquals(FootPosition(8f, 0f, 0f), motor.update("viewer", FootPosition(8f, 0f, 0f), 0f) { 0f })
        assertFalse(motor.recall("absent", FootPosition(0f, 0f, 0f), 5f))
    }
    @Test fun raidSourceNameIsParsed() {
        val raw = """{"roomId":"r","mode":"LIVE","config":{"paused":false},"avatars":[],"raid":{"id":"x","started":1,"count":42,"from":"Speed"}}"""
        assertEquals("Speed", NativeWorld.parse(raw).raid!!.from)
    }
}
