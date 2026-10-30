package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.hypot

class RoomNavigationTest {
    private fun patch(x0:Float,z0:Float,x1:Float,z1:Float,y:Float=0f)=PlaneSnapshot(y,listOf(PlanePoint(x0,z0),PlanePoint(x1,z0),PlanePoint(x1,z1),PlanePoint(x0,z1)))
    private val floor=patch(-3f,-3f,3f,3f)
    private fun wall()=SensedWall(FootPosition(0f,0f,0f),FootPosition(0f,0f,1f),FootPosition(0f,1f,0f),FootPosition(1f,0f,0f),listOf(PlanePoint(-.45f,0f),PlanePoint(.45f,0f),PlanePoint(.45f,2f),PlanePoint(-.45f,2f)))

    @Test fun unsupportedGroundAndDeskEdgesCannotBecomeWalkingFloor() {
        val geometry=WalkingGeometry(listOf(patch(-1f,-1f,1f,1f)),emptyList())
        assertNull(geometry.support(FootPosition(2f,0f,0f)))
        assertFalse(geometry.canStep(FootPosition(.8f,0f,0f),FootPosition(1f,0f,0f)))
        assertFalse(geometry.canStep(FootPosition(0f,0f,0f),FootPosition(2f,0f,0f)))
        val gap=WalkingGeometry(listOf(patch(-2f,-1f,-.08f,1f),patch(.08f,-1f,2f,1f)),emptyList())
        assertFalse(gap.canStep(FootPosition(-1f,0f,0f),FootPosition(1f,0f,0f)))
        val desk=WalkingGeometry(listOf(floor,patch(-.5f,-.5f,.5f,.5f,.7f)),emptyList())
        assertFalse(desk.canStep(FootPosition(0f,.7f,0f),FootPosition(1f,.7f,0f)))
    }
    @Test fun finiteWallAndLowFurnitureHaveDetoursWithoutWarpingOrWrongFloorHeight() {
        for(geometry in listOf(WalkingGeometry(listOf(floor),listOf(wall())),WalkingGeometry(listOf(floor,patch(-.2f,-.45f,.2f,.45f,.25f)),emptyList()))) {
            val navigator=RoomNavigator { 0L };val motor=SurfaceMotor()
            var foot=FootPosition(-.9f,0f,0f);val goal=FootPosition(.9f,1.2f,0f)
            motor.place("a",foot);var detoured=false
            repeat(360) { i ->
                val next=navigator.next("a",foot,goal,i*33L,geometry::canStep)
                val moved=motor.updateWithWalls("a",next,1f/30f,{a,b->!geometry.canStep(a,b)},.45f,geometry::support)!!
                assertTrue(hypot(moved.x-foot.x,moved.z-foot.z)<=.0151f)
                assertEquals(0f,moved.y,.0001f)
                assertTrue(navigator.lastExpanded<=256)
                foot=moved;detoured=detoured || kotlin.math.abs(foot.z)>.45f
            }
            assertTrue("should take a visible detour",detoured)
            assertTrue("should arrive",hypot(foot.x-goal.x,foot.z-goal.z)<.05f)
        }
    }
    @Test fun disconnectedRoomWaitsAndNewObstacleInvalidatesCachedPathImmediately() {
        val navigator=RoomNavigator();val start=FootPosition(-.5f,0f,0f);val goal=FootPosition(.5f,0f,0f)
        assertEquals(goal,navigator.next("a",start,goal,0){_,_->true})
        assertEquals(start,navigator.next("a",start,goal,33){_,_->false})
        val geometry=WalkingGeometry(emptyList(),emptyList())
        assertEquals(start,navigator.next("a",start,goal,1000,geometry::canStep))
    }
    @Test fun searchesAreGloballyBoundedAndCannotSpawnOrRecallAnActor() {
        val nav=RoomNavigator();val from=FootPosition(0f,0f,0f);val goal=FootPosition(1f,0f,0f)
        var calls=0
        repeat(12) { nav.next("actor-$it",from,goal,0){_,_->calls++;false} }
        assertTrue(calls<=18) // only two searches; the rest wait their turn
        assertEquals(1,nav.lastExpanded)
        val served=mutableSetOf<String>()
        for(t in 500L..4000L step 100L) repeat(12) { i ->
            val id="actor-$i"
            if(nav.next(id,from,goal,t){_,_->true}==goal) served+=id
        }
        assertEquals(12,served.size)
    }
    @Test fun narrowDoorwayAndLargeDropRemainClosed() {
        val upper=WalkingGeometry(listOf(floor,patch(-.15f,-3f,.15f,3f,.25f)),emptyList())
        assertFalse(upper.canStep(FootPosition(-1f,0f,0f),FootPosition(1f,0f,0f)))
        val ledge=WalkingGeometry(listOf(patch(-2f,-2f,0f,2f,.3f),patch(0f,-2f,2f,2f)),emptyList())
        assertFalse(ledge.canStep(FootPosition(-1f,.3f,0f),FootPosition(1f,.3f,0f)))
    }
    @Test fun stopAndJumpCancelEvenAShortCachedRouteWithoutWaitingForReplan() {
        val nav=RoomNavigator();val here=FootPosition(0f,0f,0f);val oldGoal=FootPosition(.2f,0f,0f)
        assertEquals(oldGoal,nav.next("a",here,oldGoal,0){_,_->true})
        assertEquals(here,nav.next("a",here,here,33){_,_->true})
    }
    @Test fun twelveMovingGoalsKeepUsingValidOldLegsWhileReplansWait() {
        val nav=RoomNavigator { 0L };val motor=SurfaceMotor();val moving=IntArray(12)
        repeat(12){motor.place("$it",FootPosition(0f,0f,it*.2f))}
        repeat(600) { frame -> repeat(12) { i ->
            val at=motor.position("$i")!!
            val goal=FootPosition(1.5f+frame/30f,0f,i*.2f)
            val next=nav.next("$i",at,goal,frame*33L){_,_->true}
            val after=motor.update("$i",next,1f/30){0f}!!
            if(frame>=120 && after.x>at.x) moving[i]++
        } }
        moving.forEach { assertTrue("Moving follow goals must not freeze a party: $it/480",it>=432) }
    }
    @Test fun anActorThatStopsRequestingCannotHoldTheQueueAfterTwoFrames() {
        val nav=RoomNavigator { 0L };val at=FootPosition(0f,0f,0f);val goal=FootPosition(1f,0f,0f)
        nav.next("served",at,goal,0){_,_->true}
        nav.next("missing-body",at,goal,0){_,_->true}
        repeat(20) { nav.next("active",at,goal,(it+1)*33L){_,_->true} }
        assertEquals(goal,nav.next("active",at,goal,700){_,_->true})
    }
    @Test fun cooperativeDeadlineEndsSearchBeforeNodeCap() {
        var clock=0L
        val nav=RoomNavigator { clock.also { clock+=100_000 } }
        val at=FootPosition(0f,0f,0f)
        nav.next("a",at,FootPosition(10f,0f,0f),0){_,_->true}
        assertTrue(nav.lastExpanded<256)
        assertTrue(nav.lastPlanNanos<=2_500_000L)
    }
}
