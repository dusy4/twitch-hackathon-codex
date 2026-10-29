package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.sqrt

class WorldFramesTest {
    /** GL-style projection with focal 1 (90° FOV), as in NorthstarTest. */
    private val proj = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = -1f; it[14] = -1f; it[11] = -1f }
    private val identityView = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[15] = 1f }

    private fun record(
        id: String = "f-1", sensor: RigidPose = RigidPose(0f, 0f, 0f), display: RigidPose = RigidPose(0f, 0f, 0f),
        depth: DepthSnapshot? = null, planes: List<PlaneSnapshot> = emptyList()
    ) = FrameRecord(id, 0, sensor, display, proj, Affine2.IDENTITY, Intrinsics(100f, 100f, 50f, 50f, 100, 100), depth, planes)

    private fun square(cx: Float, cz: Float, half: Float) = listOf(
        PlanePoint(cx - half, cz - half), PlanePoint(cx + half, cz - half), PlanePoint(cx + half, cz + half), PlanePoint(cx - half, cz + half))

    private fun flatDepth(mm: Int) = DepthSnapshot(10, 10, ShortArray(100) { mm.toShort() })

    @Test fun quaternionRotatesAboutY() {
        val s = sqrt(0.5f)
        val p = RigidPose(1f, 2f, 3f, 0f, s, 0f, s).transformPoint(0f, 0f, -2f) // +90° about Y: -Z -> -X
        assertEquals(-1f, p.x, 1e-5f); assertEquals(2f, p.y, 1e-5f); assertEquals(3f, p.z, 1e-5f)
    }

    @Test fun unprojectsThroughStoredDepthAndPose() {
        val straight = Unproject.viaDepth(record(depth = flatDepth(2000)), 0.75f, 0.5f)!!
        assertEquals(0.5f, straight.x, 1e-4f); assertEquals(0f, straight.y, 1e-4f); assertEquals(-2f, straight.z, 1e-4f)
        val below = Unproject.viaDepth(record(depth = flatDepth(2000)), 0.5f, 0.75f)!!
        assertEquals(-0.5f, below.y, 1e-4f) // texture rows grow downward, camera +Y is up
        val s = sqrt(0.5f)
        val turned = Unproject.viaDepth(record(sensor = RigidPose(0f, 1f, 0f, 0f, s, 0f, s), depth = flatDepth(2000)), 0.5f, 0.5f)!!
        assertEquals(-2f, turned.x, 1e-4f); assertEquals(1f, turned.y, 1e-4f); assertEquals(0f, turned.z, 1e-4f)
        // Invalid depth (0) or no depth image -> null, so the plane fallback is used.
        assertNull(Unproject.viaDepth(record(depth = flatDepth(0)), 0.5f, 0.5f))
        assertNull(Unproject.viaDepth(record(), 0.5f, 0.5f))
    }

    @Test fun depthSamplingUsesMedianOfValidPixels() {
        val mm = ShortArray(25) { 1000 }; mm[12] = 0; mm[0] = 9000.toShort()
        assertEquals(1000, DepthSnapshot(5, 5, mm).sampleMm(0.5f, 0.5f))
        assertNull(DepthSnapshot(5, 5, ShortArray(25)).sampleMm(0.5f, 0.5f))
        // Little-endian DEPTH16 plane with row padding, downsampled by 2.
        val bytes = ByteArray(2 * 10) // 2 rows, 10-byte stride, 4 px each
        for (x in 0 until 4) { bytes[x * 2] = (0xE8).toByte(); bytes[x * 2 + 1] = 0x03 } // 1000 mm
        val d = DepthSnapshot.fromPlane(bytes, 4, 2, 10, 2)
        assertEquals(2, d.width); assertEquals(1, d.height); assertEquals(1000, d.at(1, 0))
    }

    @Test fun planeFallbackPrefersContainingPlaneThenLowest() {
        val camera = RigidPose(0f, 1.5f, 0f)
        val floor = PlaneSnapshot(0f, square(0f, -3f, 0.5f))
        val desk = PlaneSnapshot(0.7f, square(5f, 5f, 0.3f))
        val hit = Unproject.viaPlanes(record(display = camera, planes = listOf(desk, floor)), 0.5f, 0.75f)!!
        assertEquals(0f, hit.y, 0f); assertEquals(-3f, hit.z, 1e-4f)
        // Outside every polygon: the lowest plane (the floor extends beyond its detected polygon).
        val far = Unproject.viaPlanes(record(display = camera, planes = listOf(PlaneSnapshot(0f, square(9f, 9f, 0.2f)), desk)), 0.5f, 0.75f)!!
        assertEquals(0f, far.y, 0f)
        assertNull(Unproject.viaPlanes(record(display = camera), 0.5f, 0.75f))
        val located = Unproject.locate(record(display = camera, planes = listOf(floor)), 0.5f, 0.75f)!!
        assertEquals("plane", located.source); assertEquals(3f, located.distance, 1e-4f)
        val (w, h) = Unproject.metricSize(TrackBox(0.4f, 0.5f, 0.1f, 0.25f), 3f, proj)
        assertEquals(0.6f, w, 1e-4f); assertEquals(1.5f, h, 1e-4f)
    }

    @Test fun projectionRoundTripsAndBuildsClampedBoxes() {
        val (u, v, depth) = Projection.toView(FootPosition(1f, -1f, -2f), identityView, proj)!!
        assertEquals(0.75f, u, 1e-5f); assertEquals(0.75f, v, 1e-5f); assertEquals(2f, depth, 1e-5f)
        assertNull(Projection.toView(FootPosition(0f, 0f, 2f), identityView, proj)) // behind the camera
        val box = Projection.box(FootPosition(0f, -1f, -2f), 0.5f, 1f, identityView, proj)!!
        assertEquals(0.4375f, box.x, 1e-5f); assertEquals(0.5f, box.y, 1e-5f)
        assertEquals(0.125f, box.w, 1e-5f); assertEquals(0.25f, box.h, 1e-5f)
        val edge = Projection.box(FootPosition(5f, -1f, -2f), 0.5f, 1f, identityView, proj)!!
        assertTrue(edge.x + edge.w <= 1f + 1e-5f && edge.w >= 0.01f - 1e-6f)
    }

    @Test fun frameRingKeepsLastTwelve() {
        val ring = FrameRing(12)
        (1..15).forEach { ring.put(record("f-$it")) }
        assertEquals(12, ring.size)
        assertNull(ring["f-3"]); assertNotNull(ring["f-4"]); assertNotNull(ring["f-15"])
        ring.put(record("f-4")) // re-put moves to newest, no duplicate
        assertEquals(12, ring.size); assertEquals("f-4", ring.ids().last())
    }

    @Test fun visibleCropMatchesDisplayedRegion() {
        val map = ImageToView(640, 480, floatArrayOf(1.1f, -0.05f), floatArrayOf(1.1f, 1.05f), floatArrayOf(-0.1f, -0.05f))
        val crop = visibleUprightCrop(map)
        assertArrayEquals(intArrayOf(40, 29, 400, 582), crop)
        // The crop's corners land on the view's corners.
        val (ix, iy) = ImageToView.uprightToImage(40f, 29.09f, 90, 640, 480)
        val corner = map.map(ix, iy)
        assertEquals(0f, corner[0], 1e-3f); assertEquals(0f, corner[1], 1e-3f)
        val identity = ImageToView(100, 50, floatArrayOf(0f, 0f), floatArrayOf(1f, 0f), floatArrayOf(0f, 1f))
        assertArrayEquals(intArrayOf(0, 0, 100, 50), visibleUprightCrop(identity))
    }

    @Test fun yuvCropReadsTheRequestedRegion() {
        val y = byteArrayOf(16, 16, -21, -21, 16, 16, -21, -21) // 4x2: left dark, right bright
        val uv = ByteArray(4) { -128 }
        val (pixels, w, h) = yuvToUprightArgb(y, 4, uv, uv, 4, 2, 4, 2, 1, 0, intArrayOf(2, 0, 2, 2))
        assertEquals(2, w); assertEquals(2, h)
        assertTrue(pixels.all { (it and 0xff) >= 250 })
        assertThrows(IllegalArgumentException::class.java) { yuvToUprightArgb(y, 4, uv, uv, 4, 2, 4, 2, 1, 0, intArrayOf(3, 0, 2, 2)) }
    }

    @Test fun serverTrackRegistryResolvesOnceAndExpires() {
        val registry = ServerTrackRegistry<String>(absentMs = 4000)
        val mug = ServerTrack("srv-red_mug-1", "red mug", TrackBox(0.4f, 0.5f, 0.1f, 0.1f), 0.8f, 1, "server", "f-7")
        val phone = ServerTrack("ph-dog-1", "dog", TrackBox(0f, 0f, 0.1f, 0.1f), 0.9f, 1)
        assertEquals(listOf(mug), registry.incoming(listOf(mug, phone), 1000))
        assertEquals(1, registry.received)
        registry.resolved(mug, "anchor-1", 0.1f, 0.12f, "depth", 1000)
        assertTrue(registry.incoming(listOf(mug), 3000).isEmpty())
        assertEquals(3000, registry["srv-red_mug-1"]!!.lastListed)
        // A failed lookup is not retried for the same frame, but is for a newer frame.
        val lamp = ServerTrack("srv-lamp-1", "lamp", TrackBox(0f, 0f, 0.2f, 0.2f), 0.6f, 1, "server", "f-1")
        registry.failed(lamp, "frame f-1 not in buffer")
        assertEquals("frame f-1 not in buffer", registry.unresolved["srv-lamp-1"])
        assertTrue(registry.incoming(listOf(mug, lamp), 3100).none { it.id == "srv-lamp-1" })
        assertEquals(1, registry.incoming(listOf(mug, lamp.copy(frameId = "f-9")), 3200).size)
        assertTrue(registry.expire(6000).isEmpty())
        val gone = registry.expire(7500)
        assertEquals(listOf("anchor-1"), gone.map { it.anchor })
        assertTrue(registry.entries().isEmpty())
    }

    @Test fun trackSpaceAnchorsStableObjectsAndReanchorsOnlyOnRealMoves() {
        val space = TrackSpace()
        val chair = FootPosition(1f, 0f, -2f)
        repeat(3) { assertEquals(AnchorAction.NONE, space.observe("ph-chair-1", "chair", chair, 0.45f, "plane", it * 200L)) }
        assertEquals(AnchorAction.CREATE, space.observe("ph-chair-1", "chair", chair, 0.45f, "plane", 600))
        space.anchor("ph-chair-1", space["ph-chair-1"]!!.anchorAt!!)
        assertTrue(space["ph-chair-1"]!!.anchored)
        // Box jitter near the anchor does not move it.
        assertEquals(AnchorAction.NONE, space.observe("ph-chair-1", "chair", FootPosition(1.2f, 0f, -2.1f), 0.45f, "depth", 800))
        assertEquals(1f, space["ph-chair-1"]!!.foot.x, 1e-5f)
        // Three consistent far observations re-anchor it.
        val moved = FootPosition(2.5f, 0f, -2f)
        assertEquals(AnchorAction.NONE, space.observe("ph-chair-1", "chair", moved, null, "plane", 1000))
        assertEquals(AnchorAction.NONE, space.observe("ph-chair-1", "chair", moved, null, "plane", 1200))
        assertEquals(AnchorAction.MOVE, space.observe("ph-chair-1", "chair", moved, null, "plane", 1400))
        assertEquals(2.5f, space["ph-chair-1"]!!.anchorAt!!.x, 1e-5f)
        // Noisy samples never anchor.
        listOf(0f, 0.3f, -0.3f, 0.3f, -0.3f).forEachIndexed { i, dx ->
            assertEquals(AnchorAction.NONE, space.observe("ph-cat-1", "cat", FootPosition(dx, 0f, 0f), null, "ray", i * 100L))
        }
        // Anchored furniture outlives the 2 s drop; pinned server spots are never pruned here.
        space.pin("srv-mug-1", "mug", FootPosition(0f, 0.7f, -1f), 0.8f, "server-depth", 1400)
        assertTrue(space.prune(5000, emptySet()).contains("ph-cat-1"))
        assertNotNull(space["ph-chair-1"])
        assertEquals(listOf("ph-chair-1"), space.prune(20_000, emptySet()))
        assertNotNull(space["srv-mug-1"])
        assertEquals(AnchorAction.NONE, space.observe("srv-mug-1", "mug", FootPosition(3f, 0f, 0f), null, "plane", 20_000))
        assertEquals(0f, space["srv-mug-1"]!!.foot.x, 0f)
    }

    @Test fun payloadsMatchContracts() {
        val phone = OutgoingTrack("ph-potted_plant-1", "potted plant", TrackBox(0.1f, 0.1f, 0.2f, 0.2f), 0.99f, 5)
        val server = OutgoingTrack("srv-red_mug-1", "red mug", TrackBox(0.5f, 0.5f, 0.1f, 0.1f), 0.3f, 6, "server", "f-7")
        val many = (1..60).map { OutgoingTrack("ph-dog-$it", "dog", TrackBox(0f, 0f, 0.1f, 0.1f), 0.9f, 1) }
        val tracks = tracksPayload(many + phone + server).getJSONArray("tracks")
        assertEquals(50, tracks.length())
        val first = tracks.getJSONObject(0)
        assertEquals("srv-red_mug-1", first.getString("id")) // server tracks are never dropped by the cap
        assertEquals("server", first.getString("source")); assertEquals("f-7", first.getString("frameId"))
        val solo = tracksPayload(listOf(phone)).getJSONArray("tracks").getJSONObject(0)
        assertEquals("potted plant", solo.getString("class"))
        assertFalse(solo.has("source")); assertFalse(solo.has("frameId"))
        assertEquals("ph-potted_plant-3", trackIdFor("potted plant", 3))

        val frame = framePayload("f-12", "QUJD", 590, 1280)
        assertEquals("f-12", frame.getString("frameId")); assertEquals("QUJD", frame.getString("jpeg"))
        assertEquals(590, frame.getInt("width")); assertEquals(1280, frame.getInt("height"))

        val quest = questPayload("sit", "  Office   CHAIR ")
        assertEquals("quest", quest.getString("type")); assertEquals("sit", quest.getString("action"))
        assertEquals("office chair", quest.getString("targetClass")); assertEquals(2, quest.getInt("minPlayers"))
        assertThrows(IllegalArgumentException::class.java) { questPayload("sit", "   ") }
        assertThrows(IllegalArgumentException::class.java) { questPayload("fly", "chair") }
    }

    @Test fun worldParsesServerSourcedTracks() {
        val raw = """{"roomId":"r","mode":"LIVE","config":{},"avatars":[],
            "tracks":[{"id":"srv-red_mug-1","class":"red mug","box":[0.1,0.2,0.3,0.4],"confidence":0.7,"seenAt":5,"source":"server","frameId":"f-7"},
                      {"id":"ph-dog-1","class":"dog","box":[0.1,0.2,0.3,0.4],"confidence":0.9,"seenAt":5}]}"""
        val tracks = NativeWorld.parse(raw).tracks
        assertEquals("server", tracks[0].source); assertEquals("f-7", tracks[0].frameId); assertEquals("red mug", tracks[0].label)
        assertNull(tracks[1].source); assertNull(tracks[1].frameId)
    }

    @Test fun cameraConfigAndShadowHelpers() {
        assertEquals(1, pickCpuImageSize(listOf(640 to 480, 1280 to 720, 1920 to 1080)))
        assertEquals(0, pickCpuImageSize(listOf(640 to 480, 1920 to 1080)))
        assertNull(pickCpuImageSize(emptyList()))
        assertEquals(1f, BlobShadow.scale(0f), 0f)
        assertEquals(BlobShadow.INTENSITY, BlobShadow.intensity(0f), 0f)
        assertTrue(BlobShadow.intensity(0.4f) < BlobShadow.INTENSITY && BlobShadow.scale(0.4f) > 1f)
        assertTrue(BlobShadow.intensity(5f) > 0f)
    }
}
