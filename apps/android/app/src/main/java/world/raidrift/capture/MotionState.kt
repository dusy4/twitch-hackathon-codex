package world.raidrift.capture


/** Render-time jump envelope and turning; independent of snapshot/UI cadence. */
class MotionState {
    private data class State(var yaw: Float = 0f, var jumpTime: Float = 2f, var action: Long = Long.MIN_VALUE, var animation: String = "", var targetYaw: Float? = null)
    private val actors = mutableMapOf<String, State>()
    data class Sample(val yaw: Float, val lift: Float, val jumping: Boolean, val phase: Float)
    fun clear() = actors.clear()
    fun retain(ids: Set<String>) { actors.keys.retainAll(ids) }
    fun sample(id: String, animation: String, serial: Long, desiredYaw: Float?, elapsed: Float): Sample {
        val s = actors.getOrPut(id) { State(yaw = desiredYaw ?: 0f) }
        val dt = elapsed.coerceIn(0f, 1f / 15f)
        if (animation == "jump" && s.jumpTime >= JUMP_SECONDS && (s.animation != "jump" || s.action != serial)) s.jumpTime = 0f
        if ((s.animation != animation || s.action != serial) && animation.startsWith("turn_")) {
            s.targetYaw = s.yaw + when (animation) { "turn_left" -> -90f; "turn_right" -> 90f; else -> 180f }
        } else if (!animation.startsWith("turn_")) desiredYaw?.let { s.targetYaw = it }
        s.animation = animation; s.action = serial
        val jumping = s.jumpTime < JUMP_SECONDS
        val phase = s.jumpTime.coerceAtMost(JUMP_SECONDS)
        // Crouch -> takeoff -> airborne -> landing, aligned with Jump_Full_Short (1.1667s).
        val t = ((phase - .22f) / .66f).coerceIn(0f, 1f)
        val lift = if (jumping) .13f * 4f * t * (1f - t) else 0f
        s.jumpTime += dt
        s.targetYaw?.let { desired ->
            val delta = (((desired - s.yaw) % 360f + 540f) % 360f) - 180f
            s.yaw = wrap(s.yaw + delta.coerceIn(-540f * dt, 540f * dt))
            s.targetYaw = wrap(desired)
        }
        return Sample(s.yaw, lift, jumping, phase)
    }
    companion object {
        private fun wrap(degrees: Float) = ((degrees % 360f + 540f) % 360f) - 180f
        const val WALK_SPEED = .22f
        const val RUN_SPEED = .44f
        const val JUMP_SECONDS = 1.166667f
        fun travelSpeed(animation: String) = if (animation in setOf("run", "sprint")) RUN_SPEED else WALK_SPEED
    }
}
