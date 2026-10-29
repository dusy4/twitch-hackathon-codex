package world.raidrift.capture

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import com.google.ar.core.Anchor
import com.google.ar.core.Coordinates2d
import com.google.ar.core.DepthPoint
import com.google.ar.core.Frame
import com.google.ar.core.HitResult
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Pose
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import io.github.sceneview.SceneScope
import io.github.sceneview.ar.arcore.hitTestDepth
import io.github.sceneview.math.Position
import io.github.sceneview.math.Rotation
import io.github.sceneview.math.Size
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Render pose for one hero, in anchor-local coordinates. [shadow] is where its contact shadow
 * sits (support under the feet, or the feet when it rests on an object) and [airborne] how far
 * above that support the feet are.
 */
data class HeroPose(val position: Position, val yaw: Float, val clip: String, val shadow: Position = position, val airborne: Float = 0f)

data class Located(val foot: FootPosition, val topY: Float?, val source: String)

/**
 * A raid portal in ARCore world coordinates. [foot] is the ground point heroes walk out from;
 * when [footKnown] is false no plane/depth ground was measured and nobody spawns from it.
 */
data class PortalWorld(val raidId: String, val banner: String, val center: FootPosition, val foot: FootPosition, val yaw: Float, val createdAt: Long, val footKnown: Boolean = true)

data class ConfettiBurst(val id: String, val origin: FootPosition, val startedAt: Long)

enum class LightMode(val label: String) { HDR("Environmental HDR"), AMBIENT("Ambient intensity") }
enum class ShadowMode(val label: String, val blob: Boolean, val real: Boolean) {
    BLOB("blob", true, false), REAL("real (light-estimated)", false, true), BOTH("real + blob", true, true), OFF("off", false, false)
}

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
    var lastFrameUpload = 0L
    var frameCounter = 0
    var lastPlaneCount = 0
    var fpsFrames = 0
    var fpsSince = 0L
    /** Uploaded frames that server-detected boxes can be unprojected against. */
    val frames = FrameRing(12)
    /** ARCore anchors for stable phone-detected objects (track id -> anchor). */
    val objectAnchors = mutableMapOf<String, Anchor>()
    val serverTracks = ServerTrackRegistry<Anchor>()
    /** Last projected view box per server track, re-posted while the anchor is off-screen or tracking pauses. */
    val serverBoxes = mutableMapOf<String, TrackBox>()

    fun dropObjectAnchor(id: String) { objectAnchors.remove(id)?.let { runCatching { it.detach() } } }

    fun reset() {
        tracker.clear(); space.clear(); motorLift.clear(); previousFeet.clear(); sources.clear(); frames.clear()
        objectAnchors.values.forEach { runCatching { it.detach() } }; objectAnchors.clear()
        serverTracks.clear().forEach { runCatching { it.anchor.detach() } }; serverBoxes.clear()
    }
    companion object { const val UNSET = "\u0000unset" }
}

/** Lowest tracked upward plane height, used as the ground for fallbacks. */
internal fun lowestGround(planes: List<Plane>): Float? =
    planes.filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
        .minOfOrNull { it.centerPose.ty() }

/**
 * Height of the room floor: the lowest tracked upward plane at least 0.5 m below the camera.
 * ARCore's floor polygon starts as a small patch of dots; past its edge the floor is treated as
 * continuing at this height (ARKit's "existingPlaneInfinite"), so characters don't vanish there.
 */
internal fun mainFloorY(planes: List<Plane>, cameraY: Float): Float? = lowestGround(planes)?.takeIf { it < cameraY - 0.5f }

