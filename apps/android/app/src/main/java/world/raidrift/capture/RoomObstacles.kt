package world.raidrift.capture

import kotlin.math.abs
import kotlin.math.floor

/** Short-lived, world-space depth evidence, not a reconstructed mesh. No camera image retained.
 * Two of three observations confirm low obstacles; observed floor can clear them again.
 * Depth NEVER establishes walking support. Coordinates/intrinsics are from the same FrameRecord. */
class RoomObstacles {
    private data class Cell(val x:Int,val z:Int)
    private data class Seen(val occupied:Set<Cell>,val floor:Set<Cell>)
    private val history=ArrayDeque<Seen>()
    private val obstacles=linkedMapOf<Cell,Long>()
    private var floorY:Float?=null
    private var last=Long.MIN_VALUE
    val size get()=obstacles.size
    fun clear() { history.clear();obstacles.clear();floorY=null;last=Long.MIN_VALUE }

    fun observe(record:FrameRecord,ground:Float,now:Long) {
        if(!ground.isFinite()) return
        val depth=record.depth ?: return
        val k=record.intrinsics?.takeIf { it.usable } ?: return
        if(last!=Long.MIN_VALUE && now-last !in 100..1000) {
            if(now-last in 0..99) return
            clear()
        }
        if(floorY?.let { abs(it-ground)>.04f }==true) clear()
        floorY=ground;last=now
        val hits=mutableSetOf<Cell>();val free=mutableSetOf<Cell>()
        // At most 1,200 samples regardless of future depth image resolution.
        val stride=kotlin.math.ceil(kotlin.math.sqrt(depth.width*depth.height/1200.0)).toInt().coerceAtLeast(1)
        for(y in 0 until depth.height step stride) for(x in 0 until depth.width step stride) {
            val d=depth.at(x,y)/1000f
            if(d !in .2f..4f) continue
            val u=(x+.5f)/depth.width;val v=(y+.5f)/depth.height
            val p=record.sensorPose.transformPoint((u*k.width-k.cx)/k.fx*d,-(v*k.height-k.cy)/k.fy*d,-d)
            val cell=cell(p.x,p.z)
            when {
                p.y-ground in .08f.. .34f -> hits+=cell
                abs(p.y-ground)<.045f -> free+=cell
            }
        }
        free.removeAll(hits)
        history.addLast(Seen(hits,free));while(history.size>3)history.removeFirst()
        val keys=(history.flatMap { it.occupied }+history.flatMap { it.floor }).toSet()
        for(key in keys) {
            when {
                history.count { key in it.occupied }>=2 -> { obstacles.remove(key);obstacles[key]=now }
                history.count { key in it.floor }>=2 -> obstacles.remove(key)
            }
        }
        obstacles.entries.removeAll { now-it.value !in 0..3000 || abs(it.key.x*.12f-record.sensorPose.tx)>5f || abs(it.key.z*.12f-record.sensorPose.tz)>5f }
        while(obstacles.size>2048) obstacles.remove(obstacles.keys.first())
    }

    fun blocked(p:FootPosition,now:Long):Boolean {
        val y=floorY ?: return false
        if(abs(p.y-y)>.06f) return false // another support layer, not this floor map
        val radius=.065f
        for(x in floor((p.x-radius)/.12f).toInt()..floor((p.x+radius)/.12f).toInt())
            for(z in floor((p.z-radius)/.12f).toInt()..floor((p.z+radius)/.12f).toInt()) {
                val at=obstacles[Cell(x,z)] ?: continue
                if(now-at in 0..3000) return true
            }
        return false
    }
    private fun cell(x:Float,z:Float)=Cell(floor(x/.12f).toInt(),floor(z/.12f).toInt())
}

/** Holds a walking heading through wrist jitter and looking straight down. */
class WalkingHeading {
    private var heading:Pair<Float,Float>?=null
    private var acceptedAt:FootPosition?=null
    fun clear() { heading=null;acceptedAt=null }
    fun sample(camera:FootPosition,x:Float,z:Float):Pair<Float,Float> {
        val length=kotlin.math.hypot(x,z)
        if(!length.isFinite() || length<.2f) return heading ?: (0f to -1f)
        val next=x/length to z/length
        val old=heading
        val moved=acceptedAt?.let { kotlin.math.hypot(camera.x-it.x,camera.z-it.z)>.3f } ?: true
        if(old==null || moved || old.first*next.first+old.second*next.second<.9063078f) {
            heading=next;acceptedAt=camera
        }
        return heading ?: next
    }
}
