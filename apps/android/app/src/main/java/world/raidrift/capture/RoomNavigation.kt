package world.raidrift.capture

import java.util.PriorityQueue
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot

/** Conservative local walking geometry. Plane boundaries are evidence, not infinite floors.
 * No inferred chair boxes or semantic detections become colliders. */
class WalkingGeometry(private val surfaces: List<PlaneSnapshot>, private val walls: List<SensedWall>, private val occupied: (FootPosition)->Boolean = { false }) {
    private data class Bounds(val plane:PlaneSnapshot,val x0:Float,val x1:Float,val z0:Float,val z1:Float) {
        fun contains(x:Float,z:Float)=x in x0..x1 && z in z0..z1 && plane.contains(x,z,0f)
    }
    private val patches=surfaces.filter { it.polygon.size in 3..256 }.map { p -> Bounds(p,p.polygon.minOf { it.u },p.polygon.maxOf { it.u },p.polygon.minOf { it.v },p.polygon.maxOf { it.v }) }
    private val fits=mutableMapOf<FootPosition,Boolean>()
    fun support(p: FootPosition): Float? {
        var best:Float?=null
        for(surface in patches) if(surface.plane.y<=p.y+.035f && (best==null || surface.plane.y>best) && surface.contains(p.x,p.z)) best=surface.plane.y
        return best
    }
    private fun canStand(p:FootPosition):Boolean=fits.getOrPut(p) {
        if(occupied(p)) return@getOrPut false
        for((dx,dz) in FOOTPRINT) {
            val q=p.copy(x=p.x+dx,z=p.z+dz)
            val y=support(q) ?: return@getOrPut false
            if(abs(y-p.y)>.035f) return@getOrPut false
            if(patches.any { it.plane.y>y+.04f && it.plane.y<y+.34f && it.contains(q.x,q.z) }) return@getOrPut false
        }
        true
    }

    fun canStep(from: FootPosition, to: FootPosition): Boolean {
        if (listOf(from, to).any { !it.x.isFinite() || !it.y.isFinite() || !it.z.isFinite() }) return false
        if (walls.any { it.blocks(from, to, .065f) }) return false
        val steps = ceil(hypot(to.x-from.x, to.z-from.z)/.05f).toInt().coerceAtLeast(1)
        // Bound callers too; routes are local, not a room-sized synchronous collision sweep.
        if (steps > 100) return false
        for (i in 0..steps) {
            val t=i.toFloat()/steps
            val p=FootPosition(from.x+(to.x-from.x)*t, from.y, from.z+(to.z-from.z)*t)
            if(!canStand(p)) return false // no automatic stairs or walking off a desk
        }
        return true
    }
    companion object {
        private val FOOTPRINT=listOf(0f to 0f,-.065f to -.065f,-.065f to .065f,.065f to -.065f,.065f to .065f)
    }
}

/** Bounded local A* with cached waypoints. Unknown/disconnected ground means wait, never warp.
 * Two searches per 500 ms globally, at most 256 expanded nodes each, for the rendered 12 actors.
 * A cached route is still collision-checked every movement frame. */
class RoomNavigator(private val clock:()->Long = System::nanoTime) {
    private data class Route(val goal: FootPosition, val created: Long, val points: ArrayDeque<FootPosition>)
    private data class Cell(val x: Int, val z: Int)
    private data class Entry(val cell: Cell, val cost: Float, val score: Float)
    private val routes=mutableMapOf<String,Route>()
    private val waiting=linkedSetOf<String>()
    private val requested=mutableMapOf<String,Long>()
    private var window=Long.MIN_VALUE
    private var searches=0
    private var searchFrame=Long.MIN_VALUE
    private var requestFrame=Long.MIN_VALUE
    private var frameSerial=0L
    var lastExpanded=0; private set
    var lastPlanNanos=0L; private set
    fun clear() { routes.clear();waiting.clear();requested.clear();window=Long.MIN_VALUE;searchFrame=Long.MIN_VALUE;requestFrame=Long.MIN_VALUE;frameSerial=0;searches=0 }
    fun retain(ids: Set<String>) { routes.keys.retainAll(ids);waiting.retainAll(ids);requested.keys.retainAll(ids) }

