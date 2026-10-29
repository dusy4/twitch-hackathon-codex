package world.raidrift.capture

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * Pure (JVM-testable) logic for server-side open-vocabulary detection:
 * uploaded camera frames are remembered locally (pose, intrinsics, depth, planes) so a box the
 * server finds later in that frame can be unprojected into ARCore world space and anchored.
 * No Android/ARCore types here; MainActivity copies ARCore values into these structures.
 */

/** Rigid transform (ARCore Pose values): translation + unit quaternion (x, y, z, w). */
data class RigidPose(val tx: Float, val ty: Float, val tz: Float, val qx: Float = 0f, val qy: Float = 0f, val qz: Float = 0f, val qw: Float = 1f) {
    fun rotate(x: Float, y: Float, z: Float): FootPosition {
        // v' = v + 2w(q × v) + 2 q × (q × v)
        val cx = qy * z - qz * y; val cy = qz * x - qx * z; val cz = qx * y - qy * x
        val ccx = qy * cz - qz * cy; val ccy = qz * cx - qx * cz; val ccz = qx * cy - qy * cx
        return FootPosition(x + 2f * (qw * cx + ccx), y + 2f * (qw * cy + ccy), z + 2f * (qw * cz + ccz))
    }
    fun transformPoint(x: Float, y: Float, z: Float): FootPosition = rotate(x, y, z).let { FootPosition(it.x + tx, it.y + ty, it.z + tz) }
    val origin get() = FootPosition(tx, ty, tz)
}

/** 2D affine map defined by where (0,0), (1,0) and (0,1) land. */
data class Affine2(val ox: Float, val oy: Float, val ux: Float, val uy: Float, val vx: Float, val vy: Float) {
    fun map(u: Float, v: Float): Pair<Float, Float> = (ox + u * ux + v * vx) to (oy + u * uy + v * vy)
    companion object {
        val IDENTITY = Affine2(0f, 0f, 1f, 0f, 0f, 1f)
        /** [corners] = x00, y00, x10, y10, x01, y01 as returned by transformCoordinates2d. */
        fun fromCorners(corners: FloatArray): Affine2 {
            require(corners.size >= 6 && corners.take(6).all(Float::isFinite))
            return Affine2(corners[0], corners[1], corners[2] - corners[0], corners[3] - corners[1], corners[4] - corners[0], corners[5] - corners[1])
        }
    }
}

/** Camera texture intrinsics, in texture pixels (origin top-left). */
data class Intrinsics(val fx: Float, val fy: Float, val cx: Float, val cy: Float, val width: Int, val height: Int) {
    val usable get() = fx > 0f && fy > 0f && width > 0 && height > 0 && listOf(fx, fy, cx, cy).all(Float::isFinite)
}

/** Depth in millimetres (0 = no data), row-major, aligned with the camera texture. */
class DepthSnapshot(val width: Int, val height: Int, val mm: ShortArray) {
    init { require(width > 0 && height > 0 && mm.size == width * height) }
    fun at(x: Int, y: Int): Int = mm[y * width + x].toInt() and 0xffff

    /** Median of valid samples in a (2r+1)² window around texture-normalized (u, v). */
    fun sampleMm(u: Float, v: Float, radius: Int = 2): Int? {
        if (!u.isFinite() || !v.isFinite() || u !in 0f..1f || v !in 0f..1f) return null
        val px = (u * width).toInt().coerceIn(0, width - 1); val py = (v * height).toInt().coerceIn(0, height - 1)
        val values = ArrayList<Int>((2 * radius + 1) * (2 * radius + 1))
        for (y in max(0, py - radius)..min(height - 1, py + radius)) for (x in max(0, px - radius)..min(width - 1, px + radius)) {
            val d = at(x, y); if (d in 1..65000) values += d
        }
        if (values.isEmpty()) return null
        values.sort(); return values[values.size / 2]
    }

    companion object {
        /**
         * Copies an ARCore DEPTH16 plane (little-endian, [rowStrideBytes] per row), keeping every
         * [step]-th sample. ARCore's 16-bit depth stores millimetres directly.
         */
        fun fromPlane(bytes: ByteArray, width: Int, height: Int, rowStrideBytes: Int, step: Int): DepthSnapshot {
            require(step >= 1 && width > 0 && height > 0 && rowStrideBytes >= width * 2)
            val w = width / step; val h = height / step
            require(w > 0 && h > 0)
            val out = ShortArray(w * h)
            for (y in 0 until h) for (x in 0 until w) {
                val i = (y * step) * rowStrideBytes + (x * step) * 2
                if (i + 1 < bytes.size) out[y * w + x] = ((bytes[i].toInt() and 0xff) or ((bytes[i + 1].toInt() and 0xff) shl 8)).toShort()
            }
            return DepthSnapshot(w, h, out)
        }
    }
}

