package world.raidrift.capture

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/*
 * Pure (JVM-testable) logic for the north-star loop: detections -> stable tracks ->
 * displayed-image boxes -> 3D foot points -> per-hero goals. No Android/ARCore types here.
 */

/** Normalized 0..1 box in the DISPLAYED camera image (portrait as shown): x, y = top-left. */
data class TrackBox(val x: Float, val y: Float, val w: Float, val h: Float) {
    val right get() = x + w
    val bottom get() = y + h
    val centerX get() = x + w / 2f
    val centerY get() = y + h / 2f
    fun area() = max(0f, w) * max(0f, h)
    fun iou(other: TrackBox): Float {
        val ix = max(0f, min(right, other.right) - max(x, other.x))
        val iy = max(0f, min(bottom, other.bottom) - max(y, other.y))
        val inter = ix * iy
        val union = area() + other.area() - inter
        return if (union <= 0f) 0f else inter / union
    }
}

/** Track ids use the class with spaces replaced by `_` ("ph-potted_plant-2"); the `class` field keeps the real label. */
fun trackIdFor(label: String, n: Int) = "ph-${label.trim().replace(' ', '_')}-$n"

data class Detection(val label: String, val score: Float, val box: TrackBox)

class TrackedObject(val id: String, val label: String, var box: TrackBox, var score: Float, var lastSeen: Long, var hits: Int = 1)

/** Greedy IoU tracker with a centroid fallback for fast/small boxes. Ids look like "ph-dog-3". */
class ObjectTracker(private val maxAgeMs: Long = 1500, private val iouThreshold: Float = 0.2f, private val centroidMax: Float = 0.15f) {
    private val tracks = mutableListOf<TrackedObject>()
    private val counters = mutableMapOf<String, Int>()

    fun clear() { tracks.clear() }
    fun active(now: Long): List<TrackedObject> = tracks.filter { now - it.lastSeen <= maxAgeMs }

    fun update(detections: List<Detection>, now: Long): List<TrackedObject> {
        tracks.removeAll { now - it.lastSeen > maxAgeMs }
        data class Pair3(val track: TrackedObject, val det: Int, val score: Float)
        val candidates = mutableListOf<Pair3>()
        detections.forEachIndexed { index, det ->
            tracks.forEach { track ->
                if (track.label != det.label) return@forEach
                val iou = track.box.iou(det.box)
                if (iou >= iouThreshold) candidates += Pair3(track, index, 1f + iou)
                else {
                    val d = hypot(track.box.centerX - det.box.centerX, track.box.centerY - det.box.centerY)
                    if (d < centroidMax) candidates += Pair3(track, index, (centroidMax - d) / centroidMax)
                }
            }
        }
        val usedTracks = mutableSetOf<TrackedObject>(); val usedDets = mutableSetOf<Int>()
        candidates.sortedByDescending { it.score }.forEach { c ->
            if (c.track in usedTracks || c.det in usedDets) return@forEach
            usedTracks += c.track; usedDets += c.det
            val det = detections[c.det]
            val b = c.track.box
            c.track.box = TrackBox(blend(b.x, det.box.x), blend(b.y, det.box.y), blend(b.w, det.box.w), blend(b.h, det.box.h))
            c.track.score = det.score; c.track.lastSeen = now; c.track.hits++
        }
        detections.forEachIndexed { index, det ->
            if (index in usedDets) return@forEachIndexed
            val n = (counters[det.label] ?: 0) + 1
            counters[det.label] = n
            tracks += TrackedObject(trackIdFor(det.label, n), det.label, det.box, det.score, now)
        }
        return active(now)
    }

    private fun blend(old: Float, new: Float) = old + (new - old) * 0.6f
}

/**
 * The affine map from CPU camera-image pixels to VIEW_NORMALIZED display coordinates,
 * captured from ARCore's transformCoordinates2d for the corners (0,0), (w,0), (0,h).
 * It covers both display rotation and the centre crop.
 */
class ImageToView(val width: Int, val height: Int, private val p00: FloatArray, private val p10: FloatArray, private val p01: FloatArray) {
    init { require(width > 0 && height > 0 && listOf(p00, p10, p01).all { it.size == 2 && it.all(Float::isFinite) }) }

