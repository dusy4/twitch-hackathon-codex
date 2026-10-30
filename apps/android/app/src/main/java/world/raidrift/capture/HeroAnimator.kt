package world.raidrift.capture

import com.google.android.filament.gltfio.Animator

internal data class HeroPlayback(val clip: String, val speed: Float, val jumpPhase: Float?, val serial: Long)

/** One clock per model instance, with short cross-fades and a non-looping jump phase.
 * SceneView 4.62's animationSpeed is only read when a clip changes; drive Animator ourselves
 * so stride speed can follow measured travel without restarting a clip every camera update. */
internal class HeroAnimator(private val animator: Animator) {
    private val clips = (0 until animator.animationCount).associateBy { animator.getAnimationName(it) }
    private var current = -1
    private var previous = -1
    private var time = 0f
    private var previousTime = 0f
    private var transition = 1f
    private var last = 0L
    private var serial = Long.MIN_VALUE
    fun frame(nanos: Long, value: HeroPlayback) {
        val dt = if (last == 0L) 0f else ((nanos-last)/1_000_000_000f).coerceIn(0f,1f/15f)
        last = nanos
        val next = clips[value.clip] ?: clips["Idle"] ?: return
        if (next != current || (value.serial != serial && value.clip == "Cheer")) {
            previous = current; previousTime = time; current = next; time = 0f; transition = 0f
        }
        serial = value.serial
        time = value.jumpPhase ?: (time + dt * value.speed.coerceIn(.25f,2f))
        val duration = animator.getAnimationDuration(current)
        val sample = if (value.jumpPhase != null) time.coerceIn(0f, duration) else if (duration > 0f) time % duration else 0f
        animator.applyAnimation(current, sample)
        transition += dt
        if (previous >= 0 && transition < .14f && value.jumpPhase == null) {
            animator.applyCrossFade(previous, previousTime, (transition/.14f).coerceIn(0f,1f))
        }
        animator.updateBoneMatrices()
    }
}
