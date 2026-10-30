package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class TrailSearchTest {
    private val floor=LandingSurface(1,0f,listOf(PlanePoint(-4f,-4f),PlanePoint(4f,-4f),PlanePoint(4f,4f),PlanePoint(-4f,4f)))
    private fun frame(x:Float=0f,depth:Boolean=true,blocked:Boolean=false):FrameRecord {
        val p=RigidPose(x,1.5f,0f)
        val projection=FloatArray(16).also { it[0]=1f;it[5]=1f;it[10]=-1f;it[11]=-1f;it[14]=-.1f }
        val mm=ShortArray(10000)
        for(y in 51..99) for(u in 0..99) mm[y*100+u]=(if(blocked)500 else (1500f/(2f*((y+.5f)/100f-.5f))).toInt().coerceAtMost(65000)).toShort()
        return FrameRecord("floor",0,p,p,projection,Affine2.IDENTITY,Intrinsics(50f,50f,50f,50f,100,100),if(depth)DepthSnapshot(100,100,mm)else null,emptyList())
    }
    @Test fun fixedCandidateSurvivesSmallCameraTranslationButNotNewBlockingDepth() {
        val first=TrailPlacement.search(frame(),listOf(floor),true)
        assertNotNull(first.candidate)
        val next=TrailPlacement.search(frame(.03f),listOf(floor),true,first.candidate)
        assertEquals(first.candidate,next.candidate)
        val blocked=TrailPlacement.search(frame(blocked=true),listOf(floor),true,first.candidate)
        assertNull(blocked.candidate)
        assertTrue(blocked.hint.contains("blocks"))
    }
    @Test fun previouslyUsedCandidateDoesNotStarveFreshPatches() {
        val first=TrailPlacement.search(frame(),listOf(floor),true).candidate!!
        val next=TrailPlacement.search(frame(),listOf(floor),true,first) { p -> kotlin.math.hypot(p.x-first.foot.x,p.z-first.foot.z)>.3f }
        assertNotNull(next.candidate)
        assertNotEquals(first.foot,next.candidate!!.foot)
    }
    @Test fun missingFloorAndDepthHaveDifferentUsefulGuidance() {
        assertTrue(TrailPlacement.search(frame(),emptyList(),true).hint.contains("Floor not measured"))
        assertTrue(TrailPlacement.search(frame(depth=false),listOf(floor),true).hint.contains("Waiting for room depth"))
        assertNull(TrailPlacement.search(frame(depth=false),listOf(floor),true).candidate)
        assertNotNull(TrailPlacement.search(frame(depth=false),listOf(floor),false).candidate)
    }
}
