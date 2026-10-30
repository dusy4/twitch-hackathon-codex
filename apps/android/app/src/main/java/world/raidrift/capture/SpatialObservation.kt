package world.raidrift.capture

import kotlin.math.abs
import kotlin.math.sqrt
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.cos

/** Integrates camera time across skipped display frames; tracking loss alone resets the baseline. */
class PresentationClock(private val intervalMs: Long = 33) {
    private var timestampNs = 0L
    private var presentedAt = Long.MIN_VALUE
    fun reset() { timestampNs = 0; presentedAt = Long.MIN_VALUE }
    fun sample(frameNs: Long, nowMs: Long, tracking: Boolean): Float? {
        if (!tracking) { reset(); return null }
        if (frameNs <= 0 || frameNs == timestampNs || presentedAt != Long.MIN_VALUE && nowMs - presentedAt < intervalMs) return null
        val delta = if (timestampNs == 0L) 0f else ((frameNs-timestampNs)/1_000_000_000f).coerceIn(0f,1f/15f)
        timestampNs = frameNs; presentedAt = nowMs
        return delta
    }
}

val STATIC_SCENE_LABELS = setOf("chair", "couch", "dining table", "bed", "toilet", "refrigerator", "tv", "potted plant", "bench")

/** Authored Sit_Chair_Idle pelvis offset shared by the four bundled KayKit rigs. */
object SeatContact {
    const val MODEL_SCALE = .30f / 2.19f
    const val PELVIS_Y = .48128262f * MODEL_SCALE
    const val PELVIS_Z = -.39688855f * MODEL_SCALE
    const val CLEARANCE = .012f
    fun root(seat: FootPosition, yawDegrees: Float): FootPosition {
        val a = Math.toRadians(yawDegrees.toDouble()).toFloat()
        return FootPosition(seat.x - sin(a)*PELVIS_Z, seat.y + CLEARANCE - PELVIS_Y, seat.z - cos(a)*PELVIS_Z)
    }
}

/** Aspect-preserving model padding and its exact inverse, independent of display rotation/crop. */
class Letterbox(val width: Int, val height: Int, val size: Int) {
    init { require(width > 0 && height > 0 && size > 0) }
    val scale = min(size.toFloat() / width, size.toFloat() / height)
    val padX = (size - width * scale) / 2f
    val padY = (size - height * scale) / 2f
    fun toSource(left: Float, top: Float, right: Float, bottom: Float): FloatArray? {
        if (!listOf(left,top,right,bottom).all(Float::isFinite)) return null
        val l = ((left-padX)/scale).coerceIn(0f,width.toFloat()); val r = ((right-padX)/scale).coerceIn(0f,width.toFloat())
        val t = ((top-padY)/scale).coerceIn(0f,height.toFloat()); val b = ((bottom-padY)/scale).coerceIn(0f,height.toFloat())
        if (r <= l || b <= t) return null
        return floatArrayOf(l,t,r,b)
    }
}

/** Owned inference context. No ARCore Image, Frame, or ByteBuffer crosses the worker boundary. */
data class ObservationContext(val generation: Int, val cameraTimestampNs: Long, val record: FrameRecord, val poseTracked: Boolean = true)

data class ObjectGeometry(val foot: FootPosition, val supportY: Float?, val source: String, val width: Float, val height: Float)

object SpatialObservation {
    const val MAX_RESULT_AGE_MS = 900L
    fun usable(context: ObservationContext, generation: Int, now: Long): Boolean =
        context.generation == generation && now - context.record.capturedAt in 0..MAX_RESULT_AGE_MS

    /** Sample the object interior, not bbox padding/legs/background. Never infer a seat from bbox height. */
    fun geometry(record: FrameRecord, box: TrackBox): ObjectGeometry? {
        val points = mutableListOf<FootPosition>()
        for (x in floatArrayOf(.35f, .5f, .65f)) for (y in floatArrayOf(.45f, .6f, .75f)) {
            Unproject.viaDepth(record, box.x + box.w * x, box.y + box.h * y)?.let { points += it }
        }
        if (points.size >= 3) {
            val distances = points.map { Unproject.viewDistance(record.displayPose, it) }.sorted()
            val median = distances[distances.size / 2]
            val cluster = points.filter { abs(Unproject.viewDistance(record.displayPose, it) - median) < .25f }
            if (cluster.size >= 3) {
                val center = FootPosition(cluster.map { it.x }.average().toFloat(), cluster.map { it.y }.average().toFloat(), cluster.map { it.z }.average().toFloat())
                val support = record.planes.filter { it.y <= center.y + .04f && it.contains(center.x, center.z, .12f) }.maxOfOrNull { it.y }
                val floor = support ?: record.planes.minOfOrNull { it.y }?.takeIf { it < center.y }
                if (floor != null) {
                    val (w, h) = Unproject.metricSize(box, median, record.projection)
                    // A support plane actually seen inside the object can be used as a perch. A bbox cannot.
                    val perch = record.planes.filter { it.y > floor + .08f && it.y <= center.y + .15f && it.contains(center.x, center.z, .02f) }.maxOfOrNull { it.y }
                    return ObjectGeometry(FootPosition(center.x, floor, center.z), perch, "depth", w, h)
                }
            }
        }
        val foot = Unproject.viaPlanes(record, box.centerX, box.bottom.coerceIn(0f, .995f)) ?: return null
        val (w, h) = Unproject.metricSize(box, Unproject.viewDistance(record.displayPose, foot), record.projection)
        return ObjectGeometry(foot, null, "plane", w, h)
    }

    fun distance(a: FootPosition, b: FootPosition): Float = sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z))
}
