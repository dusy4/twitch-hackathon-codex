package world.raidrift.capture

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Persistent world-space 2.5D height field from ARCore depth: for each 8 cm floor column, how low
 * measured geometry starts and how tall it is. Not a reconstructed mesh; no camera image retained.
 * Two observations confirm a column; repeated clear-floor views remove it again (a moved chair, a dog).
 * Columns starting below [CLEARANCE] (bed sides, bed top, boxes) block floor walking; higher ones
 * (table tops) can be walked under. Confirmed columns also become invisible depth occluders.
 * Depth NEVER establishes walking support. Coordinates/intrinsics are from the same FrameRecord. */
class RoomObstacles {
    private data class Cell(val x:Int,val z:Int)
    private class Column(var hits:Int,var low:Float,var top:Float,var seen:Long)
    /** World-space, depth-only box: absolute [bottom]..[top] heights, [x]/[z] centre. */
    data class Occluder(val x:Float,val z:Float,val width:Float,val depth:Float,val bottom:Float,val top:Float)
    private val columns=LinkedHashMap<Cell,Column>()
    private var floorY:Float?=null
    private var last=Long.MIN_VALUE
    val size get()=columns.count { it.value.hits>=CONFIRMED }
    fun clear() { columns.clear();floorY=null;last=Long.MIN_VALUE }

    fun observe(record:FrameRecord,ground:Float,now:Long) {
        if(!ground.isFinite()) return
        val depth=record.depth ?: return
        val k=record.intrinsics?.takeIf { it.usable } ?: return
        if(last!=Long.MIN_VALUE && now-last in 0..99) return
        // Tracking loss is cleared by the caller; a different floor layer invalidates every column.
        if(floorY?.let { abs(it-ground)>.04f }==true) clear()
        floorY=ground;last=now
        val spans=HashMap<Cell,FloatArray>();val free=HashSet<Cell>()
        // At most ~2,400 samples regardless of future depth image resolution.
        val stride=kotlin.math.ceil(kotlin.math.sqrt(depth.width*depth.height/2400.0)).toInt().coerceAtLeast(1)
        for(y in 0 until depth.height step stride) for(x in 0 until depth.width step stride) {
            val d=depth.at(x,y)/1000f
            if(d !in .2f..4.5f) continue
            val u=(x+.5f)/depth.width;val v=(y+.5f)/depth.height
            val p=record.sensorPose.transformPoint((u*k.width-k.cx)/k.fx*d,-(v*k.height-k.cy)/k.fy*d,-d)
            val h=p.y-ground
            val cell=cell(p.x,p.z)
            when {
                h in MIN_OBSTACLE..MAX_TOP -> spans.getOrPut(cell) { floatArrayOf(h,h) }.let { it[0]=min(it[0],h);it[1]=max(it[1],h) }
                abs(h)<.04f -> free+=cell
            }
        }
        free.removeAll(spans.keys)
        for((key,span) in spans) {
            val column=columns.remove(key)
            // Re-inserted so the map stays ordered oldest-evidence first for the size cap.
            if(column==null) columns[key]=Column(1,span[0],span[1],now)
            else columns[key]=column.apply { hits=min(hits+1,MAX_HITS);low=min(low,span[0]);top=max(top,span[1]);seen=now }
        }
        for(key in free) { val column=columns[key] ?: continue;column.hits-=2;if(column.hits<=0) columns.remove(key) }
        val cx=record.sensorPose.tx;val cz=record.sensorPose.tz
        columns.entries.removeAll { (key,c) ->
            val age=now-c.seen
            age !in 0..TTL || c.hits<CONFIRMED && age>1000 || abs(key.x*CELL-cx)>6f || abs(key.z*CELL-cz)>6f
        }
        while(columns.size>MAX_COLUMNS) columns.remove(columns.keys.first())
    }

    fun blocked(p:FootPosition,now:Long):Boolean {
        val y=floorY ?: return false
        if(abs(p.y-y)>.06f) return false // another support layer, not this floor map
        val radius=.07f
        for(x in floor((p.x-radius)/CELL).toInt()..floor((p.x+radius)/CELL).toInt())
            for(z in floor((p.z-radius)/CELL).toInt()..floor((p.z+radius)/CELL).toInt()) {
                val c=columns[Cell(x,z)] ?: continue
                if(c.hits>=CONFIRMED && c.low<=CLEARANCE && now-c.seen in 0..TTL) return true
            }
        return false
    }

    /** Confirmed columns merged into at most [limit] boxes along x. Columns whose geometry starts
     * near the floor are extended down to it, so a character behind a bed is hidden by the bed's
     * whole side; floor contact in front of furniture is never occluded. */
    fun occluders(limit:Int=180):List<Occluder> {
        val y=floorY ?: return emptyList()
        val confirmed=columns.filter { it.value.hits>=CONFIRMED && it.value.top-it.value.low>=0f }
        val result=mutableListOf<Occluder>()
        for((z,row) in confirmed.entries.groupBy { it.key.z }.toSortedMap()) {
            var run:MutableList<Map.Entry<Cell,Column>>?=null
            fun flush() {
                val cells=run ?: return
                val low=cells.minOf { it.value.low };val top=cells.maxOf { it.value.top }
                val bottom=if(low<.15f) .01f else low
                val x0=cells.first().key.x*CELL;val x1=(cells.last().key.x+1)*CELL
                // Shaved below the measured top: depth noise must not swallow feet of a character standing on it.
                result+=Occluder((x0+x1)/2,(z+.5f)*CELL,x1-x0,CELL,y+bottom,y+max(top-.03f,bottom+.02f))
                run=null
            }
            for(entry in row.sortedBy { it.key.x }) {
                val open=run
                if(open!=null && entry.key.x==open.last().key.x+1 && abs(entry.value.top-open.last().value.top)<.12f && (entry.value.low<.15f)==(open.last().value.low<.15f)) open+=entry
                else { flush();run=mutableListOf(entry) }
            }
            flush()
        }
        return result.sortedByDescending { (it.top-it.bottom)*it.width }.take(limit)
    }
    private fun cell(x:Float,z:Float)=Cell(floor(x/CELL).toInt(),floor(z/CELL).toInt())
    companion object {
        const val CELL=.08f
        /** Lowest point of geometry a character can pass under (bed tops ~.45-.6 m block; desks don't). */
        const val CLEARANCE=.62f
        const val MIN_OBSTACLE=.06f
        const val MAX_TOP=1.4f
        const val CONFIRMED=2
        const val MAX_HITS=6
        const val TTL=45_000L
        const val MAX_COLUMNS=6000
    }
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
