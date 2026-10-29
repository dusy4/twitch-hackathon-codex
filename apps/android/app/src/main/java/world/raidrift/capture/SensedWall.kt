package world.raidrift.capture

import kotlin.math.abs

data class PlanePoint(val u: Float, val v: Float)

/** A finite observed plane, not an infinite barrier. All input coordinates are metres. */
class SensedWall(
    private val origin: FootPosition,
    private val axisU: FootPosition,
    private val axisV: FootPosition,
    private val normal: FootPosition,
    private val polygon: List<PlanePoint>
) {
    init {
        require(polygon.size in 3..256)
        require(listOf(origin, axisU, axisV, normal).all { listOf(it.x, it.y, it.z).all(Float::isFinite) })
        require(polygon.all { it.u.isFinite() && it.v.isFinite() })
        require(listOf(axisU, axisV, normal).all { abs(dot(it, it) - 1f) < .01f })
        require(abs(dot(axisU, axisV)) < .01f && abs(dot(axisU, normal)) < .01f && abs(dot(axisV, normal)) < .01f)
    }

    fun blocks(from: FootPosition, to: FootPosition, radius: Float = .05f): Boolean {
        require(radius.isFinite() && radius in .01f..0.2f)
        for (height in listOf(.05f, .125f, .2f)) {
            val a = from.copy(y = from.y + height)
            val b = to.copy(y = to.y + height)
            val d0 = dot(subtract(a, origin), normal)
            val d1 = dot(subtract(b, origin), normal)
            val crossed = d0 * d1 < 0f
            if (!crossed && !(abs(d1) <= radius && abs(d1) < abs(d0))) continue
            val fraction = if (crossed) (d0 / (d0 - d1)).coerceIn(0f, 1f) else 1f
            val sample = FootPosition(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction, a.z + (b.z - a.z) * fraction)
            val delta = subtract(sample, origin)
            if (contains(PlanePoint(dot(delta, axisU), dot(delta, axisV)), radius)) return true
        }
        return false
    }

    private fun contains(point: PlanePoint, padding: Float): Boolean {
        var inside = false
        var previous = polygon.last()
        for (vertex in polygon) {
            val du = vertex.u - previous.u; val dv = vertex.v - previous.v
            val lengthSquared = du * du + dv * dv
            val factor = if (lengthSquared > 0f) (((point.u - previous.u) * du + (point.v - previous.v) * dv) / lengthSquared).coerceIn(0f, 1f) else 0f
            val edgeU = point.u - previous.u - factor * du; val edgeV = point.v - previous.v - factor * dv
            if (edgeU * edgeU + edgeV * edgeV <= padding * padding) return true
            if ((vertex.v > point.v) != (previous.v > point.v) && point.u < (previous.u - vertex.u) * (point.v - vertex.v) / (previous.v - vertex.v) + vertex.u) inside = !inside
            previous = vertex
        }
        return inside
    }

    private fun subtract(a: FootPosition, b: FootPosition) = FootPosition(a.x - b.x, a.y - b.y, a.z - b.z)
    private fun dot(a: FootPosition, b: FootPosition) = a.x * b.x + a.y * b.y + a.z * b.z
}