    fun map(ix: Float, iy: Float): FloatArray {
        val u = ix / width; val v = iy / height
        return floatArrayOf(p00[0] + u * (p10[0] - p00[0]) + v * (p01[0] - p00[0]), p00[1] + u * (p10[1] - p00[1]) + v * (p01[1] - p00[1]))
    }

    /** Clockwise degrees that make the camera image appear as displayed (upright). */
    val rotation: Int get() = rotationFromAxis(p10[0] - p00[0], p10[1] - p00[1])

    /** Maps a box from the upright (rotated) detector bitmap, in its pixels, into the displayed view. Null if off-screen. */
    fun uprightBoxToView(left: Float, top: Float, right: Float, bottom: Float): TrackBox? {
        val corners = listOf(left to top, right to top, left to bottom, right to bottom).map { (ux, uy) ->
            val (ix, iy) = uprightToImage(ux, uy, rotation, width, height)
            map(ix, iy)
        }
        val x0 = corners.minOf { it[0] }.coerceIn(0f, 1f); val x1 = corners.maxOf { it[0] }.coerceIn(0f, 1f)
        val y0 = corners.minOf { it[1] }.coerceIn(0f, 1f); val y1 = corners.maxOf { it[1] }.coerceIn(0f, 1f)
        if (x1 - x0 < 0.01f || y1 - y0 < 0.01f) return null
        return TrackBox(x0, y0, x1 - x0, y1 - y0)
    }

    companion object {
        fun rotationFromAxis(dx: Float, dy: Float): Int =
            if (abs(dx) >= abs(dy)) (if (dx >= 0f) 0 else 180) else (if (dy > 0f) 90 else 270)

        /** Inverse of rotating a [w]x[h] image clockwise by [rotation]: upright point -> image point (continuous coords). */
        fun uprightToImage(ux: Float, uy: Float, rotation: Int, w: Int, h: Int): Pair<Float, Float> = when (rotation) {
            90 -> uy to h - ux
            180 -> w - ux to h - uy
            270 -> w - uy to ux
            else -> ux to uy
        }
    }
}

/**
 * YUV_420_888 planes -> downscaled ARGB pixels rotated clockwise by [rotation].
 * [crop] = (left, top, width, height) in full-resolution UPRIGHT pixels (null = whole image).
 * Returns the pixel array plus output width/height.
 */
fun yuvToUprightArgb(
    y: ByteArray, yRowStride: Int, u: ByteArray, v: ByteArray, uvRowStride: Int, uvPixelStride: Int,
    width: Int, height: Int, step: Int, rotation: Int, crop: IntArray? = null
): Triple<IntArray, Int, Int> {
    require(step >= 1 && width > 0 && height > 0)
    val (uw, uh) = if (rotation == 90 || rotation == 270) height to width else width to height
    val c = crop ?: intArrayOf(0, 0, uw, uh)
    require(c.size == 4 && c[0] >= 0 && c[1] >= 0 && c[2] > 0 && c[3] > 0 && c[0] + c[2] <= uw && c[1] + c[3] <= uh) { "Invalid crop" }
    val ow = c[2] / step; val oh = c[3] / step
    require(ow > 0 && oh > 0)
    val out = IntArray(ow * oh)
    for (oy in 0 until oh) for (ox in 0 until ow) {
        val ux = c[0] + ox * step; val uy = c[1] + oy * step
        val (px, py) = when (rotation) {
            90 -> uy to height - 1 - ux
            180 -> width - 1 - ux to height - 1 - uy
            270 -> width - 1 - uy to ux
            else -> ux to uy
        }
        val yy = (y.getOrElse(py * yRowStride + px) { 0 }.toInt() and 0xff) - 16
        val uvIndex = (py / 2) * uvRowStride + (px / 2) * uvPixelStride
        val uu = (u.getOrElse(uvIndex) { -128 }.toInt() and 0xff) - 128
        val vv = (v.getOrElse(uvIndex) { -128 }.toInt() and 0xff) - 128
        val c = 1.164f * max(0, yy)
        val r = (c + 1.596f * vv).toInt().coerceIn(0, 255)
        val g = (c - 0.392f * uu - 0.813f * vv).toInt().coerceIn(0, 255)
        val b = (c + 2.017f * uu).toInt().coerceIn(0, 255)
        out[oy * ow + ox] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
    }
    return Triple(out, ow, oh)
}

