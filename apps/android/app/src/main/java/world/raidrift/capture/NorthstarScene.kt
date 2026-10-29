package world.raidrift.capture

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import com.google.ar.core.DepthPoint
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.TrackingState
import io.github.sceneview.SceneScope
import io.github.sceneview.math.Position
import io.github.sceneview.math.Rotation
import io.github.sceneview.math.Size
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** Render pose for one hero, in anchor-local coordinates. */
data class HeroPose(val position: Position, val yaw: Float, val clip: String)

data class Located(val foot: FootPosition, val topY: Float?, val source: String)

/** A raid portal in ARCore world coordinates. [foot] is the ground point heroes walk out from. */
data class PortalWorld(val raidId: String, val banner: String, val center: FootPosition, val foot: FootPosition, val yaw: Float, val createdAt: Long)

data class ConfettiBurst(val id: String, val origin: FootPosition, val startedAt: Long)

/** Frame-to-frame scratch state that must not trigger recomposition. */
class NorthstarRuntime {
    val tracker = ObjectTracker()
    val space = TrackSpace()
    val motorLift = mutableMapOf<String, Float>()
    val previousFeet = mutableMapOf<String, FootPosition>()
    val spawned = mutableSetOf<String>()
    val sources = mutableMapOf<String, String>()
    var seenRaid: String? = UNSET
    val seenProps = mutableSetOf<String>()
    var bursts = listOf<ConfettiBurst>()
    var portal: PortalWorld? = null
    var lastDetectSubmit = 0L
    var lastTracksPost = 0L
    var lastPlaneCount = 0
    var fpsFrames = 0
    var fpsSince = 0L
    fun reset() { tracker.clear(); space.clear(); motorLift.clear(); previousFeet.clear(); sources.clear() }
    companion object { const val UNSET = "\u0000unset" }
}

/** Lowest tracked upward plane height, used as the ground for fallbacks. */
internal fun lowestGround(planes: List<Plane>): Float? =
    planes.filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
        .minOfOrNull { it.centerPose.ty() }

/**
 * 3D foot point for a view-normalized ground-contact point: plane hit, then depth/feature
 * point, then a ray onto the lowest known floor (or 1.4 m below the camera).
 */
internal fun locateTrack(frame: Frame, planes: List<Plane>, box: TrackBox, viewW: Int, viewH: Int): Located? {
    if (viewW <= 0 || viewH <= 0) return null
    val u = box.centerX.coerceIn(0f, 1f); val v = box.bottom.coerceIn(0f, 0.995f)
    val hits = runCatching { frame.hitTest(u * viewW, v * viewH) }.getOrDefault(emptyList())
    val planeHit = hits.firstOrNull { hit ->
        val plane = hit.trackable as? Plane
        plane != null && plane.trackingState == TrackingState.TRACKING && plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING && plane.isPoseInPolygon(hit.hitPose)
    }
    val depthHit = if (planeHit == null) hits.firstOrNull { (it.trackable is DepthPoint || it.trackable is Point) && it.distance < 10f } else null
    val camera = frame.camera.displayOrientedPose
    val projection = FloatArray(16).also { frame.camera.getProjectionMatrix(it, 0, 0.05f, 50f) }
    val (foot, source) = (planeHit ?: depthHit)?.let { hit ->
        val t = hit.hitPose.translation
        FootPosition(t[0], t[1], t[2]) to if (hit === planeHit) "plane" else "depth"
    } ?: run {
        val dirCam = GroundRay.cameraDirection(u, v, projection)
        val d = camera.rotateVector(floatArrayOf(dirCam.x, dirCam.y, dirCam.z))
        val groundY = lowestGround(planes) ?: (camera.ty() - 1.4f)
        GroundRay.intersect(FootPosition(camera.tx(), camera.ty(), camera.tz()), FootPosition(d[0], d[1], d[2]), groundY)?.let { it to "ray" }
    } ?: return null
    // Camera forward is -Z of the display-oriented pose.
    val z = camera.zAxis
    val depth = -((foot.x - camera.tx()) * z[0] + (foot.y - camera.ty()) * z[1] + (foot.z - camera.tz()) * z[2])
    val height = GroundRay.objectHeight(box.h, depth, projection[5]).coerceIn(0f, 1.2f)
    val topY = if (height > 0.08f) foot.y + height * 0.8f else null
    return Located(foot, topY, source)
}

