package world.raidrift.capture

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Persistent world-space 3D collision volume fused from ARCore depth: sparse 5 cm voxels with
 * hit/miss evidence. Rays from the camera carve space they pass through (a moved chair, a dog), the
 * measured end point adds solid evidence. From it come:
 *  - layers: walkable tops (floor, bed top, table top) — a solid voxel with body clearance above;
 *  - body collision: solid geometry between ankle and head height around a foot (a bed side);
 *  - raycasts against the measured geometry.
 * No camera image retained. Coordinates/intrinsics come from the same FrameRecord. */
class RoomVolume {
    private class Voxel(var odds:Int,var sumY:Float,var n:Int,var seen:Long)
    private val voxels=HashMap<Long,Voxel>()
    private var last=Long.MIN_VALUE
    private var center:FootPosition?=null
    val size get()=voxels.count { it.value.odds>=SOLID }
    fun clear() { voxels.clear();last=Long.MIN_VALUE;center=null }

    fun observe(record:FrameRecord,now:Long) {
        val depth=record.depth ?: return
        val k=record.intrinsics?.takeIf { it.usable } ?: return
        if(last!=Long.MIN_VALUE && now-last in 0..99) return
        last=now
        val pose=record.sensorPose
        val ox=pose.tx;val oy=pose.ty;val oz=pose.tz
        center=FootPosition(ox,oy,oz)
        val stride=ceil(sqrt(depth.width*depth.height/SAMPLES.toDouble())).toInt().coerceAtLeast(1)
        val hits=HashMap<Long,FloatArray>()
        val misses=HashSet<Long>()
        for(y in 0 until depth.height step stride) {
            for(x in 0 until depth.width step stride) {
                val d=depth.at(x,y)/1000f
                if(d !in MIN_RANGE..MAX_RANGE) continue
                val u=(x+.5f)/depth.width;val v=(y+.5f)/depth.height
                val p=pose.transformPoint((u*k.width-k.cx)/k.fx*d,-(v*k.height-k.cy)/k.fy*d,-d)
                hits.getOrPut(key(p.x,p.y,p.z)) { floatArrayOf(0f,0f) }.let { it[0]+=p.y;it[1]+=1f }
                // At most SAMPLES rays of at most ~MAX_RANGE/VOXEL*3 steps, only existing voxels collected.
                carve(ox,oy,oz,p.x,p.y,p.z,misses)
            }
        }
        // One miss per voxel per frame, however many rays crossed it, and never where this frame hit.
        for(key in misses) if(key !in hits) voxels[key]?.let { it.odds-=MISS;it.seen=now }
        for((key,h) in hits) {
            val v=voxels.getOrPut(key) { Voxel(0,0f,0,now) }
            v.odds=min(v.odds+HIT,MAX_ODDS);v.sumY+=h[0];v.n+=h[1].toInt();v.seen=now
            if(v.n>64) { v.sumY*=.5f;v.n/=2 }
        }
        voxels.entries.removeIf { (key,v) ->
            v.odds<=0 || now-v.seen !in 0..TTL || abs(ix(key)*VOXEL-ox)>RADIUS || abs(iz(key)*VOXEL-oz)>RADIUS
        }
        if(voxels.size>MAX_VOXELS) voxels.entries.sortedBy { it.value.seen }.take(voxels.size-MAX_VOXELS).forEach { voxels.remove(it.key) }
    }

    /** Collects existing voxels the ray passed through, stopping 1.5 voxels short of the hit.
     * Exact voxel traversal (Amanatides-Woo): every voxel the segment touches, none skipped. */
    private fun carve(ox:Float,oy:Float,oz:Float,px:Float,py:Float,pz:Float,misses:MutableSet<Long>) {
        val dx=px-ox;val dy=py-oy;val dz=pz-oz
        val length=sqrt(dx*dx+dy*dy+dz*dz)
        val nx=dx/length;val ny=dy/length;val nz=dz/length
        // A shallow ray skims a floor or bed top for a long way before its hit; the margin grows
        // so it stops ~1.5 voxels above the surface instead of eroding the top layer.
        val end=length-VOXEL*1.5f/max(abs(ny),.25f)
        if(end<=0f) return
        var x=ix(ox);var y=iy(oy);var z=iz(oz)
        val sx=if(nx>0) 1 else -1;val sy=if(ny>0) 1 else -1;val sz=if(nz>0) 1 else -1
        fun next(o:Float,n:Float,i:Int,s:Int)=if(abs(n)<1e-6f) Float.MAX_VALUE else ((i+(if(s>0) 1 else 0))*VOXEL-o)/n
        fun delta(n:Float)=if(abs(n)<1e-6f) Float.MAX_VALUE else VOXEL/abs(n)
        var tx=next(ox,nx,x,sx);var ty=next(oy,ny,y,sy);var tz=next(oz,nz,z,sz)
        val ddx=delta(nx);val ddy=delta(ny);val ddz=delta(nz)
        var t=0f
        while(t<end) {
            val key=pack(x,y,z)
            if(key in voxels) misses+=key
            if(tx<=ty && tx<=tz) { t=tx;tx+=ddx;x+=sx }
            else if(ty<=tz) { t=ty;ty+=ddy;y+=sy }
            else { t=tz;tz+=ddz;z+=sz }
        }
    }

