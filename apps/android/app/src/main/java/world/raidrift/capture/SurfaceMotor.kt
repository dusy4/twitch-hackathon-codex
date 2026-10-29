package world.raidrift.capture

import kotlin.math.hypot
import kotlin.math.min

data class FootPosition(val x: Float, val y: Float, val z: Float)

/** Local presentation only. The server retains movement/reward authority. Units are metres. */
class SurfaceMotor {
    private data class Body(var foot: FootPosition, var velocityY: Float = 0f)
    private val bodies = mutableMapOf<String, Body>()
    fun clear() = bodies.clear()
    fun retain(ids: Set<String>) { bodies.keys.retainAll(ids) }

    /** A missing observation freezes the actor; it must never invent an infinite room floor. */
    fun update(id: String, target: FootPosition, elapsed: Float, floor: (FootPosition) -> Float?): FootPosition? {
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
        val support = floor(next) ?: run { body.velocityY = 0f; return current }
        if (!support.isFinite() || support > current.y + 0.035f) return current
        body.velocityY = (body.velocityY - 9.81f * dt).coerceAtLeast(-3f)
        var y = current.y + body.velocityY * dt
        if (y <= support) { y = support; body.velocityY = 0f }
        body.foot = next.copy(y = y)
        return body.foot
    }
}