/** A tracked upward plane in world space: its height and polygon (world x, z). */
data class PlaneSnapshot(val y: Float, val polygon: List<PlanePoint>) {
    /** Even-odd test with a small padding margin. [PlanePoint.u] = world x, [PlanePoint.v] = world z. */
    fun contains(x: Float, z: Float, padding: Float = 0.05f): Boolean {
        if (polygon.size < 3) return false
        var inside = false
        var previous = polygon.last()
        for (vertex in polygon) {
            val du = vertex.u - previous.u; val dv = vertex.v - previous.v
            val lengthSquared = du * du + dv * dv
            val f = if (lengthSquared > 0f) (((x - previous.u) * du + (z - previous.v) * dv) / lengthSquared).coerceIn(0f, 1f) else 0f
            val ex = x - previous.u - f * du; val ez = z - previous.v - f * dv
            if (ex * ex + ez * ez <= padding * padding) return true
            if ((vertex.v > z) != (previous.v > z) && x < (previous.u - vertex.u) * (z - vertex.v) / (previous.v - vertex.v) + vertex.u) inside = !inside
            previous = vertex
        }
        return inside
    }
}

/**
 * Everything needed to unproject a VIEW_NORMALIZED point of an uploaded frame later.
 * [sensorPose] = Camera.getPose (texture/sensor orientation, pairs with [intrinsics]);
 * [displayPose] + [projection] = Camera.getDisplayOrientedPose / getProjectionMatrix (view space).
 */
class FrameRecord(
    val frameId: String, val capturedAt: Long,
    val sensorPose: RigidPose, val displayPose: RigidPose, val projection: FloatArray,
    val viewToTexture: Affine2, val intrinsics: Intrinsics?, val depth: DepthSnapshot?,
    val planes: List<PlaneSnapshot>
) {
    init { require(projection.size == 16) }
}

/** Ring buffer of the last [capacity] uploaded frames. */
class FrameRing(private val capacity: Int = 12) {
    private val records = ArrayDeque<FrameRecord>()
    init { require(capacity >= 1) }
    @Synchronized fun put(record: FrameRecord) {
        records.removeAll { it.frameId == record.frameId }
        records.addLast(record)
        while (records.size > capacity) records.removeFirst()
    }
    @Synchronized operator fun get(frameId: String): FrameRecord? = records.lastOrNull { it.frameId == frameId }
    @Synchronized fun ids(): List<String> = records.map { it.frameId }
    val size @Synchronized get() = records.size
    @Synchronized fun clear() = records.clear()
}

data class Unprojected(val foot: FootPosition, val source: String, val distance: Float)

object Unproject {
    /** World point under view point (u, v) from the stored depth image, or null. */
    fun viaDepth(r: FrameRecord, u: Float, v: Float): FootPosition? {
        val depth = r.depth ?: return null
        val k = r.intrinsics?.takeIf { it.usable } ?: return null
        val (tu, tv) = r.viewToTexture.map(u, v)
        val mm = depth.sampleMm(tu, tv) ?: return null
        val d = mm / 1000f
        if (d !in 0.1f..8f) return null
        val px = tu * k.width; val py = tv * k.height
        // ARCore camera space: +X right, +Y up, looking down -Z; texture rows grow downward.
        return r.sensorPose.transformPoint((px - k.cx) / k.fx * d, -(py - k.cy) / k.fy * d, -d)
    }

    /** View ray of (u, v) in world space: origin + direction. */
    fun ray(r: FrameRecord, u: Float, v: Float): Pair<FootPosition, FootPosition> {
        val dir = GroundRay.cameraDirection(u, v, r.projection)
        return r.displayPose.origin to r.displayPose.rotate(dir.x, dir.y, dir.z)
    }

    /** Intersects the stored view ray with the stored upward planes: nearest containing plane, else the lowest plane. */
    fun viaPlanes(r: FrameRecord, u: Float, v: Float): FootPosition? {
        if (r.planes.isEmpty()) return null
        val (origin, direction) = ray(r, u, v)
        val hits = r.planes.filter { it.y < origin.y - 0.05f }.mapNotNull { plane ->
            GroundRay.intersect(origin, direction, plane.y)?.let { plane to it }
        }
        hits.filter { (plane, p) -> plane.contains(p.x, p.z) }
            .minByOrNull { (_, p) -> hypot(p.x - origin.x, p.z - origin.z) }?.let { return it.second }
        return hits.minByOrNull { (plane, _) -> plane.y }?.second
    }