/** Ground fallback: ray through a view point, intersected with a horizontal plane. */
object GroundRay {
    /**
     * Camera-space direction for a VIEW_NORMALIZED point using a column-major GL projection
     * matrix (ARCore Camera.getProjectionMatrix, display oriented).
     */
    fun cameraDirection(u: Float, v: Float, projection: FloatArray): FootPosition {
        val ndcX = 2f * u - 1f; val ndcY = 1f - 2f * v
        return FootPosition((ndcX + projection[8]) / projection[0], (ndcY + projection[9]) / projection[5], -1f)
    }

    fun intersect(origin: FootPosition, direction: FootPosition, planeY: Float, maxDistance: Float = 8f): FootPosition? {
        if (direction.y > -1e-4f) return null
        val t = (planeY - origin.y) / direction.y
        if (t <= 0f) return null
        val p = FootPosition(origin.x + direction.x * t, planeY, origin.z + direction.z * t)
        return p.takeIf { hypot(p.x - origin.x, p.z - origin.z) <= maxDistance }
    }

    /** Metric height of a box spanning [boxHeight] of the view at [depth] metres. */
    fun objectHeight(boxHeight: Float, depth: Float, projection11: Float): Float =
        if (depth <= 0f || projection11 <= 0f) 0f else boxHeight * 2f * depth / projection11
}

/** What the caller should do with an ARCore anchor after an observation. */
enum class AnchorAction { NONE, CREATE, MOVE }

/**
 * trackId -> 3D foot position (ARCore world metres). Fresh observations are smoothed; once
 * [samplesNeeded] consecutive samples agree within [maxSpread] m the caller is asked to create an
 * ARCore anchor ([AnchorAction.CREATE] at [Spot.anchorAt]) and the spot then follows the anchor
 * ([setAnchoredFoot]) instead of re-projected boxes, so static furniture does not jitter. Only
 * [moveSamples] consecutive observations farther than [moveDistance] m re-anchor it ([AnchorAction.MOVE]).
 * [pin]ned spots belong to server-detected tracks and are removed by their owner, not by [prune].
 */
