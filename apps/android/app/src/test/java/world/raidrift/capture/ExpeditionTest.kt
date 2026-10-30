package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class ExpeditionTest {
    private class Walk {
        val game=Expedition().also { it.start() }
        var now=0L
        var z=0f
        var visible=true
        var tracked=true
        var anchorTracked=true
        var people=listOf(TrailParticipant("a","Alice","idle",1),TrailParticipant("b","Bob","idle",1))
        val events=mutableListOf<TrailEvent>()
        fun tick(count:Int=1,candidate:TrailCandidate?=TrailCandidate(FootPosition(0f,0f,z-1.5f),1,true)) {
            repeat(count) {
                now+=250
                events+=game.update(TrailObservation(now,now*1_000_000,FootPosition(0f,1.4f,z),tracked,candidate,
                    siteTracked=anchorTracked,siteVisible=visible,participants=people))
            }
        }
        fun discover() { tick(12);assertNotNull(game.state.site) }
        fun advance(to:Float) { while(z>to+.001f) { z=maxOf(to,z-.2f);tick() } }
        fun collect() { val target=game.state.site!!.foot.z+.75f;advance(target);tick(5) }
        fun next() { advance(z-1.8f);discover() }
    }
    @Test fun standingStillCannotCollectOrSpawnLaterCrystals() {
        val w=Walk();w.discover()
        val original=w.game.state.site
        w.tick(80)
        assertEquals(0,w.game.state.collected)
        assertEquals(original,w.game.state.site)
        assertEquals(0f,w.game.state.distance,.0001f)
        w.collect();assertEquals(1,w.game.state.collected)
        w.tick(60);assertNull(w.game.state.site)
    }
    @Test fun completeRealObservationChainRequiresMovementThreePickupsShrineAndTwoDistinctFreshEmotes() {
        val w=Walk();w.discover();w.collect()
        w.next();w.collect();w.next();w.collect()
        assertEquals(3,w.game.state.collected);assertEquals(TrailPhase.SHRINE,w.game.state.phase)
        w.next();assertEquals(TrailKind.SHRINE,w.game.state.site!!.kind);w.collect()
        assertEquals(TrailPhase.PARTY,w.game.state.phase)
        w.people=w.people.map { it.copy(action="wave") };w.tick(2)
        assertTrue(w.game.state.cheers.isEmpty()) // Same action serial cannot become fresh through a pose label.
        w.people=w.people.map { if(it.id=="a") it.copy(serial=2) else it };w.tick()
        assertEquals(1,w.game.state.cheers.size)
        w.people=w.people.map { if(it.id=="a") it.copy(serial=3,action="jump") else it };w.tick()
        assertEquals(TrailPhase.PARTY,w.game.state.phase)
        w.people=w.people.map { if(it.id=="b") it.copy(serial=2,action="dance") else it };w.tick()
        assertEquals(TrailPhase.COMPLETE,w.game.state.phase)
        assertEquals(3,w.events.count { it.kind==TrailEventKind.COLLECTED })
        assertEquals(1,w.events.count { it.kind==TrailEventKind.RESTORED })
        assertEquals(1,w.events.count { it.kind==TrailEventKind.COMPLETED })
        w.tick(20);assertEquals(1,w.events.count { it.kind==TrailEventKind.COMPLETED })
    }
    @Test fun noSurfaceNoObjectiveEvenAfterWalking() {
        val w=Walk();w.tick(30,null);assertNull(w.game.state.site)
        for(i in 1..30) { w.z-=.2f;w.tick(candidate=null) }
        assertTrue(w.game.state.distance>4f);assertNull(w.game.state.site)
    }
    @Test fun movingCandidateCannotBeDebouncedIntoAnchoredPlacement() {
        val w=Walk()
        repeat(30) { i -> w.tick(candidate=TrailCandidate(FootPosition(if(i%2==0)0f else .4f,0f,-1.5f),1,true)) }
        assertNull(w.game.state.site)
    }
    @Test fun backgroundGapRelocalizationAndTrackingLossDoNotCreditDistanceOrCompleteDwell() {
        val w=Walk();w.discover();w.advance(-.6f);w.tick()
        w.tracked=false;w.tick(4);assertEquals(0f,w.game.state.charge,.0001f)
        w.tracked=true;w.tick(2);assertEquals(0,w.game.state.collected)
        val walked=w.game.state.distance
        w.z=-10f;w.tick();assertEquals(walked,w.game.state.distance,.0001f)
        assertEquals(0,w.game.state.collected)
        w.now+=10_000;w.z=-20f;w.tick();assertEquals(walked,w.game.state.distance,.0001f)
    }
    @Test fun visibilityAndNativeAnchorTrackingAreRequiredForPickup() {
        val w=Walk();w.discover();w.visible=false;w.advance(-.75f);w.tick(15)
        assertEquals(0,w.game.state.collected)
        w.visible=true;w.anchorTracked=false;w.tick(10);assertEquals(0,w.game.state.collected)
        w.anchorTracked=true;w.tick(5);assertEquals(1,w.game.state.collected)
    }
    @Test fun briefViewInterruptionDrainsChargeButCannotCompleteAnUnseenPickup() {
        val w=Walk();w.discover();w.advance(-.6f);w.tick()
        assertTrue(w.game.state.charge>0f)
        val charge=w.game.state.charge
        w.visible=false;w.tick()
        assertTrue(w.game.state.charge<charge);assertTrue(w.game.state.charge>0f)
        assertEquals(0,w.game.state.collected)
        w.tick(8);assertEquals(0f,w.game.state.charge,.001f)
    }
    @Test fun trackingLossCannotBankViewerCheersForTheReturn() {
        val w=Walk();w.discover();w.collect();w.next();w.collect();w.next();w.collect();w.next();w.collect()
        assertEquals(TrailPhase.PARTY,w.game.state.phase)
        w.tracked=false;w.people=w.people.map { it.copy(serial=3,action="dance") };w.tick(4)
        w.tracked=true;w.tick(10)
        assertTrue(w.game.state.cheers.isEmpty())
        w.people=w.people.map { it.copy(serial=4,action="wave") };w.tick()
        assertEquals(TrailPhase.COMPLETE,w.game.state.phase)
    }
    @Test fun stationaryHandJitterAndDuplicateFramesDoNotMakeProgress() {
        val w=Walk()
        repeat(80) { i -> w.z=if(i%2==0).04f else -.04f;w.tick(candidate=null) }
        assertEquals(0f,w.game.state.distance,.0001f)
        val before=w.game.state
        repeat(8) { w.game.update(TrailObservation(w.now+10000,w.now*1_000_000,FootPosition(0f,1.4f,-30f),true)) }
        assertEquals(before,w.game.state)
    }
    @Test fun lostObjectiveDoesNotBecomeAPickupAndCanBeReacquired() {
        val w=Walk();w.discover();val before=w.game.state.collected
        assertEquals(TrailEventKind.LOST,w.game.loseSite()!!.kind)
        assertEquals(before,w.game.state.collected)
        w.discover();assertNotNull(w.game.state.site);assertEquals(before,w.game.state.collected)
    }
    @Test fun stopAndRestartClearAllTransientProgress() {
        val w=Walk();w.discover();w.collect();w.game.stop()
        assertFalse(w.game.state.active);assertNull(w.game.state.site)
        w.game.start();assertEquals(0,w.game.state.collected);assertEquals(0f,w.game.state.distance,.0001f)
    }
    @Test fun approachDistanceCannotImmediatelyRevealTheNextCrystal() {
        val w=Walk();w.discover();w.collect()
        val before=w.game.state.distance
        w.advance(w.z-.8f);w.tick(20)
        assertTrue(w.game.state.distance>before);assertNull(w.game.state.site)
        w.advance(w.z-1f);w.discover()
    }
    @Test fun manualPauseBackwardSerialsAndShrineLossNeverInventOrUndoPartyProgress() {
        val w=Walk();w.discover();w.collect();w.next();w.collect();w.next();w.collect();w.next();w.collect()
        w.game.pause();w.people=w.people.map { it.copy(serial=10,action="dance") };w.tick(12)
        assertTrue(w.game.state.cheers.isEmpty())
        w.people=w.people.map { it.copy(serial=9) };w.tick()
        w.people=w.people.map { it.copy(serial=10) };w.tick()
        assertTrue(w.game.state.cheers.isEmpty())
        w.people=w.people.map { if(it.id=="a")it.copy(serial=11)else it };w.tick()
        assertEquals(1,w.game.state.cheers.size)
        w.game.loseSite();assertEquals(TrailPhase.PARTY,w.game.state.phase)
        w.next();assertEquals(1,w.game.state.cheers.size);assertEquals(TrailPhase.PARTY,w.game.state.phase)
        w.people=w.people.map { if(it.id=="b")it.copy(serial=11)else it };w.tick(2)
        assertEquals(TrailPhase.COMPLETE,w.game.state.phase)
    }
    @Test fun depthGraceRequiresRecentClearEvidenceAndHidesOnlyAfterConsensus() {
        val v=ObjectiveVisibility()
        assertFalse(v.update("a",Clearance.UNKNOWN,0))
        assertTrue(v.update("a",Clearance.CLEAR,100))
        assertTrue(v.update("a",Clearance.UNKNOWN,350))
        assertFalse(v.update("a",Clearance.UNKNOWN,650))
        assertFalse(v.update("a",Clearance.BLOCKED,900));assertFalse(v.hidden)
        assertFalse(v.update("a",Clearance.BLOCKED,1150));assertTrue(v.hidden)
        assertFalse(v.update("b",Clearance.UNKNOWN,1200));assertFalse(v.hidden)
    }
    @Test fun malformedAndTooNearCandidatesNeverCreateObjectives() {
        val w=Walk();w.tick(20,TrailCandidate(FootPosition(0f,0f,-.4f),1,true));assertNull(w.game.state.site)
        w.tick(20,TrailCandidate(FootPosition(Float.NaN,0f,-1.5f),1,true));assertNull(w.game.state.site)
    }
    @Test fun placementRequiresRealFootprintAndDepthWhenSupported() {
        val pose=RigidPose(0f,1.5f,0f)
        val record=FrameRecord("test",0,pose,pose,FloatArray(16).also { it[0]=1f;it[5]=1f;it[10]=-1f;it[11]=-1f;it[14]=-.1f },Affine2.IDENTITY,null,null,emptyList())
        val floor=LandingSurface(1,0f,listOf(PlanePoint(-4f,-4f),PlanePoint(4f,-4f),PlanePoint(4f,4f),PlanePoint(-4f,4f)))
        assertNotNull(TrailPlacement.choose(record,listOf(floor),false))
        assertNull(TrailPlacement.choose(record,listOf(floor),true))
        assertNull(TrailPlacement.choose(record,emptyList(),false))
        assertNull(TrailPlacement.choose(record,listOf(floor.copy(polygon=listOf(PlanePoint(-.1f,-.1f),PlanePoint(.1f,-.1f),PlanePoint(.1f,.1f)))),false))
        assertNull(TrailPlacement.choose(record,listOf(floor.copy(polygon=listOf(PlanePoint(Float.NaN,0f),PlanePoint(1f,0f),PlanePoint(0f,1f)))),false))
    }
    @Test fun stubCelebrationIsIncomingMessagesWithIndependentOwnership() {
        val room=LocalPlayground();room.raid(1000)
        room.viewers.forEach { room.send(it.id,"!join",null,emptyList(),1000) }
        room.pauseReplay();room.reactToTrail(TrailEventKind.RESTORED,2000)
        for(t in 2000L..6500L step 100L) room.tick(t,true)
        assertEquals(3,room.world.heroes.size)
        assertTrue(room.messages.any { it.speaker=="Alice" && it.text=="wave" })
        assertTrue(room.messages.any { it.speaker=="Bob" && it.text=="dance" })
        assertTrue(room.messages.any { it.speaker=="Charlie" && it.text=="стрибни" })
        assertFalse(room.send("stub-bob","!rift dance @Alice",null,emptyList(),7000).ok)
    }
}