    fun locate(r: FrameRecord, u: Float, v: Float): Unprojected? {
        val (foot, source) = viaDepth(r, u, v)?.let { it to "depth" } ?: viaPlanes(r, u, v)?.let { it to "plane" } ?: return null
        return Unprojected(foot, source, viewDistance(r.displayPose, foot))
    }

    /** Distance along the display camera's forward axis (-Z). */
    fun viewDistance(pose: RigidPose, p: FootPosition): Float {
        val z = pose.rotate(0f, 0f, 1f)
        return -((p.x - pose.tx) * z.x + (p.y - pose.ty) * z.y + (p.z - pose.tz) * z.z)
    }

    /** Metric width/height of a normalized view box seen at [distance] metres. */
    fun metricSize(box: TrackBox, distance: Float, projection: FloatArray): Pair<Float, Float> =
        if (distance <= 0f || projection[0] <= 0f || projection[5] <= 0f) 0f to 0f
        else (box.w * 2f * distance / projection[0]).coerceIn(0.02f, 3f) to (box.h * 2f * distance / projection[5]).coerceIn(0.02f, 3f)
}

object Projection {
    /** Column-major [view] then [projection]: world point -> (u, v) VIEW_NORMALIZED + view depth, or null when behind. */
    fun toView(p: FootPosition, view: FloatArray, projection: FloatArray): Triple<Float, Float, Float>? {
        require(view.size == 16 && projection.size == 16)
        fun mul(m: FloatArray, x: Float, y: Float, z: Float, w: Float) = floatArrayOf(
            m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
            m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w)
        val e = mul(view, p.x, p.y, p.z, 1f)
        val c = mul(projection, e[0], e[1], e[2], e[3])
        if (c[3] <= 1e-4f) return null
        val u = (c[0] / c[3] + 1f) / 2f; val v = (1f - c[1] / c[3]) / 2f
        return if (u.isFinite() && v.isFinite()) Triple(u, v, c[3]) else null
    }

    /** Current view box for an object whose ground contact is [foot] and metric size [w]x[h]; clamped inside the view. */
    fun box(foot: FootPosition, w: Float, h: Float, view: FloatArray, projection: FloatArray): TrackBox? {
        val (u, v, depth) = toView(foot, view, projection) ?: return null
        val bw = (w * projection[0] / depth / 2f).coerceIn(0.01f, 1f)
        val bh = (h * projection[5] / depth / 2f).coerceIn(0.01f, 1f)
        val x = (u - bw / 2f).coerceIn(0f, 1f - 0.01f); val y = (v - bh).coerceIn(0f, 1f - 0.01f)
        return TrackBox(x, y, min(bw, 1f - x), min(bh, 1f - y))
    }
}

/** POST v1/native/frame body. */
fun framePayload(frameId: String, jpegBase64: String, width: Int, height: Int): JSONObject {
    require(frameId.length in 1..80 && jpegBase64.isNotEmpty() && width > 0 && height > 0)
    return JSONObject().put("frameId", frameId).put("jpeg", jpegBase64).put("width", width).put("height", height)
}

/** DBG quest row body: `{type:"quest", action, targetClass, minPlayers}`. */
fun questPayload(action: String, targetText: String, minPlayers: Int = 2): JSONObject {
    val target = targetText.trim().lowercase(java.util.Locale.ROOT).replace(Regex("\\s+"), " ").take(40)
    require(target.isNotEmpty()) { "Enter an object" }
    require(action in QUEST_ACTIONS)
    return JSONObject().put("type", "quest").put("action", action).put("targetClass", target).put("minPlayers", minPlayers.coerceIn(1, 12))
}
val QUEST_ACTIONS = listOf("sit", "dance", "wave", "cheer")

/**
 * The crop of the upright (display-rotated) CPU image that is visible in the view, in upright
 * pixels: (left, top, width, height). [mapping] maps CPU image pixels to VIEW_NORMALIZED.
 */