class TrackSpace(
    private val alpha: Float = 0.35f, private val dropMs: Long = 2000, private val holdMs: Long = 5000,
    private val anchoredHoldMs: Long = 15_000, private val samplesNeeded: Int = 4, private val maxSpread: Float = 0.12f,
    private val moveDistance: Float = 0.35f, private val moveSamples: Int = 3
) {
    class Spot(var foot: FootPosition, var topY: Float?, var lastSeen: Long, val label: String, var source: String) {
        internal val samples = ArrayDeque<FootPosition>()
        internal var outliers = 0
        var anchored = false; internal set
        var pinned = false; internal set
        /** Where to put the anchor after [AnchorAction.CREATE]/[AnchorAction.MOVE]. */
        var anchorAt: FootPosition? = null; internal set
    }
    private val spots = mutableMapOf<String, Spot>()

    fun observe(id: String, label: String, foot: FootPosition, topY: Float?, source: String, now: Long): AnchorAction {
        require(listOf(foot.x, foot.y, foot.z).all(Float::isFinite))
        val spot = spots[id]
        if (spot == null || !spot.anchored && hypot(spot.foot.x - foot.x, spot.foot.z - foot.z) > 1.5f) {
            spots[id] = Spot(foot, topY, now, label, source).also { it.samples.addLast(foot) }; return AnchorAction.NONE
        }
        spot.lastSeen = now
        spot.topY = when { topY == null -> spot.topY; spot.topY == null -> topY; else -> lerp(spot.topY!!, topY) }
        if (spot.pinned) return AnchorAction.NONE
        spot.source = source
        if (spot.anchored) {
            if (distance(spot.foot, foot) <= moveDistance) { spot.outliers = 0; spot.samples.clear(); return AnchorAction.NONE }
            spot.samples.addLast(foot); spot.outliers++
            while (spot.samples.size > moveSamples) spot.samples.removeFirst()
            if (spot.outliers < moveSamples) return AnchorAction.NONE
            spot.anchorAt = mean(spot.samples); spot.outliers = 0; spot.samples.clear()
            return AnchorAction.MOVE
        }
        spot.foot = FootPosition(lerp(spot.foot.x, foot.x), lerp(spot.foot.y, foot.y), lerp(spot.foot.z, foot.z))
        spot.samples.addLast(foot)
        while (spot.samples.size > samplesNeeded) spot.samples.removeFirst()
        if (spot.samples.size < samplesNeeded) return AnchorAction.NONE
        val center = mean(spot.samples)
        if (spot.samples.any { distance(it, center) > maxSpread }) return AnchorAction.NONE
        spot.anchorAt = center
        return AnchorAction.CREATE
    }

    /** The caller created an anchor at [foot]. */
    fun anchor(id: String, foot: FootPosition) { spots[id]?.let { it.anchored = true; it.foot = foot; it.samples.clear(); it.outliers = 0 } }
    /** Per-frame anchor pose (ARCore refines anchors as its map improves). */
    fun setAnchoredFoot(id: String, foot: FootPosition) { spots[id]?.takeIf { it.anchored }?.foot = foot }
    /** The anchor stopped tracking: fall back to fresh observations. */
    fun unanchor(id: String) { spots[id]?.let { it.anchored = false; it.samples.clear(); it.outliers = 0 } }
    /** Creates/refreshes an anchored spot owned elsewhere (server-detected track). */
    fun pin(id: String, label: String, foot: FootPosition, topY: Float?, source: String, now: Long) {
        val spot = spots.getOrPut(id) { Spot(foot, topY, now, label, source) }
        spot.foot = foot; spot.lastSeen = now; spot.anchored = true; spot.pinned = true; spot.source = source
        if (topY != null) spot.topY = topY
    }
    fun remove(id: String) { spots.remove(id) }

    /**
     * Drops spots unseen for ~2 s, except ones a resting hero uses (kept ~5 s) and anchored
     * furniture (kept ~15 s). Pinned spots are skipped. Returns removed ids (caller detaches anchors).
     */
    fun prune(now: Long, held: Set<String>): List<String> {
        val gone = spots.filter { (id, s) ->
            !s.pinned && now - s.lastSeen > when { s.anchored -> maxOf(anchoredHoldMs, holdMs); id in held -> holdMs; else -> dropMs }
        }.keys.toList()
        gone.forEach { spots.remove(it) }
        return gone
    }
    operator fun get(id: String): Spot? = spots[id]
    fun all(): Map<String, Spot> = spots
    fun clear() = spots.clear()
    private fun lerp(a: Float, b: Float) = a + (b - a) * alpha
    private fun distance(a: FootPosition, b: FootPosition) = kotlin.math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z))
    private fun mean(points: Collection<FootPosition>) = FootPosition(points.map { it.x }.average().toFloat(), points.map { it.y }.average().toFloat(), points.map { it.z }.average().toFloat())
}

val RESTING_ANIMATIONS = setOf("sit", "lie", "sleep")
val TRAVEL_ANIMATIONS = setOf("walk", "run", "sprint", "navigate", "follow", "follow_track")

/** Where a hero aimed at a tracked object should stand, and how high to lift it once there. */
data class TargetGoalResult(val goal: FootPosition, val lift: Float)