/** View pixel (x, y) projected onto the infinite floor at [floorY], within 6 m of the camera. */
internal fun infiniteFloorPoint(frame: Frame, floorY: Float, x: Float, y: Float, viewW: Int, viewH: Int): FootPosition? {
    if (viewW <= 0 || viewH <= 0) return null
    val camera = frame.camera.displayOrientedPose
    val projection = FloatArray(16).also { frame.camera.getProjectionMatrix(it, 0, 0.05f, 50f) }
    val dirCam = GroundRay.cameraDirection(x / viewW, y / viewH, projection)
    val d = camera.rotateVector(floatArrayOf(dirCam.x, dirCam.y, dirCam.z))
    return GroundRay.intersect(FootPosition(camera.tx(), camera.ty(), camera.tz()), FootPosition(d[0], d[1], d[2]), floorY, 6f)
}

private fun isFloorPlaneHit(hit: HitResult): Boolean {
    val plane = hit.trackable as? Plane ?: return false
    return plane.trackingState == TrackingState.TRACKING && plane.subsumedBy == null && plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING && plane.isPoseInPolygon(hit.hitPose)
}

/** A depth/feature-point hit whose estimated surface normal points up (desk, floor, seat). */
private fun isUpwardSurfaceHit(hit: HitResult): Boolean {
    val trackable = hit.trackable
    val oriented = trackable is DepthPoint || trackable is Point && trackable.orientationMode == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL
    return oriented && hit.distance in 0.1f..8f && hit.hitPose.yAxis[1] > 0.85f
}

/** Where a character can stand at view pixel (x, y): a tracked floor/desk plane, then an upward depth point. */
internal fun groundHit(frame: Frame, x: Float, y: Float): HitResult? {
    val hits = runCatching { frame.hitTest(x, y) }.getOrDefault(emptyList())
    return hits.firstOrNull(::isFloorPlaneHit) ?: hits.firstOrNull(::isUpwardSurfaceHit)
}

/**
 * Creates the room anchor for a ground hit. Plane hits attach to the plane (refined with it);
 * depth hits get a gravity-aligned world anchor so characters never stand tilted on a noisy normal.
 */
internal fun anchorGround(session: Session, hit: HitResult): Anchor =
    if (hit.trackable is Plane) hit.createAnchor() else session.createAnchor(Pose.makeTranslation(hit.hitPose.translation))

/**
 * 3D foot point for a view-normalized ground-contact point: plane hit, then ARCore depth/feature
 * point, then SceneView's depth-image raycast, then a ray onto the lowest tracked floor plane.
 * Returns null when nothing was measured — never a guessed floor height.
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
    } ?: runCatching { frame.hitTestDepth(u * viewW, v * viewH) }.getOrNull()?.takeIf { it.distance in 0.1f..8f }?.let {
        FootPosition(it.position.x, it.position.y, it.position.z) to "depth"
    } ?: run {
        val groundY = lowestGround(planes) ?: return null
        val dirCam = GroundRay.cameraDirection(u, v, projection)
        val d = camera.rotateVector(floatArrayOf(dirCam.x, dirCam.y, dirCam.z))
        GroundRay.intersect(FootPosition(camera.tx(), camera.ty(), camera.tz()), FootPosition(d[0], d[1], d[2]), groundY)?.let { it to "ray" }
    } ?: return null
    // Camera forward is -Z of the display-oriented pose.
    val z = camera.zAxis
    val depth = -((foot.x - camera.tx()) * z[0] + (foot.y - camera.ty()) * z[1] + (foot.z - camera.tz()) * z[2])
    val height = GroundRay.objectHeight(box.h, depth, projection[5]).coerceIn(0f, 1.2f)
    val topY = if (height > 0.08f) foot.y + height * 0.8f else null
    return Located(foot, topY, source)
}

/**
 * Portal ~2.5 m ahead on the ground, or on a wall hit at screen centre. Ground comes from tracked
 * planes, else a depth hit low in the view; without either the portal floats and nobody spawns from it.
 */