fun visibleUprightCrop(mapping: ImageToView): IntArray {
    val rotation = mapping.rotation
    val (uw, uh) = if (rotation == 90 || rotation == 270) mapping.height to mapping.width else mapping.width to mapping.height
    fun view(ux: Float, uy: Float): FloatArray {
        val (ix, iy) = ImageToView.uprightToImage(ux, uy, rotation, mapping.width, mapping.height)
        return mapping.map(ix, iy)
    }
    // Upright -> view is axis-aligned scale + offset per axis.
    val o = view(0f, 0f); val ex = view(uw.toFloat(), 0f); val ey = view(0f, uh.toFloat())
    val sx = (ex[0] - o[0]) / uw; val sy = (ey[1] - o[1]) / uh
    if (abs(sx) < 1e-9f || abs(sy) < 1e-9f) return intArrayOf(0, 0, uw, uh)
    val x0 = (0f - o[0]) / sx; val x1 = (1f - o[0]) / sx
    val y0 = (0f - o[1]) / sy; val y1 = (1f - o[1]) / sy
    val left = min(x0, x1).roundToInt().coerceIn(0, uw - 1); val right = max(x0, x1).roundToInt().coerceIn(left + 1, uw)
    val top = min(y0, y1).roundToInt().coerceIn(0, uh - 1); val bottom = max(y0, y1).roundToInt().coerceIn(top + 1, uh)
    return intArrayOf(left, top, right - left, bottom - top)
}

/** Server-detected (open-vocabulary) tracks this phone has anchored, keyed by track id. [A] is the anchor handle. */
class ServerTrackRegistry<A : Any>(private val absentMs: Long = 4000) {
    class Entry<A>(val id: String, val label: String, val frameId: String, val anchor: A, val metricW: Float, val metricH: Float,
                   var confidence: Float, var lastListed: Long, val source: String)
    private val entries = linkedMapOf<String, Entry<A>>()
    private val attempted = mutableMapOf<String, String>() // id -> frameId tried
    val unresolved = linkedMapOf<String, String>()          // id -> reason
    var received = 0; private set

    fun entries(): Collection<Entry<A>> = entries.values
    operator fun get(id: String): Entry<A>? = entries[id]

    /** Marks listed tracks and returns the server tracks that still need unprojection. */
    fun incoming(tracks: List<ServerTrack>, now: Long): List<ServerTrack> {
        val server = tracks.filter { it.source == "server" && !it.frameId.isNullOrBlank() }
        received = server.size
        server.forEach { t -> entries[t.id]?.let { it.lastListed = now; it.confidence = t.confidence } }
        return server.filter { it.id !in entries && attempted[it.id] != it.frameId }
    }

    fun resolved(track: ServerTrack, anchor: A, metricW: Float, metricH: Float, source: String, now: Long): Entry<A> {
        attempted[track.id] = track.frameId!!
        unresolved.remove(track.id)
        return Entry(track.id, track.label, track.frameId, anchor, metricW, metricH, track.confidence, now, source).also { entries[track.id] = it }
    }

    fun failed(track: ServerTrack, reason: String) {
        attempted[track.id] = track.frameId ?: ""
        unresolved[track.id] = reason
        while (unresolved.size > 20) unresolved.remove(unresolved.keys.first())
    }

    /** Removes entries the server stopped listing and returns them so the caller can detach anchors. */
    fun expire(now: Long): List<Entry<A>> = remove { now - it.lastListed > absentMs }
    fun remove(predicate: (Entry<A>) -> Boolean): List<Entry<A>> {
        val gone = entries.values.filter(predicate)
        gone.forEach { entries.remove(it.id) }
        return gone
    }
    fun clear(): List<Entry<A>> { val all = entries.values.toList(); entries.clear(); attempted.clear(); unresolved.clear(); received = 0; return all }
}

/** Blob-shadow look for a character [height] metres above its support. */
object BlobShadow {
    const val SIZE = 0.36f
    const val INTENSITY = 0.55f
    fun scale(height: Float): Float = 1f + height.coerceIn(0f, 1f) * 0.8f
    fun intensity(height: Float): Float = INTENSITY * (1f - height.coerceIn(0f, 1f) / 0.8f).coerceIn(0.15f, 1f)
}

/** Picks the CPU image size for the detector/uploads: prefer a 720p stream (≈640 px wide when displayed upright). */
fun pickCpuImageSize(sizes: List<Pair<Int, Int>>): Int? {
    if (sizes.isEmpty()) return null
    fun short(i: Int) = min(sizes[i].first, sizes[i].second)
    val exact = sizes.indices.firstOrNull { short(it) == 720 }
    if (exact != null) return exact
    return sizes.indices.filter { short(it) in 480..1080 }.minByOrNull { abs(short(it) - 720) } ?: 0
}
