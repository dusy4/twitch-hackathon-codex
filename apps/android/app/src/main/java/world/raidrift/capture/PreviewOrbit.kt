package world.raidrift.capture

import kotlin.math.cos
import kotlin.math.sin

/** Explicit preview camera ownership; never used for the tracked ARCore camera. */
internal class PreviewOrbit {
    var yaw = 0f; private set
    var pitch = 20f; private set
    var radius = 1.6f; private set
    fun drag(dx: Float, dy: Float) {
        if (!dx.isFinite() || !dy.isFinite()) return
        yaw = (yaw + dx.coerceIn(-2000f, 2000f) * 0.35f) % 360f
        pitch = (pitch + dy.coerceIn(-2000f, 2000f) * 0.25f).coerceIn(-35f, 75f)
    }
    fun zoom(ratio: Float) {
        if (!ratio.isFinite() || ratio <= 0f) return
        radius = (radius / ratio.coerceIn(0.1f, 10f)).coerceIn(0.5f, 5f)
    }
    fun eye(): FootPosition {
        val y = Math.toRadians(yaw.toDouble()).toFloat()
        val p = Math.toRadians(pitch.toDouble()).toFloat()
        return FootPosition(radius * sin(y) * cos(p), 0.15f + radius * sin(p), radius * cos(y) * cos(p))
    }
}
