package world.raidrift.capture

import kotlin.math.*

/** Observed horizontal support only. Unknown space is never expanded into a floor. */
data class LandingSurface(val id: Int, val y: Float, val polygon: List<PlanePoint>)
enum class Clearance { UNKNOWN, CLEAR, BLOCKED }
data class LandingArea(val surfaceId: Int, val center: FootPosition, val yaw: Float, val depthChecked: Boolean, val score: Float = 0f)

object LandingPlanner {
    const val HALF_WIDTH = .55f
    const val HALF_DEPTH = .42f
    private val footprint = listOf(-HALF_WIDTH, 0f, HALF_WIDTH).flatMap { x -> listOf(-HALF_DEPTH,0f,HALF_DEPTH).map { z -> x to z } }
    fun point(area: LandingArea, x: Float, z: Float, height: Float = 0f): FootPosition {
        val a = Math.toRadians(area.yaw.toDouble()).toFloat()
        return FootPosition(area.center.x + cos(a)*x + sin(a)*z, area.center.y+height, area.center.z-sin(a)*x+cos(a)*z)
    }
    fun evaluate(area: LandingArea, surfaces: List<LandingSurface>, depthRequired: Boolean, clearance: (FootPosition) -> Clearance): LandingArea? {
        val support = surfaces.firstOrNull { it.id == area.surfaceId && abs(it.y-area.center.y) < .04f } ?: return null
        if (!support.y.isFinite() || support.polygon.size !in 3..256 || support.polygon.any { !it.u.isFinite() || !it.v.isFinite() }) return null
        val polygon=PlaneSnapshot(support.y,support.polygon)
        val feet=footprint.map { (x,z) -> point(area,x,z) }
        // ARCore plane polygons are convex: the whole footprint must fit inside its measured boundary.
        if (feet.any { !polygon.contains(it.x,it.z,0f) }) return null
        val overhead=surfaces.filter { it.y > support.y+.08f && it.y < support.y+1.05f }.map { PlaneSnapshot(it.y,it.polygon) }
        if (overhead.any { upper -> feet.any { p -> upper.contains(p.x,p.z,0f) } }) return null
        // Check small objects near all initial hero slots as well as a denser grid across the footprint.
        val grid=(-2..2).flatMap { x -> (-2..2).map { z -> point(area,x*HALF_WIDTH/2f,z*HALF_DEPTH/2f) } }
        val slots=listOf(point(area,-.308f,0f),point(area,0f,.05f),point(area,.308f,.1f))
        val probes=grid+slots+point(area,0f,-.25f,.95f)
        val evidence=probes.map(clearance)
        if (Clearance.BLOCKED in evidence) return null
        val known=evidence.count { it == Clearance.CLEAR }
        val needed=ceil(probes.size*.8f).toInt()
        if (depthRequired && known < needed) return null
        return area.copy(depthChecked=known>=needed)
    }
    fun choose(record: FrameRecord, surfaces: List<LandingSurface>, depthRequired: Boolean): LandingArea? {
        if (surfaces.isEmpty() || record.projection.size != 16) return null
        val camera=record.displayPose
        val candidates=mutableListOf<LandingArea>()
        for (surface in surfaces.take(24)) {
            if (camera.ty-surface.y !in .2f..2.2f) continue
            for (v in listOf(.62f,.76f,.88f)) for (u in listOf(.5f,.35f,.65f)) {
                val direction=GroundRay.cameraDirection(u,v,record.projection)
                val ray=camera.rotate(direction.x,direction.y,direction.z)
                val center=GroundRay.intersect(camera.origin,ray,surface.y,3.5f) ?: continue
                val distance=hypot(center.x-camera.tx,center.z-camera.tz)
                if (distance !in .6f..3.2f) continue
                val yaw=TargetGoal.yaw(camera.tx-center.x,camera.tz-center.z)
                val area=LandingArea(surface.id,center,yaw,false,abs(distance-1.5f)+abs(u-.5f)*2f)
                candidates += area
            }
        }
        return candidates.sortedBy { it.score }.firstNotNullOfOrNull { area ->
            evaluate(area,surfaces,depthRequired) { depthClearance(record,it,abs(it.y-area.center.y)<.025f) }
        }
    }
    /** Project the probe into the SAME sensor pose/intrinsics as the copied depth image. */
    fun depthClearance(record: FrameRecord, point: FootPosition, requireSurface: Boolean = false): Clearance {
        val depth=record.depth ?: return Clearance.UNKNOWN
        val k=record.intrinsics?.takeIf { it.usable } ?: return Clearance.UNKNOWN
        val pose=record.sensorPose
        val inverse=RigidPose(0f,0f,0f,-pose.qx,-pose.qy,-pose.qz,pose.qw)
        val p=inverse.rotate(point.x-pose.tx,point.y-pose.ty,point.z-pose.tz)
        val z=-p.z
        if (z !in .15f..8f) return Clearance.UNKNOWN
        val u=(k.fx*p.x/z+k.cx)/k.width
        val v=(k.fy*-p.y/z+k.cy)/k.height
        val measured=depth.sampleMm(u,v,1)?.div(1000f) ?: return Clearance.UNKNOWN
        val tolerance=.06f+.02f*z
        return when {
            measured<z-tolerance -> Clearance.BLOCKED
            requireSurface && measured>z+tolerance -> Clearance.UNKNOWN
            else -> Clearance.CLEAR
        }
    }
}

/** Debounces scene measurements. Tracking gaps and changing candidates cannot manufacture readiness. */
class LandingStability {
    private var candidate: LandingArea? = null
    private var since = 0L
    private var last = 0L
    private var samples = 0
    fun clear() { candidate=null; samples=0; since=0; last=0 }
    fun update(area: LandingArea?, now: Long, tracked: Boolean): LandingArea? {
        if (!tracked || area == null) { clear(); return null }
        val old=candidate
        if (old == null || now<last || now-last>650 || old.surfaceId!=area.surfaceId || hypot(area.center.x-old.center.x,area.center.z-old.center.z)>.10f || abs(area.center.y-old.center.y)>.025f || abs(((area.yaw-old.yaw)%360f+540f)%360f-180f)>12f) {
            candidate=area; since=now; samples=1
        } else samples++
        last=now
        return area.takeIf { samples>=4 && now-since>=1000 }
    }
}
