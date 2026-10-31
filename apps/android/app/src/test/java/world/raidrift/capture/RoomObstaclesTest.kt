package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class RoomObstaclesTest {
    private fun frame(cameraY:Float=1f,missing:Boolean=false):FrameRecord {
        val pixels=ShortArray(144);pixels[4*12+6]=2000
        val pose=RigidPose(0f,cameraY,0f)
        return FrameRecord("fixture",0,pose,pose,FloatArray(16),Affine2.IDENTITY,Intrinsics(12f,12f,6f,0f,12,12),if(missing)null else DepthSnapshot(12,12,pixels),emptyList())
    }
    private val point=FootPosition(1f/12,0f,-2f)

    @Test fun isolatedDepthNoiseNeverBlocksAndDepthNeverCreatesFloor() {
        val map=RoomObstacles();map.observe(frame(),0f,0)
        assertFalse(map.blocked(point,0));assertEquals(0,map.size)
        assertNull(WalkingGeometry(emptyList(),emptyList()){map.blocked(it,250)}.support(point))
    }
    @Test fun twoDepthObservationsBlockUntilObservedFloorClearsOrEvidenceExpires() {
        val map=RoomObstacles();map.observe(frame(),0f,0);map.observe(frame(),0f,250)
        assertTrue(map.blocked(point,250))
        assertFalse(map.blocked(point.copy(y=.5f),250))
        map.observe(frame(missing=true),0f,500)
        assertTrue(map.blocked(point,500))
        map.observe(frame(.75f),0f,750);map.observe(frame(.75f),0f,1000)
        assertFalse(map.blocked(point,1000))
        map.clear();map.observe(frame(),0f,0);map.observe(frame(),0f,250)
        assertFalse(map.blocked(point,RoomObstacles.TTL+251))
    }
    @Test fun furnitureStaysMappedWhileTheCameraLooksAway() {
        val map=RoomObstacles();map.observe(frame(),0f,0);map.observe(frame(),0f,250)
        // Looking elsewhere (no depth at that column) for half a minute keeps the bed solid.
        map.observe(frame(missing=true),0f,30_000)
        assertTrue(map.blocked(point,30_000))
    }
    @Test fun differentSupportHeightCannotReuseObstacles() {
        val map=RoomObstacles();map.observe(frame(),0f,0);map.observe(frame(),0f,250)
        assertTrue(map.blocked(point,250))
        map.observe(frame(),-.5f,500)
        assertFalse(map.blocked(point,500))
    }
    @Test fun bedTopBlocksButCharactersWalkUnderADesk() {
        // Camera 1.25 m up sees geometry 50 cm above the floor: a bed top.
        val bed=RoomObstacles();bed.observe(frame(1.25f),0f,0);bed.observe(frame(1.25f),0f,250)
        assertTrue(bed.blocked(point,250))
        // 75 cm: a desk top. Not walkable onto, but there is room underneath.
        val desk=RoomObstacles();desk.observe(frame(1.5f),0f,0);desk.observe(frame(1.5f),0f,250)
        assertFalse(desk.blocked(point,250))
        val slab=desk.occluders().single()
        assertTrue(slab.bottom>.7f && slab.top>=slab.bottom)
    }
    @Test fun lowFurnitureOccludersReachTheFloorButNeverTheFeetOnTop() {
        // Camera .85 m up sees geometry 10 cm above the floor: the side of a bed frame.
        val map=RoomObstacles();map.observe(frame(.85f),0f,0);map.observe(frame(.85f),0f,250)
        val box=map.occluders().single()
        assertEquals(.01f,box.bottom,.001f)
        assertTrue(box.top<.1f)
        assertEquals(RoomObstacles.CELL,box.depth,.0001f)
        assertTrue(RoomObstacles().occluders().isEmpty())
    }
    @Test fun elevatedSurfaceBelowClearanceIsSolidForFloorWalkers() {
        fun patch(x0:Float,z0:Float,x1:Float,z1:Float,y:Float)=PlaneSnapshot(y,listOf(PlanePoint(x0,z0),PlanePoint(x1,z0),PlanePoint(x1,z1),PlanePoint(x0,z1)))
        val floor=patch(-3f,-3f,3f,3f,0f)
        val withBed=WalkingGeometry(listOf(floor,patch(.5f,-1f,1.5f,1f,.5f)),emptyList())
        assertFalse(withBed.canStep(FootPosition(0f,0f,0f),FootPosition(2f,0f,0f)))
        val withDesk=WalkingGeometry(listOf(floor,patch(.5f,-1f,1.5f,1f,.75f)),emptyList())
        assertTrue(withDesk.canStep(FootPosition(0f,0f,0f),FootPosition(2f,0f,0f)))
    }
    @Test fun wristYawAndLookingDownDoNotSwingFollowGoals() {
        val heading=WalkingHeading();val camera=FootPosition(0f,1.4f,0f)
        assertEquals(0f to -1f,heading.sample(camera,0f,-1f))
        for(x in listOf(-.17f,.17f,0f)) assertEquals(0f to -1f,heading.sample(camera,x,-.98f))
        assertEquals(0f to -1f,heading.sample(camera,0f,0f))
        assertEquals(1f to 0f,heading.sample(camera,1f,0f))
        assertEquals(0f to -1f,heading.sample(camera.copy(x=.4f),0f,-1f))
    }
}