    fun solidAt(x:Float,y:Float,z:Float)=solid(ix(x),iy(y),iz(z))
    private fun solid(x:Int,y:Int,z:Int)=(voxels[pack(x,y,z)]?.odds ?: 0)>=SOLID

    /** Walkable tops in the column under (x, z), bottom to top, in metres. */
    fun layers(x:Float,z:Float,from:Float,to:Float):List<Float> {
        val cx=ix(x);val cz=iz(z)
        val result=mutableListOf<Float>()
        for(y in iy(from)..iy(to)) {
            if(!solid(cx,y,cz)) continue
            if((1..BODY_VOXELS).any { solid(cx,y+it,cz) }) continue
            result+=top(cx,y,cz)
        }
        return result
    }

    /** Highest walkable top at most [step] above [p] and at most [drop] below it. Depth leaves
     * single-column holes in a surface, so the four neighbouring columns count too (5 cm dilation). */
    fun surface(p:FootPosition,step:Float=STEP,drop:Float=.5f):Float? {
        var best:Float?=null
        for((dx,dz) in NEIGHBOURS) for(y in layers(p.x+dx*VOXEL,p.z+dz*VOXEL,p.y-drop,p.y+step))
            if(y<=p.y+step && (best==null || y>best)) best=y
        return best
    }

    /** True when measured geometry occupies the body of a character standing at [p]:
     * from just above a step up to its head, within [radius]. A bed side blocks a floor walker;
     * the same bed's top does not block a character standing on it. */
    fun bodyBlocked(p:FootPosition,radius:Float=.06f):Boolean {
        val y0=iy(p.y+STEP+VOXEL*.5f);val y1=iy(p.y+BODY);val y2=iy(p.y+CLEARANCE)
        for(x in ix(p.x-radius)..ix(p.x+radius)) for(z in iz(p.z-radius)..iz(p.z+radius)) {
            // Two solid voxels in the body span: a single one is usually depth noise over the floor.
            var count=0
            for(y in y0..y1) if(solid(x,y,z) && ++count>=2) return true
            // Depth sees surfaces, not insides: a top too low to walk under (bed, sofa seat) is
            // treated as solid down to this layer, like a navmesh's walkable-height filter.
            for(y in y1+1..y2) if(solid(x,y,z)) return true
        }
        return false
    }

    /** First measured solid voxel along the ray, as its centre, within [max] metres. */
    fun raycast(origin:FootPosition,dx:Float,dy:Float,dz:Float,max:Float=4f):FootPosition? {
        val length=sqrt(dx*dx+dy*dy+dz*dz)
        if(!length.isFinite() || length<1e-5f) return null
        val step=VOXEL*.5f
        var t=0f
        while(t<=max) {
            val x=origin.x+dx/length*t;val y=origin.y+dy/length*t;val z=origin.z+dz/length*t
            if(solidAt(x,y,z)) return FootPosition((ix(x)+.5f)*VOXEL,(iy(y)+.5f)*VOXEL,(iz(z)+.5f)*VOXEL)
            t+=step
        }
        return null
    }

    private fun top(x:Int,y:Int,z:Int):Float {
        val v=voxels[pack(x,y,z)]
        // Mean measured height of the top voxel's hits, never outside the voxel itself.
        val mean=if(v!=null && v.n>0) v.sumY/v.n else (y+.5f)*VOXEL
        return mean.coerceIn(y*VOXEL,(y+1)*VOXEL)
    }

    companion object {
        const val VOXEL=.05f
        /** Rise a character steps up without a jump; anything taller is a wall or another layer. */
        const val STEP=.04f
        /** Character head clearance above its feet. */
        const val BODY=.30f
        /** Lowest overhang characters walk under (desks ~.7 m yes; bed tops ~.45-.6 m no). */
        const val CLEARANCE=.62f
        private val BODY_VOXELS=ceil(BODY/VOXEL).toInt()
        private val NEIGHBOURS=listOf(0 to 0,1 to 0,-1 to 0,0 to 1,0 to -1)
        const val SAMPLES=2400
        const val MIN_RANGE=.2f
        const val MAX_RANGE=3.0f
        const val HIT=2
        const val MISS=1
        const val SOLID=4
        const val MAX_ODDS=8
        const val TTL=60_000L
        const val RADIUS=6f
        const val MAX_VOXELS=120_000
        private const val BIAS=1 shl 20
        private fun pack(x:Int,y:Int,z:Int)=((x+BIAS).toLong() shl 42) or ((y+BIAS).toLong() shl 21) or (z+BIAS).toLong()
        private fun ix(k:Long)=((k ushr 42) and 0x1fffff).toInt()-BIAS
        private fun iz(k:Long)=(k and 0x1fffff).toInt()-BIAS
        private fun ix(v:Float)=floor(v/VOXEL).toInt()
        private fun iy(v:Float)=floor(v/VOXEL).toInt()
        private fun iz(v:Float)=floor(v/VOXEL).toInt()
        private fun key(x:Float,y:Float,z:Float)=pack(ix(x),iy(y),iz(z))
    }
}
