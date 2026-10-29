package world.raidrift.capture

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NorthstarTest {
    @Test fun tailscaleCgnatHttpIsDebugOnly() {
        listOf("100.64.0.1", "100.100.1.2", "100.127.255.254").forEach { host ->
            assertEquals(host, ServerAddress.parse("http://$host:3400", true).host)
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("http://$host:3400", false) }
        }
        listOf("100.63.255.255", "100.128.0.1", "101.64.0.1", "100.64.0.1.evil.com").forEach { host ->
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.parse("http://$host:3400", true) }
        }
        assertEquals("raidrift-pc.tail7252b4.ts.net", ServerAddress.parse("https://raidrift-pc.tail7252b4.ts.net", false).host)
    }

    @Test fun raidFreshnessAcceptsMsOrSecondsAndSkew() {
        val now = 1_800_000_000_000L
        assertTrue(raidIsFresh(now - 5_000, now, 10_000))
        assertTrue(raidIsFresh((now - 5_000) / 1000, now, 10_000))
        assertTrue(raidIsFresh(now + 20_000, now, 10_000)) // phone clock behind server
        assertFalse(raidIsFresh(now - 60_000, now, 10_000))
        assertFalse(raidIsFresh(0, now, 10_000))
    }

    @Test fun relayAcceptsTailscaleRtmpHostname() {
        assertEquals("rtmp", RelayEndpoint.parse("rtmp://raidrift-pc.tail7252b4.ts.net:1935/live/raidrift").scheme)
    }

    @Test fun parsesNewWorldFieldsLeniently() {
        val raw = """{"roomId":"r","mode":"LIVE","config":{"paused":false},
            "avatars":[{"id":"a","name":"Ann","x":0.5,"y":0.5,"animation":"sit","target":"ph-dog-3","spawnedAt":1700000000000,"message":"on it"},
                       {"id":"b","name":"Bob","x":0.1,"y":0.2,"target":null}],
            "tracks":[{"id":"ph-dog-3","class":"dog","box":[0.1,0.2,0.3,0.4],"confidence":0.9,"seenAt":5},{"id":"bad","class":"x","box":[0,"nope"]}],
            "props":[{"id":"p1","kind":"confetti","x":0.5,"y":0.5,"expires":99}],
            "raid":{"id":"r1","from":"Speed","count":3,"started":1,"test":true},
            "quests":[{"title":"Sit near dog","progress":"1/2","completed":false,"action":"sit","targetClass":"dog"}]}"""
        val world = NativeWorld.parse(raw)
        assertEquals("ph-dog-3", world.heroes[0].target)
        assertEquals(1700000000000L, world.heroes[0].spawnedAt)
        assertEquals("on it", world.heroes[0].message)
        assertNull(world.heroes[1].target)
        assertNull(world.heroes[1].spawnedAt)
        assertEquals(1, world.tracks.size)
        assertEquals(TrackBox(.1f, .2f, .3f, .4f), world.tracks.single().box)
        assertEquals("confetti", world.props.single().kind)
        assertTrue(world.raid!!.test)
        assertEquals("1/2", world.quests.single().progress)
    }

    @Test fun trackerKeepsIdsStableAndSeparatesClasses() {
        val tracker = ObjectTracker()
        val first = tracker.update(listOf(Detection("dog", .9f, TrackBox(.1f, .5f, .2f, .2f)), Detection("cat", .8f, TrackBox(.6f, .5f, .2f, .2f))), 0)
        val dog = first.first { it.label == "dog" }.id
        assertEquals("ph-dog-1", dog)
        // Moves a little: same id via IoU.
        val second = tracker.update(listOf(Detection("dog", .9f, TrackBox(.13f, .5f, .2f, .2f))), 200)
        assertTrue(second.any { it.id == dog && it.lastSeen == 200L })
        // Small fast box with no overlap but a close centroid keeps its id.
        tracker.update(listOf(Detection("dog", .9f, TrackBox(.24f, .5f, .05f, .05f))), 400)
        assertTrue(tracker.active(400).any { it.id == dog && it.lastSeen == 400L })
        // A second dog far away gets a new id; old tracks expire after maxAge.
        val third = tracker.update(listOf(Detection("dog", .7f, TrackBox(.8f, .1f, .1f, .1f))), 500)
        assertTrue(third.any { it.id == "ph-dog-2" })
        assertTrue(tracker.update(emptyList(), 3000).isEmpty())
        assertEquals("ph-sports_ball-1", ObjectTracker().update(listOf(Detection("sports ball", .5f, TrackBox(0f, 0f, .1f, .1f))), 0).single().id)
    }

    @Test fun imageToViewHandlesPortraitRotationAndCrop() {
        // 640x480 landscape sensor image shown in portrait: image +x goes down the view, image +y goes left.
        val map = ImageToView(640, 480, floatArrayOf(1.1f, -0.05f), floatArrayOf(1.1f, 1.05f), floatArrayOf(-0.1f, -0.05f))
        assertEquals(90, map.rotation)
        val centre = map.map(320f, 240f)
        assertEquals(0.5f, centre[0], 1e-4f); assertEquals(0.5f, centre[1], 1e-4f)
        // Upright (rotated) bitmap is 480x640. Its top-left quadrant should land top-left in the view.
        val box = map.uprightBoxToView(0f, 0f, 240f, 320f)!!
        assertTrue(box.x < 0.5f && box.y < 0.5f)
        assertEquals(0f, box.x, 1e-3f) // clamped by the crop
        // Fully off-screen boxes are dropped.
        assertNull(ImageToView(100, 100, floatArrayOf(2f, 2f), floatArrayOf(3f, 2f), floatArrayOf(2f, 3f)).uprightBoxToView(0f, 0f, 50f, 50f))
    }

    @Test fun rotationHelpersAreInverse() {
        assertEquals(0, ImageToView.rotationFromAxis(1f, 0f))
        assertEquals(90, ImageToView.rotationFromAxis(0f, 1f))
        assertEquals(180, ImageToView.rotationFromAxis(-1f, 0.1f))
        assertEquals(270, ImageToView.rotationFromAxis(0f, -1f))
        // Image corner (w,0) rotated 90 CW lands at upright (h, w) for a w x h image.
        val (ix, iy) = ImageToView.uprightToImage(480f, 640f, 90, 640, 480)
        assertEquals(640f, ix, 0f); assertEquals(0f, iy, 0f)
        val (ax, ay) = ImageToView.uprightToImage(0f, 0f, 270, 640, 480)
        assertEquals(640f, ax, 0f); assertEquals(0f, ay, 0f)
    }

    @Test fun yuvConversionRotatesAndDownscales() {
        // 4x2 grey image; left half dark, right half bright.
        val y = byteArrayOf(16, 16, -21, -21, 16, 16, -21, -21) // 235 as signed byte = -21
        val uv = ByteArray(4) { -128 }
        val (pixels, w, h) = yuvToUprightArgb(y, 4, uv, uv, 4, 2, 4, 2, 1, 90)
        assertEquals(2, w); assertEquals(4, h)
        // After 90 CW, the image's left (dark) side is at the top.
        assertEquals(0, pixels[0] and 0xff)
        assertTrue((pixels[(h - 1) * w] and 0xff) >= 250)
        val (half, hw, hh) = yuvToUprightArgb(y, 4, uv, uv, 4, 2, 4, 2, 2, 0)
        assertEquals(2, hw); assertEquals(1, hh); assertEquals(2, half.size)
    }

    @Test fun groundRayAndHeightEstimate() {
        val identity = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = -1f; it[14] = -1f; it[11] = -1f }
        val dir = GroundRay.cameraDirection(0.5f, 1f, identity) // bottom-centre of view looks down 45 deg
        assertEquals(0f, dir.x, 1e-5f); assertEquals(-1f, dir.y, 1e-5f)
        val hit = GroundRay.intersect(FootPosition(0f, 1.4f, 0f), dir, 0f)!!
        assertEquals(-1.4f, hit.z, 1e-4f); assertEquals(0f, hit.y, 0f)
        assertNull(GroundRay.intersect(FootPosition(0f, 1.4f, 0f), FootPosition(0f, 0.2f, -1f), 0f))
        assertNull(GroundRay.intersect(FootPosition(0f, 1.4f, 0f), FootPosition(0f, -0.01f, -1f), 0f)) // beyond 8 m
        assertEquals(0.5f, GroundRay.objectHeight(0.25f, 1f, 1f), 1e-5f)
    }

    @Test fun trackSpaceSmoothsAndHoldsRestingTargets() {
        val space = TrackSpace()
        space.observe("ph-dog-1", "dog", FootPosition(0f, 0f, -2f), 0.4f, "plane", 0)
        space.observe("ph-dog-1", "dog", FootPosition(1f, 0f, -2f), 0.4f, "plane", 100)
        assertEquals(0.35f, space["ph-dog-1"]!!.foot.x, 1e-4f)
        space.observe("ph-dog-1", "dog", FootPosition(5f, 0f, -2f), null, "ray", 200) // jump > 1.5 m resets
        assertEquals(5f, space["ph-dog-1"]!!.foot.x, 0f)
        space.observe("ph-cat-1", "cat", FootPosition(0f, 0f, 0f), null, "ray", 200)
        space.prune(3000, setOf("ph-dog-1"))
        assertNotNull(space["ph-dog-1"]); assertNull(space["ph-cat-1"])
        space.prune(6000, setOf("ph-dog-1"))
        assertNull(space["ph-dog-1"])
    }

    @Test fun targetGoalsSpreadMoversAndSeatResters() {
        val dog = FootPosition(0f, 0f, -2f)
        val a = TargetGoal.goal(dog, null, 0, false, 0f, 0f).goal
        val b = TargetGoal.goal(dog, null, 1, false, 0f, 0f).goal
        assertEquals(0.3f, kotlin.math.hypot(a.x - dog.x, a.z - dog.z), 1e-4f)
        assertTrue(a.z > dog.z) // first mover stands on the camera side
        assertTrue(kotlin.math.hypot(a.x - b.x, a.z - b.z) > 0.15f)
        val seat = TargetGoal.goal(dog, 0.35f, 0, true, 0f, 0f)
        assertEquals(dog, seat.goal); assertEquals(0.35f, seat.lift, 1e-5f)
        val beside = TargetGoal.goal(dog, null, 0, true, 0f, 0f)
        assertEquals(0f, beside.lift, 0f)
        assertEquals(0.18f, kotlin.math.hypot(beside.goal.x - dog.x, beside.goal.z - dog.z), 1e-4f)
        assertEquals(0f, TargetGoal.yaw(0f, 1f), 1e-4f); assertEquals(90f, TargetGoal.yaw(1f, 0f), 1e-4f)
    }

    @Test fun presentedClipsUseRunWhileTravellingAndSitWhenArrived() {
        assertEquals("Running_A", presentedClip("sit", moving = true, targeted = true, lifted = false))
        assertEquals("Walking_A", presentedClip("idle", moving = true, targeted = false, lifted = false))
        assertEquals("Idle", presentedClip("run", moving = false, targeted = true, lifted = false))
        assertEquals("Sit_Floor_Idle", presentedClip("sit", moving = false, targeted = true, lifted = false))
        assertEquals("Sit_Chair_Idle", presentedClip("sit", moving = false, targeted = true, lifted = true))
    }

    @Test fun motorPlacesPortalSpawnsAndRunsFaster() {
        val motor = SurfaceMotor()
        assertTrue(motor.place("raider", FootPosition(0f, 0f, 0f)))
        assertFalse(motor.place("raider", FootPosition(5f, 0f, 0f)))
        val slow = SurfaceMotor().also { it.update("a", FootPosition(0f, 0f, 0f), 0f) { 0f } }
        val fast = SurfaceMotor().also { it.update("a", FootPosition(0f, 0f, 0f), 0f) { 0f } }
        val target = FootPosition(5f, 0f, 0f)
        val s = slow.updateWithWalls("a", target, 1f / 15, { _, _ -> false }) { 0f }!!
        val f = fast.updateWithWalls("a", target, 1f / 15, { _, _ -> false }, speed = 1f) { 0f }!!
        assertTrue(f.x > s.x * 2f)
    }

    @Test fun chatRepliesSummarizePlansAndErrors() {
        assertEquals(ChatReply(true, "Running to the dog · ai"), ChatReply.parse(200, """{"ok":true,"plan":{"summary":"Running to the dog"},"source":"ai"}"""))
        assertEquals("run → sit", ChatReply.parse(200, """{"ok":true,"plan":{"steps":[{"action":"run"},{"action":"sit"}]}}""").text)
        assertEquals("Sent", ChatReply.parse(200, """{"ok":true}""").text)
        assertEquals(ChatReply(false, "Couldn't find a dog"), ChatReply.parse(200, """{"ok":false,"code":"no_target","message":"Couldn't find a dog"}"""))
        assertFalse(ChatReply.parse(401, "").ok)
        assertEquals("Server returned 500", ChatReply.parse(500, "oops").text)
    }

    @Test fun tracksPayloadMatchesContract() {
        val many = (1..60).map { OutgoingTrack("ph-dog-$it", "dog", TrackBox(.9f, .5f, .3f, .6f), it / 100f, 1234L) }
        val json = tracksPayload(many + OutgoingTrack("x".repeat(81), "dog", TrackBox(0f, 0f, .1f, .1f), 1f, 1L))
        val tracks = json.getJSONArray("tracks")
        assertEquals(50, tracks.length())
        val first = tracks.getJSONObject(0)
        assertEquals("ph-dog-60", first.getString("id"))
        assertEquals("dog", first.getString("class"))
        val box = first.getJSONArray("box")
        assertEquals(0.1, box.getDouble(2), 1e-5) // clamped to stay inside the image
        assertEquals(0.5, box.getDouble(3), 1e-5)
        assertEquals(0.95, first.getJSONArray("anchor").getDouble(0), 1e-5)
        assertEquals(1.0, first.getJSONArray("anchor").getDouble(1), 1e-5)
        assertEquals(1234L, first.getLong("seenAt"))
        assertEquals(0, first.getJSONArray("attributes").length())
    }

    @Test fun debugStateAndPairParse() {
        val state = DebugState.parse("""{"log":[${(1..20).joinToString(",") { """{"at":$it,"kind":"chat","text":"m$it"}""" }}],
            "inbox":{"pending":1,"done":2,"failed":3},"ai":{"provider":"openai","model":"m","lastLatencyMs":812,"lastError":null},
            "avatars":[{},{}],"tracks":[{"id":"ph-dog-1","class":"dog","confidence":0.9}],
            "quests":[{"title":"Sit","progress":"1/2","completed":false}],"leaderboard":[{"name":"ann","score":5}]}""")
        assertEquals(15, state.log.size); assertEquals("m20", state.log.last().text)
        assertEquals(3, state.failed); assertEquals(812L, state.aiLatencyMs); assertEquals("", state.aiError)
        assertEquals(2, state.avatars); assertEquals("ann 5", state.leaderboard.single())
        val (server, token) = parsePairResponse(JSONObject().put("server", "http://100.64.1.2:3400").put("room", "demo").put("token", "abc").toString())
        assertEquals("http://100.64.1.2:3400", server); assertEquals("abc", token)
        assertThrows(Exception::class.java) { parsePairResponse("""{"token":""}""") }
    }
}
