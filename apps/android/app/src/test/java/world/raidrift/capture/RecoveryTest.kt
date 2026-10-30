package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class RecoveryTest {
    @Test fun cameraTimeIntegratesAcrossSkipped60And120HzDisplayFrames() {
        for (hz in listOf(60,90,120)) {
            val clock = PresentationClock(); val motor = SurfaceMotor(); motor.place("a",FootPosition(0f,0f,0f))
            var at = FootPosition(0f,0f,0f)
            for (i in 0..hz) {
                val delta=clock.sample(1_000_000_000L+i*1_000_000_000L/hz,i*1000L/hz,true) ?: continue
                at=motor.update("a",FootPosition(2f,0f,0f),delta){0f}!!
            }
            assertEquals("camera $hz Hz",.45f,at.x,.035f)
            assertNull(clock.sample(3_000_000_000L,3000,false))
            assertEquals(0f,clock.sample(4_000_000_000L,4000,true)!!,0f)
        }
    }

    @Test fun anchoredIdentityCanBeReacquiredWithoutRefreshingAnUnseenDetection() {
        val tracker=ObjectTracker()
        val b=TrackBox(.2f,.3f,.2f,.3f)
        val id=tracker.update(listOf(Detection("chair",.8f,b)),0).single().id
        tracker.preserve(setOf(id))
        assertTrue(tracker.update(emptyList(),2500).isEmpty())
        assertEquals(0L,tracker.remembered(id)!!.lastSeen)
        tracker.predict(mapOf(id to b))
        assertEquals(id,tracker.update(listOf(Detection("chair",.8f,b)),3000).single().id)
        assertTrue("chair" in STATIC_SCENE_LABELS); assertFalse("dog" in STATIC_SCENE_LABELS); assertFalse("person" in STATIC_SCENE_LABELS)
    }
    @Test fun chairSitAlignsPelvisToSelectedSurfaceInsteadOfPuttingFeetOnIt() {
        val seat = FootPosition(1f,.45f,-2f)
        for (yaw in listOf(0f,90f,180f,-90f)) {
            val root = SeatContact.root(seat,yaw)
            val a = Math.toRadians(yaw.toDouble())
            assertEquals(seat.y + SeatContact.CLEARANCE,root.y+SeatContact.PELVIS_Y,1e-5f)
            assertEquals(seat.x,root.x+kotlin.math.sin(a).toFloat()*SeatContact.PELVIS_Z,1e-5f)
            assertEquals(seat.z,root.z+kotlin.math.cos(a).toFloat()*SeatContact.PELVIS_Z,1e-5f)
            assertTrue(root.y < seat.y)
        }
    }
    @Test fun letterboxKeepsAspectAndInvertsPaddingInPortraitAndLandscape() {
        for ((w,h) in listOf(1080 to 1920,1920 to 1080,640 to 640)) {
            val fit = Letterbox(w,h,448)
            assertEquals(w.toFloat()/h, (448-2*fit.padX)/(448-2*fit.padY), 1e-5f)
            val box=fit.toSource(fit.padX+w*.2f*fit.scale,fit.padY+h*.3f*fit.scale,fit.padX+w*.8f*fit.scale,fit.padY+h*.9f*fit.scale)!!
            assertArrayEquals(floatArrayOf(w*.2f,h*.3f,w*.8f,h*.9f),box,.001f)
        }
        assertNull(Letterbox(400,800,448).toSource(0f,0f,20f,20f))
    }
    private val projection = FloatArray(16).also { it[0]=1f; it[5]=1f; it[10]=-1f; it[11]=-1f; it[14]=-1f }
    private fun frame(now: Long = 1000, cameraX: Float = 0f, depth: DepthSnapshot? = null) = FrameRecord(
        "test", now, RigidPose(cameraX, 1.5f, 0f), RigidPose(cameraX, 1.5f, 0f), projection,
        Affine2.IDENTITY, Intrinsics(4f, 4f, 2f, 2f, 4, 4), depth,
        listOf(PlaneSnapshot(0f, listOf(PlanePoint(-5f,-5f),PlanePoint(5f,-5f),PlanePoint(5f,5f),PlanePoint(-5f,5f))))
    )

    @Test fun delayedResultUsesOriginalCameraInsteadOfCurrentCamera() {
        val capture = frame(cameraX = 0f)
        val current = frame(cameraX = 1f)
        val atCapture = Unproject.viaPlanes(capture, .5f, .9f)!!
        val wrong = Unproject.viaPlanes(current, .5f, .9f)!!
        assertEquals(0f, atCapture.x, 1e-5f)
        assertEquals(1f, wrong.x, 1e-5f)
        assertTrue(SpatialObservation.usable(ObservationContext(3, 1, capture), 3, 1200))
        assertFalse(SpatialObservation.usable(ObservationContext(3, 1, capture), 4, 1200))
        assertFalse(SpatialObservation.usable(ObservationContext(3, 1, capture), 3, 2000))
    }

    @Test fun initialActorStartsOnMeasuredSurfaceNotAtProbeHeight() {
        val p = SurfaceMotor().update("hero", FootPosition(0f, 1.2f, -2f), 0f) { .4f }!!
        assertEquals(.4f, p.y, 0f)
    }

    @Test fun smoothedDisplayBoxDoesNotReplaceRawGeometryObservation() {
        val tracker = ObjectTracker()
        val initial = TrackBox(.1f,.2f,.2f,.3f)
        val moved = TrackBox(.15f,.22f,.2f,.3f)
        val id = tracker.update(listOf(Detection("chair", .8f, initial)), 0).single().id
        val t = tracker.update(listOf(Detection("chair", .9f, moved)), 200).single()
        assertEquals(id, t.id); assertEquals(moved, t.observedBox); assertNotEquals(moved, t.box)
    }

    @Test fun cameraMotionPredictionKeepsIdentityAcrossLargeScreenShift() {
        val tracker = ObjectTracker()
        val a = TrackBox(.1f,.4f,.15f,.25f); val b = TrackBox(.7f,.4f,.15f,.25f)
        val id = tracker.update(listOf(Detection("chair", .8f, a)), 0).single().id
        tracker.predict(mapOf(id to b))
        assertEquals(id, tracker.update(listOf(Detection("chair",.8f,b)),200).single().id)
    }

    @Test fun unrelatedDepthOutliersCannotMoveAnEstablishedAnchor() {
        val space = TrackSpace(samplesNeeded = 2, moveSamples = 3)
        val p = FootPosition(0f,0f,-2f)
        space.observe("a","chair",p,null,"depth",0)
        assertEquals(AnchorAction.CREATE,space.observe("a","chair",p,null,"depth",100))
        space.anchor("a",p)
        for ((i,x) in listOf(1f,2f,3f,4f).withIndex()) assertEquals(AnchorAction.NONE,space.observe("a","chair",p.copy(x=x),null,"depth",200L+i*100))
        assertEquals(p,space["a"]!!.foot)
    }

    @Test fun noDepthMeansNoInventedSeatHeight() {
        val geometry = SpatialObservation.geometry(frame(),TrackBox(.3f,.3f,.3f,.5f))!!
        assertEquals(0f,geometry.foot.y,0f); assertNull(geometry.supportY)
        assertEquals("plane",geometry.source)
    }

    @Test fun localActionsControlExactlyTheChosenCharacterAndKeepNoEconomy() {
        val local = LocalPlayground()
        local.viewers.forEach { local.send(it.id, "!join", null, emptyList(), 0) }
        val ids = local.world.heroes.map { it.id }
        val reply = local.command("sit", ids[1], "tap-chair", emptyList(), 0)
        assertTrue(reply.ok)
        assertEquals("idle",local.world.heroes[0].animation)
        assertEquals("sit",local.world.heroes[1].animation)
        assertEquals("tap-chair",local.world.heroes[1].target)
        assertEquals("LOCAL TEST CHAT",local.world.mode)
        assertFalse(local.command("run to the invisible dog",ids[0],null,emptyList(),100).ok)
        assertFalse(local.command("run to the invisible dog",ids[0],"tap-chair",emptyList(),100).ok)
    }

    @Test fun localPracticeRaidHasExplicitIdentityAndTransientAnimations() {
        val local = LocalPlayground()
        local.raid(1000)
        assertTrue(local.world.raid!!.test)
        assertTrue("A raid count does not invent viewer identities", local.world.heroes.isEmpty())
        local.viewers.forEach { local.send(it.id, "!join", null, emptyList(), 1000) }
        assertEquals(3,local.world.heroes.size)
        assertEquals(3,local.world.heroes.map { it.id }.toSet().size)
        local.pauseReplay()
        local.command("jump",local.world.heroes.first().id,null,emptyList(),1000)
        assertFalse(local.tick(2000)); assertTrue(local.tick(2500))
        assertEquals("idle",local.world.heroes.first().animation)
    }
}
