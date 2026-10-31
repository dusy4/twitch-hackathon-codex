package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Synthetic room: floor at y=0, a bed (x .6..1.6, z -1..1, 50 cm tall) and a desk top
 * (x -1.6..-.6, z -.5...5, 72-75 cm, no legs). Depth images are ray-traced from camera poses the
 * way ARCore reports them (z-depth in mm along the camera's -z), then fused like on the phone. */
class RoomVolumeTest {
    private data class Box(val x0:Float,val y0:Float,val z0:Float,val x1:Float,val y1:Float,val z1:Float)
    private val floor=Box(-4f,-.05f,-4f,4f,0f,4f)
    private val bed=Box(.6f,0f,-1f,1.6f,.5f,1f)
    private val desk=Box(-1.6f,.72f,-.5f,-.6f,.75f,.5f)
    private val w=64;private val h=48
    private val k=Intrinsics(50f,50f,32f,24f,w,h)

    private fun hit(b:Box,o:FootPosition,d:FootPosition):Float? {
        var t0=0f;var t1=Float.MAX_VALUE
        for((oc,dc,lo,hi) in listOf(arrayOf(o.x,d.x,b.x0,b.x1),arrayOf(o.y,d.y,b.y0,b.y1),arrayOf(o.z,d.z,b.z0,b.z1))) {
            if(kotlin.math.abs(dc)<1e-7f) { if(oc<lo||oc>hi) return null;continue }
            val a=(lo-oc)/dc;val c=(hi-oc)/dc
            t0=max(t0,min(a,c));t1=min(t1,max(a,c))
            if(t0>t1) return null
        }
        return t0
    }
    private fun pose(from:FootPosition,at:FootPosition):RigidPose {
        val dx=at.x-from.x;val dy=at.y-from.y;val dz=at.z-from.z
        val yaw=atan2(-dx,-dz);val pitch=atan2(dy,kotlin.math.hypot(dx,dz))
        // q = yaw(about y) * pitch(about x)
        val cy=cos(yaw/2);val sy=sin(yaw/2);val cp=cos(pitch/2);val sp=sin(pitch/2)
        return RigidPose(from.x,from.y,from.z,cy*sp,sy*cp,-sy*sp,cy*cp)
    }
    private fun scan(from:FootPosition,at:FootPosition,boxes:List<Box>):FrameRecord {
        val p=pose(from,at)
        val mm=ShortArray(w*h)
        for(y in 0 until h) for(x in 0 until w) {
            val u=(x+.5f)/w;val v=(y+.5f)/h
            val d=p.rotate((u*w-k.cx)/k.fx,-(v*h-k.cy)/k.fy,-1f)
            val t=boxes.mapNotNull { hit(it,from,d) }.minOrNull() ?: continue
            if(t<4.5f) mm[y*w+x]=(t*1000).toInt().toShort()
        }
        return FrameRecord("scan",0,p,p,FloatArray(16),Affine2.IDENTITY,k,DepthSnapshot(w,h,mm),emptyList())
    }
    private fun scanned(boxes:List<Box> =listOf(floor,bed,desk)):RoomVolume {
        val volume=RoomVolume();var now=0L
        val views=listOf(
            FootPosition(-.2f,1.3f,1.8f) to FootPosition(.9f,.2f,0f),
            FootPosition(-.2f,1.3f,-1.8f) to FootPosition(.9f,.2f,0f),
            FootPosition(.2f,1.4f,0f) to FootPosition(1.1f,.3f,0f),
            FootPosition(2.6f,1.3f,0f) to FootPosition(1.1f,.2f,0f),
            FootPosition(.3f,1.4f,1.2f) to FootPosition(-1.1f,.5f,0f),
            FootPosition(-.2f,1.2f,0f) to FootPosition(-.8f,0f,0f),
            FootPosition(0f,1.3f,.2f) to FootPosition(.3f,0f,0f))
        repeat(3) { for((from,at) in views) { volume.observe(scan(from,at,boxes),now);now+=150 } }
        return volume
    }
    private fun walking(volume:RoomVolume):WalkingGeometry {
        val plane=PlaneSnapshot(0f,listOf(PlanePoint(-3f,-3f),PlanePoint(3f,-3f),PlanePoint(3f,3f),PlanePoint(-3f,3f)))
        return WalkingGeometry(listOf(plane),emptyList(),volume=volume)
    }

    @Test fun bedSideIsAWallForFloorWalkersAndItsTopIsItsOwnLayer() {
        val volume=scanned();val geo=walking(volume)
        // Floor walker heading into the bed is stopped by the measured bed side.
        assertTrue(volume.bodyBlocked(FootPosition(1f,0f,0f)))
        assertFalse(geo.canStep(FootPosition(0f,0f,0f),FootPosition(1f,0f,0f)))
        // The bed top is a walkable layer at ~50 cm, without any ARCore plane for it.
        val top=geo.support(FootPosition(1.1f,.5f,0f))
        assertNotNull(top);assertEquals(.5f,top!!,.04f)
        // On the bed: walking along it works, walking off its edge does not.
        assertTrue(geo.canStep(FootPosition(1f,top,0f),FootPosition(1.3f,top,.3f)))
        assertFalse(geo.canStep(FootPosition(1.3f,top,0f),FootPosition(2f,top,0f)))
        // Floor around the bed stays floor (plane), not replaced by depth noise.
        assertEquals(0f,geo.support(FootPosition(0f,0f,0f))!!,.001f)
    }
    @Test fun charactersWalkUnderTheDeskButItsTopIsAnotherLayer() {
        val volume=scanned();val geo=walking(volume)
        assertFalse(volume.bodyBlocked(FootPosition(-1.1f,0f,0f)))
        assertTrue(geo.canStep(FootPosition(0f,0f,0f),FootPosition(-1.1f,0f,0f)))
        assertTrue(volume.layers(-1.1f,0f,-.2f,1f).any { it in .70f..0.78f })
    }
    @Test fun raycastHitsMeasuredGeometry() {
        val volume=scanned()
        val hit=volume.raycast(FootPosition(0f,.25f,0f),1f,0f,0f)
        assertNotNull(hit);assertEquals(.6f,hit!!.x,.08f)
        assertNull(volume.raycast(FootPosition(0f,.25f,0f),-1f,0f,0f,1f))
    }
    @Test fun aRemovedObjectIsCarvedAway() {
        val volume=scanned()
        assertTrue(volume.bodyBlocked(FootPosition(1f,0f,0f)))
        var now=10_000L
        val views=listOf(FootPosition(-.2f,1.3f,1.8f) to FootPosition(.9f,.2f,0f),FootPosition(2.6f,1.3f,0f) to FootPosition(1.1f,.2f,0f),FootPosition(.2f,1.4f,0f) to FootPosition(1.1f,.3f,0f))
        repeat(8) { for((from,at) in views) { volume.observe(scan(from,at,listOf(floor)),now);now+=150 } }
        assertFalse(volume.bodyBlocked(FootPosition(1f,0f,0f)))
    }
    @Test fun clearForgetsEverything() {
        val volume=scanned();assertTrue(volume.size>0)
        volume.clear();assertEquals(0,volume.size);assertNull(volume.surface(FootPosition(1.1f,.5f,0f)))
    }
}
