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
        assertFalse(map.blocked(point,3251))
    }
    @Test fun trackingGapOrDifferentSupportHeightCannotReuseObstacles() {
        val map=RoomObstacles();map.observe(frame(),0f,0);map.observe(frame(),0f,250)
        assertTrue(map.blocked(point,250))
        map.observe(frame(),0f,2000)
        assertFalse(map.blocked(point,2000))
        map.observe(frame(),-.5f,2250)
        assertFalse(map.blocked(point,2250))
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