/** Portal ~2.5 m ahead on the ground, or on a wall hit at screen centre. */
internal fun placePortal(frame: Frame, planes: List<Plane>, viewW: Int, viewH: Int, raid: Raid, now: Long): PortalWorld {
    val banner = "RAID${if (raid.from.isNotBlank()) " FROM ${raid.from.uppercase()}" else ""} · ${raid.count}"
    val camera = frame.camera.pose
    val camZ = camera.zAxis
    val groundY = lowestGround(planes) ?: (camera.ty() - 1.4f)
    if (viewW > 0 && viewH > 0) {
        val wall = runCatching { frame.hitTest(viewW / 2f, viewH / 2f) }.getOrDefault(emptyList()).firstOrNull { hit ->
            val plane = hit.trackable as? Plane
            plane != null && plane.type == Plane.Type.VERTICAL && plane.trackingState == TrackingState.TRACKING && plane.isPoseInPolygon(hit.hitPose) && hit.distance in 0.5f..6f
        }
        if (wall != null) {
            val t = wall.hitPose.translation
            val n = wall.hitPose.yAxis
            val nl = hypot(n[0], n[2]).takeIf { it > 0.2f } ?: 1f
            val nx = n[0] / nl; val nz = n[2] / nl
            val centerY = maxOf(t[1], groundY + 0.5f)
            return PortalWorld(raid.id, banner, FootPosition(t[0] + nx * 0.03f, centerY, t[2] + nz * 0.03f),
                FootPosition(t[0] + nx * 0.35f, groundY, t[2] + nz * 0.35f), TargetGoal.yaw(nx, nz), now)
        }
    }
    val len = hypot(camZ[0], camZ[2])
    val (fx, fz) = if (len < 0.2f) 0f to -1f else -camZ[0] / len to -camZ[2] / len
    val cx = camera.tx() + fx * 2.5f; val cz = camera.tz() + fz * 2.5f
    val local = planes.filter { it.trackingState == TrackingState.TRACKING && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING && it.centerPose.ty() < camera.ty() - 0.3f }
        .filter { runCatching { it.isPoseInPolygon(com.google.ar.core.Pose.makeTranslation(cx, it.centerPose.ty(), cz)) }.getOrDefault(false) }
        .minOfOrNull { it.centerPose.ty() } ?: groundY
    return PortalWorld(raid.id, banner, FootPosition(cx, local + 0.5f, cz), FootPosition(cx - fx * 0.3f, local, cz - fz * 0.3f), TargetGoal.yaw(-fx, -fz), now)
}

private val CONFETTI_COLORS = listOf(Color(0xffff5a5a), Color(0xffffd23f), Color(0xff4fd1ff), Color(0xff8affa5), Color(0xffd08aff))

/** World-space portal ring + banner and confetti. Cheap primitives only. */
@Composable
internal fun SceneScope.NorthstarProps(portal: PortalWorld?, bursts: List<ConfettiBurst>, clock: Long, cameraPosition: () -> Position) {
    val ringMaterial = remember(materialLoader) { materialLoader.createColorInstance(Color(0xffb38cff), metallic = 0f, roughness = 0.2f, reflectance = 0.9f) }
    val innerMaterial = remember(materialLoader) { materialLoader.createColorInstance(Color(0x9966e0ff)) }
    val confetti = remember(materialLoader) { CONFETTI_COLORS.map { materialLoader.createColorInstance(it) } }
    portal?.let { p ->
        val age = (clock - p.createdAt).coerceAtLeast(0L) / 1000f
        val grow = (age / 0.6f).coerceIn(0.05f, 1f)
        val pulse = 1f + 0.06f * sin(age * 6f)
        key(p.raidId) {
            Node(position = Position(p.center.x, p.center.y, p.center.z), rotation = Rotation(0f, p.yaw, 0f)) {
                TorusNode(majorRadius = 0.45f, minorRadius = 0.045f, majorSegments = 40, minorSegments = 10, materialInstance = ringMaterial,
                    rotation = Rotation(90f, 0f, 0f), scale = io.github.sceneview.math.Scale(grow * pulse))
                TorusNode(majorRadius = 0.3f, minorRadius = 0.02f, majorSegments = 32, minorSegments = 8, materialInstance = innerMaterial,
                    rotation = Rotation(90f, age * 120f, 0f), scale = io.github.sceneview.math.Scale(grow))
                TextNode(text = p.banner, position = Position(0f, 0.65f, 0f), widthMeters = 1.1f, heightMeters = 0.13f, cameraPositionProvider = cameraPosition)
            }
        }
    }
    bursts.forEach { burst -> key(burst.id) {
        val t = ((clock - burst.startedAt).coerceAtLeast(0L)) / 1000f
        if (t <= 2f) repeat(24) { i ->
            val angle = i * 2.3999f
            val speed = 0.6f + (i % 5) * 0.12f
            val up = 1.6f + (i % 3) * 0.4f
            val x = burst.origin.x + cos(angle) * speed * t
            val z = burst.origin.z + sin(angle) * speed * t
            val y = burst.origin.y + up * t - 4.9f * t * t * 0.5f
            CubeNode(size = Size(0.035f), materialInstance = confetti[i % confetti.size], position = Position(x, y, z), rotation = Rotation(t * 400f + i * 30f, t * 300f, 0f))
        }
    } }
}
