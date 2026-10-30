package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class LandingPlannerTest {
    private fun surface(id:Int=1, y:Float=0f, radius:Float=3f)=LandingSurface(id,y,listOf(PlanePoint(-radius,-radius),PlanePoint(radius,-radius),PlanePoint(radius,radius),PlanePoint(-radius,radius)))
    private val area=LandingArea(1,FootPosition(0f,0f,0f),0f,false)
    private fun record(depthMm:Int=0, pose:RigidPose=RigidPose(0f,1.5f,0f))=FrameRecord("landing",0,pose,pose,FloatArray(16).also { it[0]=1f;it[5]=1f;it[10]=-1f;it[11]=-1f;it[14]=-.1f },Affine2.IDENTITY,Intrinsics(50f,50f,50f,50f,100,100),DepthSnapshot(100,100,ShortArray(10000){depthMm.toShort()}),emptyList())

    @Test fun footprintMustFitMeasuredPolygonAtEveryCorner() {
        assertNotNull(LandingPlanner.evaluate(area,listOf(surface()),false){Clearance.UNKNOWN})
        assertNull(LandingPlanner.evaluate(area,listOf(surface(radius=.4f)),false){Clearance.CLEAR})
        val edge=area.copy(center=FootPosition(2.7f,0f,0f),yaw=45f)
        assertNull(LandingPlanner.evaluate(edge,listOf(surface()),false){Clearance.CLEAR})
        assertNull(LandingPlanner.evaluate(area,listOf(surface(y=.3f)),false){Clearance.CLEAR})
    }
    @Test fun observedUpperSurfaceOrDepthObstacleRejectsLanding() {
        assertNull(LandingPlanner.evaluate(area,listOf(surface(),surface(2,.3f)),false){Clearance.CLEAR})
        assertNull(LandingPlanner.evaluate(area,listOf(surface()),true){ if(it.x>0) Clearance.BLOCKED else Clearance.CLEAR })
        assertNull(LandingPlanner.evaluate(area,listOf(surface()),true){Clearance.UNKNOWN})
        assertTrue(LandingPlanner.evaluate(area,listOf(surface()),true){Clearance.CLEAR}!!.depthChecked)
        assertFalse(LandingPlanner.evaluate(area,listOf(surface()),false){Clearance.UNKNOWN}!!.depthChecked)
    }
    @Test fun depthUsesMatchingCameraPoseAxialDepthAndIntrinsics() {
        val point=FootPosition(0f,1f,-2f)
        assertEquals(Clearance.CLEAR,LandingPlanner.depthClearance(record(2100),point))
        assertEquals(Clearance.BLOCKED,LandingPlanner.depthClearance(record(1000),point))
        assertEquals(Clearance.UNKNOWN,LandingPlanner.depthClearance(record(),point))
        assertEquals(Clearance.UNKNOWN,LandingPlanner.depthClearance(record(2100),FootPosition(0f,1f,2f)))
        val rotated=RigidPose(0f,1.5f,0f,0f,.70710677f,0f,.70710677f)
        assertEquals(Clearance.CLEAR,LandingPlanner.depthClearance(record(2100,rotated),FootPosition(-2f,1f,0f)))
    }
    @Test fun lowObstacleAndMissingFloorDepthAreNotDeclaredClear() {
        val r=record(1850)
        val point=FootPosition(0f,0f,-2f)
        assertEquals(Clearance.BLOCKED,LandingPlanner.depthClearance(r,point,true))
        assertEquals(Clearance.UNKNOWN,LandingPlanner.depthClearance(record(2600),point,true))
        var floorProbes=0
        LandingPlanner.evaluate(area,listOf(surface()),false){ p -> if(p.y==0f)floorProbes++;Clearance.CLEAR }
        assertEquals(28,floorProbes)
        val polygon=(0 until 128).map { i -> val a=i*2*Math.PI/128;PlanePoint((3*kotlin.math.cos(a)).toFloat(),(3*kotlin.math.sin(a)).toFloat()) }
        assertNotNull(LandingPlanner.evaluate(area,listOf(surface().copy(polygon=polygon)),false){Clearance.CLEAR})
    }
    @Test fun noDepthDeviceCanChooseGeometryButDepthCapableDeviceWaits() {
        val geometry=LandingPlanner.choose(record(),listOf(surface(radius=6f)),false)
        assertNotNull(geometry)
        assertFalse(geometry!!.depthChecked)
        assertTrue(geometry.center.z<0f)
        assertNull(LandingPlanner.choose(record(),listOf(surface(radius=6f)),true))
        assertNull(LandingPlanner.choose(record(),listOf(surface(y=2f)),false))
    }
    @Test fun readyRequiresStableTimeAndResetsForTrackingGapsMovingCandidatesAndSubsumption() {
        val lock=LandingStability()
        for(now in listOf(0L,250L,500L,750L)) assertNull(lock.update(area,now,true))
        assertNotNull(lock.update(area,1000,true))
        assertNull(lock.update(area,1250,false))
        assertNull(lock.update(area,1500,true))
        assertNull(lock.update(area.copy(center=FootPosition(.3f,0f,0f)),1750,true))
        assertNull(lock.update(area.copy(surfaceId=2),2000,true))
        assertNull(lock.update(area.copy(surfaceId=2),4000,true))
        assertNull(lock.update(null,4250,true))
    }
    @Test fun invalidPolygonAndMissingSupportCannotCreateReadiness() {
        assertNull(LandingPlanner.evaluate(area,emptyList(),false){Clearance.CLEAR})
        assertNull(LandingPlanner.evaluate(area,listOf(surface().copy(polygon=listOf(PlanePoint(Float.NaN,0f)))),false){Clearance.CLEAR})
        assertNull(LandingPlanner.choose(record(),emptyList(),false))
    }
}