    fun next(id: String, from: FootPosition, goal: FootPosition, now: Long,
             canStep: (FootPosition,FootPosition)->Boolean): FootPosition {
        if(requestFrame!=now) { requestFrame=now;frameSerial++ }
        requested[id]=frameSerial
        waiting.removeAll { frameSerial-(requested[it] ?: Long.MIN_VALUE) !in 0..2 }
        if (listOf(from,goal).any { !it.x.isFinite() || !it.y.isFinite() || !it.z.isFinite() }) { waiting.remove(id);routes.remove(id);return from }
        if(distance(from,goal)<.025f) { routes.remove(id);waiting.remove(id);return from }
        if(window==Long.MIN_VALUE || now<window || now-window>=500) { window=now;searches=0 }
        val route=routes[id]
        var usable:FootPosition?=null
        if(route!=null) {
            while(route.points.isNotEmpty() && distance(from,route.points.first())<.025f) route.points.removeFirst()
            val point=route.points.firstOrNull()
            if(point!=null && canStep(from,ahead(from,point,.3f))) usable=point
            if(usable!=null && now-route.created in 0..1500 && distance(route.goal,goal)<=.24f && abs(route.goal.y-goal.y)<=.04f) return usable
            if(point==null && now-route.created<1500) return from
        }
        // Continue a validated old leg while a moving follow goal waits its fair turn.
        // An opposite command must not continue the old movement.
        val fallback=usable?.takeIf { (it.x-from.x)*(goal.x-from.x)+(it.z-from.z)*(goal.z-from.z)>0f }
        waiting.add(id)
        if(searches>=2 || searchFrame==now || waiting.first()!=id) return fallback ?: from
        waiting.remove(id)
        searches++;searchFrame=now
        val started=clock()
        val path=search(from,goal,canStep,started+2_000_000L)
        lastPlanNanos=clock()-started
        routes[id]=Route(goal,now,ArrayDeque(path))
        return path.firstOrNull() ?: from
    }

    private fun search(from: FootPosition, goal: FootPosition, canStep: (FootPosition,FootPosition)->Boolean, deadline:Long): List<FootPosition> {
        lastExpanded=0
        val target=goal.copy(y=from.y)
        if(distance(from,target)<.025f) return emptyList()
        if(distance(from,target)<=4f && canStep(from,target)) return listOf(target)
        val start=Cell(0,0)
        fun point(c: Cell)=FootPosition(from.x+c.x*.16f,from.y,from.z+c.z*.16f)
        fun heuristic(c: Cell)=distance(point(c),target)
        val open=PriorityQueue(compareBy<Entry> { it.score }.thenBy { it.cell.x }.thenBy { it.cell.z })
        val costs=mutableMapOf(start to 0f)
        val parent=mutableMapOf<Cell,Cell>()
        val closed=mutableSetOf<Cell>()
        open.add(Entry(start,0f,heuristic(start)))
        var best=start
        while(open.isNotEmpty() && lastExpanded<256 && clock()<deadline) {
            val current=open.remove()
            if(current.cost>costs.getValue(current.cell)+.0001f || !closed.add(current.cell)) continue
            lastExpanded++
            if(heuristic(current.cell)<heuristic(best)) best=current.cell
            if(heuristic(current.cell)<.20f && canStep(point(current.cell),target)) {
                val path=unwind(current.cell,start,parent,::point)+target
                return smooth(from,path,canStep,deadline)
            }
            for(dx in -1..1) for(dz in -1..1) {
                if(dx==0 && dz==0) continue
                val next=Cell(current.cell.x+dx,current.cell.z+dz)
                if(abs(next.x)>16 || abs(next.z)>16 || next in closed) continue
                val cost=current.cost+if(dx!=0 && dz!=0).226274f else .16f
                if(cost>=(costs[next] ?: Float.POSITIVE_INFINITY)) continue
                if(!canStep(point(current.cell),point(next))) continue
                costs[next]=cost;parent[next]=current.cell
                open.add(Entry(next,cost,cost+heuristic(next)))
            }
        }
        // Walk toward the last reachable frontier when the streamer is beyond the scanned patch.
        // Never claim the destination is reachable or invent support in the gap.
        if(heuristic(start)-heuristic(best)<.25f) return emptyList()
        return smooth(from,unwind(best,start,parent,::point),canStep,deadline)
    }
    private fun unwind(end: Cell, start: Cell, parent: Map<Cell,Cell>, point: (Cell)->FootPosition): List<FootPosition> {
        val result=mutableListOf<FootPosition>();var cell=end
        while(cell!=start) { result+=point(cell);cell=parent[cell] ?: return emptyList() }
        return result.asReversed()
    }
    private fun smooth(from: FootPosition, path: List<FootPosition>, canStep: (FootPosition,FootPosition)->Boolean, deadline:Long): List<FootPosition> {
        val result=mutableListOf<FootPosition>();var at=from;var index=0
        while(index<path.size) {
            if(clock()>=deadline) return result+path.drop(index)
            var next=index
            // Keep smoothing bounded and keep every shortcut collision-checked.
            for(i in index+1..minOf(path.lastIndex,index+12)) {
                if(clock()>=deadline)break
                if(canStep(at,path[i]))next=i
            }
            at=path[next];result+=at;index=next+1
        }
        return result
    }
    private fun distance(a: FootPosition,b: FootPosition)=hypot(a.x-b.x,a.z-b.z)
    private fun ahead(a:FootPosition,b:FootPosition,max:Float):FootPosition {
        val t=(max/distance(a,b).coerceAtLeast(.001f)).coerceAtMost(1f)
        return FootPosition(a.x+(b.x-a.x)*t,a.y,a.z+(b.z-a.z)*t)
    }
}
