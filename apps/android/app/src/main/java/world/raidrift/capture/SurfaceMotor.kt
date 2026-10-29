package world.raidrift.capture

import kotlin.math.hypot
import kotlin.math.min

data class FootPosition(val x: Float, val y: Float, val z: Float)

/**
 * Follow-me formation for walking streams: the server's normalized choreography
 * (x across, y depth) is laid out on the ground ahead of the camera instead of
 * around a fixed room anchor, so characters travel with the streamer.
 */
object Formation {
    const val AHEAD_METRES = 1.6f
    const val WIDTH_METRES = 1.4f
    const val DEPTH_METRES = 1.0f

    /** [forwardX]/[forwardZ] is the camera's viewing direction; only its horizontal part is used. */
    fun goal(camera: FootPosition, forwardX: Float, forwardZ: Float, heroX: Float, heroY: Float, groundProbeY: Float): FootPosition {
        val length = hypot(forwardX, forwardZ)
        // Looking straight down has no horizontal heading; keep a stable default.
        val (fx, fz) = if (length < 0.2f) 0f to -1f else forwardX / length to forwardZ / length
        val rx = -fz; val rz = fx
        val ahead = AHEAD_METRES + (heroY - 0.5f) * DEPTH_METRES
        val side = (heroX - 0.5f) * WIDTH_METRES
        return FootPosition(camera.x + fx * ahead + rx * side, groundProbeY, camera.z + fz * ahead + rz * side)
    }
}

/** Local presentation only. The server retains movement/reward authority. Units are metres. */
class SurfaceMotor {
    private data class Body(var foot: FootPosition, var velocityY: Float = 0f)
    private val bodies = mutableMapOf<String, Body>()
    fun clear() = bodies.clear()
    fun retain(ids: Set<String>) { bodies.keys.retainAll(ids) }

    /** Drops an actor that fell too far behind its goal so it re-enters at the goal. Returns true if dropped. */
    fun recall(id: String, goal: FootPosition, maxDistance: Float): Boolean {
        val body = bodies[id] ?: return false
        if (hypot(goal.x - body.foot.x, goal.z - body.foot.z) <= maxDistance) return false
        bodies.remove(id)
        return true
    }
    fun rebase(transform: (FootPosition) -> FootPosition) {
        val mapped = bodies.mapValues { (_, body) -> transform(body.foot).also { point ->
            require(listOf(point.x, point.y, point.z).all { it.isFinite() }) { "Invalid tracking origin transform" }
        } }
        mapped.forEach { (id, point) -> bodies.getValue(id).foot = point }
    }

    /** A missing observation freezes the actor; it must never invent an infinite room floor. */
    fun update(id: String, target: FootPosition, elapsed: Float, floor: (FootPosition) -> Float?): FootPosition? =
        updateWithWalls(id, target, elapsed, { _, _ -> false }, floor)

    fun updateWithWalls(id: String, target: FootPosition, elapsed: Float, blocked: (FootPosition, FootPosition) -> Boolean, floor: (FootPosition) -> Float?): FootPosition? {
        require(listOf(target.x, target.y, target.z, elapsed).all { it.isFinite() })
        val body = bodies[id] ?: run {
            val observed = floor(target) ?: return null
            if (!observed.isFinite() || observed > target.y + 0.035f) return null
            Body(target).also { bodies[id] = it }
        }
        val dt = elapsed.coerceIn(0f, 1f / 15f)
        val current = body.foot
        if (floor(current) == null) { body.velocityY = 0f; return current }
        val distance = hypot(target.x - current.x, target.z - current.z)
        val fraction = if (distance > 0f) min(1f, 0.45f * dt / distance) else 0f
        val next = FootPosition(current.x + (target.x - current.x) * fraction, current.y, current.z + (target.z - current.z) * fraction)
        if (blocked(current, next)) return current
        val support = floor(next) ?: run { body.velocityY = 0f; return current }
        if (!support.isFinite() || support > current.y + 0.035f) return current
        body.velocityY = (body.velocityY - 9.81f * dt).coerceAtLeast(-3f)
        var y = current.y + body.velocityY * dt
        if (y <= support) { y = support; body.velocityY = 0f }
        body.foot = next.copy(y = y)
        return body.foot
    }
}