internal fun placePortal(frame: Frame, planes: List<Plane>, viewW: Int, viewH: Int, raid: Raid, now: Long): PortalWorld {
    val banner = "RAID${if (raid.from.isNotBlank()) " FROM ${raid.from.uppercase()}" else ""} · ${raid.count}"
    val camera = frame.camera.pose
    val camZ = camera.zAxis
    val measuredGround = lowestGround(planes) ?: if (viewW > 0 && viewH > 0) runCatching { frame.hitTestDepth(viewW / 2f, viewH * 0.85f) }.getOrNull()
        ?.position?.y?.takeIf { it < camera.ty() - 0.3f } else null
    val groundY = measuredGround ?: (camera.ty() - 0.8f)
    val known = measuredGround != null
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
                FootPosition(t[0] + nx * 0.35f, groundY, t[2] + nz * 0.35f), TargetGoal.yaw(nx, nz), now, known)
        }
    }
    val len = hypot(camZ[0], camZ[2])
    val (fx, fz) = if (len < 0.2f) 0f to -1f else -camZ[0] / len to -camZ[2] / len
    val cx = camera.tx() + fx * 2.5f; val cz = camera.tz() + fz * 2.5f
    val local = planes.filter { it.trackingState == TrackingState.TRACKING && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING && it.centerPose.ty() < camera.ty() - 0.3f }
        .filter { runCatching { it.isPoseInPolygon(com.google.ar.core.Pose.makeTranslation(cx, it.centerPose.ty(), cz)) }.getOrDefault(false) }
        .minOfOrNull { it.centerPose.ty() } ?: groundY
    return PortalWorld(raid.id, banner, FootPosition(cx, local + 0.5f, cz), FootPosition(cx - fx * 0.3f, local, cz - fz * 0.3f), TargetGoal.yaw(-fx, -fz), now, known)
}

private fun Pose.rigid() = RigidPose(tx(), ty(), tz(), qx(), qy(), qz(), qw())

/**
 * Snapshot of everything needed to unproject a point of this frame later (see [Unproject]):
 * poses, display projection, VIEW_NORMALIZED -> TEXTURE_NORMALIZED map, texture intrinsics,
 * a downsampled ARCore depth image (when available) and the tracked upward planes.
 */
internal fun captureFrameRecord(frame: Frame, frameId: String, now: Long, planes: List<Plane>): FrameRecord {
    val camera = frame.camera
    val projection = FloatArray(16).also { camera.getProjectionMatrix(it, 0, 0.05f, 50f) }
    val corners = FloatArray(6)
    frame.transformCoordinates2d(Coordinates2d.VIEW_NORMALIZED, floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f), Coordinates2d.TEXTURE_NORMALIZED, corners)
    val intrinsics = runCatching {
        val k = camera.textureIntrinsics
        val f = k.focalLength; val c = k.principalPoint; val d = k.imageDimensions
        Intrinsics(f[0], f[1], c[0], c[1], d[0], d[1])
    }.getOrNull()
    val depth = runCatching {
        frame.acquireDepthImage16Bits().use { image ->
            val plane = image.planes[0]
            val buffer = plane.buffer.duplicate(); buffer.rewind()
            val bytes = ByteArray(buffer.remaining()); buffer.get(bytes)
            DepthSnapshot.fromPlane(bytes, image.width, image.height, plane.rowStride, if (image.width > 200) 2 else 1)
        }
    }.getOrNull()
    val snapshots = planes.filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
        .take(16).mapNotNull { plane ->
            runCatching {
                val polygon = plane.polygon.duplicate(); polygon.rewind()
                val pose = plane.centerPose
                val points = mutableListOf<PlanePoint>()
                while (polygon.remaining() >= 2 && points.size < 64) {
                    val world = pose.transformPoint(floatArrayOf(polygon.get(), 0f, polygon.get()))
                    points += PlanePoint(world[0], world[2])
                }
                PlaneSnapshot(pose.ty(), points)
            }.getOrNull()
        }
    return FrameRecord(frameId, now, camera.pose.rigid(), camera.displayOrientedPose.rigid(), projection,
        Affine2.fromCorners(corners), intrinsics, depth, snapshots)
}

/** World foot point of an ARCore pose. */
internal fun Pose.foot() = FootPosition(tx(), ty(), tz())

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