object TargetGoal {
    /**
     * [slot] is this hero's index among heroes on the same target. Movers ring the object at
     * 0.3 m starting on the camera side; resters sit on it (raised to [topY] if known) or right next to it.
     */
    fun goal(spot: FootPosition, topY: Float?, slot: Int, resting: Boolean, cameraX: Float, cameraZ: Float): TargetGoalResult {
        val base = atan2(cameraZ - spot.z, cameraX - spot.x)
        val spread = (if (slot % 2 == 0) 1 else -1) * ((slot + 1) / 2) * 0.7f
        val angle = base + spread
        if (resting) {
            val height = topY?.let { (it - spot.y).coerceIn(0f, 1.0f) }
            return if (height != null && height > 0.08f) {
                val r = if (slot == 0) 0f else 0.1f
                TargetGoalResult(FootPosition(spot.x + cos(angle) * r, spot.y, spot.z + sin(angle) * r), height)
            } else {
                val r = 0.18f + 0.05f * slot
                TargetGoalResult(FootPosition(spot.x + cos(angle) * r, spot.y, spot.z + sin(angle) * r), 0f)
            }
        }
        val r = 0.3f
        return TargetGoalResult(FootPosition(spot.x + cos(angle) * r, spot.y, spot.z + sin(angle) * r), 0f)
    }

    /** Yaw (degrees about +Y) that faces a model whose forward is +Z along (dx, dz). */
    fun yaw(dx: Float, dz: Float): Float = Math.toDegrees(atan2(dx, dz).toDouble()).toFloat()
}

/** Picks the KayKit clip for a hero given local movement state. */
fun presentedClip(serverAnimation: String, moving: Boolean, targeted: Boolean, lifted: Boolean): String = when {
    moving -> if (targeted || serverAnimation in setOf("run", "sprint")) "Running_A" else "Walking_A"
    serverAnimation in TRAVEL_ANIMATIONS -> "Idle"
    serverAnimation == "sit" && lifted -> "Sit_Chair_Idle"
    else -> characterClip(serverAnimation)
}

/** Server chat reply -> one short line for the toast. */
data class ChatReply(val ok: Boolean, val text: String) {
    companion object {
        fun parse(code: Int, body: String): ChatReply {
            if (code == 401 || code == 403) return ChatReply(false, "Pairing rejected · re-pair")
            val json = runCatching { JSONObject(body.take(200_000)) }.getOrNull()
            if (code !in 200..299) return ChatReply(false, json?.let { firstText(it, "message", "error", "code") } ?: "Server returned $code")
            if (json == null) return ChatReply(false, "Unreadable server reply")
            return if (json.optBoolean("ok")) {
                val plan = json.opt("plan")?.takeIf { it != JSONObject.NULL }?.let { summarize(it) }
                val source = json.optString("source", "").takeIf { it.isNotBlank() && !json.isNull("source") }
                ChatReply(true, (plan ?: "Sent").take(160) + (source?.let { " · $it" } ?: ""))
            } else ChatReply(false, (firstText(json, "message", "code") ?: "Command refused").take(160))
        }

        fun summarize(plan: Any): String = when (plan) {
            is String -> plan
            is JSONArray -> (0 until plan.length()).mapNotNull { plan.opt(it)?.takeIf { v -> v != JSONObject.NULL }?.let(::summarize) }.joinToString(" → ")
            is JSONObject -> firstText(plan, "summary", "say", "text", "description", "reply")
                ?: plan.optJSONArray("steps")?.let { summarize(it) }?.takeIf { it.isNotBlank() }
                ?: listOfNotNull(firstText(plan, "action", "intent", "verb"), firstText(plan, "target", "targetClass", "object")).joinToString(" ").takeIf { it.isNotBlank() }
                ?: plan.toString().take(140)
            else -> plan.toString()
        }

        private fun firstText(json: JSONObject, vararg keys: String): String? =
            keys.firstNotNullOfOrNull { key -> json.opt(key)?.takeIf { it is String && it.isNotBlank() } as String? }
    }
}

