package world.raidrift.capture

/** Transport connection alone does not prove camera video is being encoded. */
object BroadcastHealth {
    fun live(active: Boolean, connected: Boolean, encodedAt: Long, now: Long) =
        active && connected && encodedAt > 0L && now-encodedAt in 0L..4000L
}