data class DebugLogLine(val at: Long, val kind: String, val text: String)
data class DebugState(
    val log: List<DebugLogLine> = emptyList(), val pending: Int = 0, val done: Int = 0, val failed: Int = 0,
    val aiProvider: String = "", val aiModel: String = "", val aiLatencyMs: Long? = null, val aiError: String = "",
    val avatars: Int = 0, val tracks: List<String> = emptyList(), val quests: List<String> = emptyList(), val leaderboard: List<String> = emptyList()
) {
    companion object {
        fun parse(raw: String): DebugState {
            require(raw.length <= 2_000_000)
            val json = JSONObject(raw)
            fun s(o: JSONObject?, k: String) = if (o == null || o.isNull(k)) "" else o.optString(k, "").take(200)
            val log = json.optJSONArray("log")?.let { a -> (0 until min(a.length(), 200)).mapNotNull { i -> a.optJSONObject(i) }.map {
                DebugLogLine(it.optLong("at"), s(it, "kind").take(30), s(it, "text"))
            } } ?: emptyList()
            val inbox = json.optJSONObject("inbox"); val ai = json.optJSONObject("ai")
            val avatars = json.opt("avatars").let { if (it is JSONArray) it.length() else (it as? Number)?.toInt() ?: 0 }
            fun list(key: String, f: (JSONObject) -> String) = json.optJSONArray(key)?.let { a -> (0 until min(a.length(), 50)).mapNotNull { a.optJSONObject(it) }.map(f) } ?: emptyList()
            return DebugState(
                log.takeLast(15), inbox?.optInt("pending") ?: 0, inbox?.optInt("done") ?: 0, inbox?.optInt("failed") ?: 0,
                s(ai, "provider"), s(ai, "model"), ai?.takeIf { it.has("lastLatencyMs") && !it.isNull("lastLatencyMs") }?.optLong("lastLatencyMs"), s(ai, "lastError"),
                avatars,
                list("tracks") { "${s(it, "id")} ${s(it, "class")} ${"%.2f".format(java.util.Locale.ROOT, it.optDouble("confidence", 0.0))}" },
                list("quests") { "${if (it.optBoolean("completed")) "✓" else "·"} ${s(it, "title")} ${s(it, "progress")}" },
                list("leaderboard") { "${s(it, "name")} ${it.opt("score") ?: ""}" }
            )
        }
    }
}

/**
 * A detected object ready to POST. [anchor] is the bottom-centre (ground contact).
 * Server-detected tracks this phone anchored are re-posted with [source] = "server" and their
 * [frameId] (keeps them alive server-side); phone-detected tracks omit both.
 */
data class OutgoingTrack(val id: String, val label: String, val box: TrackBox, val confidence: Float, val seenAt: Long,
                         val source: String? = null, val frameId: String? = null)

fun tracksPayload(tracks: List<OutgoingTrack>): JSONObject {
    val array = JSONArray()
    // Server-anchored tracks first so the 50-track cap never drops them.
    tracks.filter { it.id.length in 1..80 && it.label.length in 1..40 }
        .sortedWith(compareByDescending<OutgoingTrack> { it.source == "server" }.thenByDescending { it.confidence }).take(50).forEach { t ->
        val x = t.box.x.coerceIn(0f, 1f); val y = t.box.y.coerceIn(0f, 1f)
        val w = t.box.w.coerceIn(0f, 1f - x); val h = t.box.h.coerceIn(0f, 1f - y)
        val item = JSONObject().put("id", t.id).put("class", t.label).put("attributes", JSONArray())
            .put("box", JSONArray().put(x.toDouble()).put(y.toDouble()).put(w.toDouble()).put(h.toDouble()))
            .put("confidence", t.confidence.coerceIn(0f, 1f).toDouble())
            .put("anchor", JSONArray().put((x + w / 2f).toDouble()).put((y + h).toDouble()))
            .put("seenAt", t.seenAt)
        t.source?.takeIf { it.isNotBlank() }?.let { item.put("source", it) }
        t.frameId?.takeIf { it.isNotBlank() }?.let { item.put("frameId", it.take(80)) }
        array.put(item)
    }
    return JSONObject().put("tracks", array)
}

/** True if a raid started within [windowMs] (accepts epoch seconds or ms; tolerates small clock skew). */
fun raidIsFresh(started: Long, now: Long, windowMs: Long): Boolean {
    val ms = if (started in 1..99_999_999_999) started * 1000 else started
    return ms > 0 && now - ms in -60_000..windowMs
}

/** Viewer names for "chat as random viewer". */
val RANDOM_VIEWERS = listOf("pixel_pup", "mossling", "emberfox", "noodle_knight", "quietcrow", "zapdragon", "lilbard", "sirwaffles")
