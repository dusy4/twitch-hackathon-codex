package world.raidrift.capture

import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sign

enum class RiftCue(val asset: String?, val gain: Float) {
    PORTAL_OPEN("portal_open", .75f), PORTAL_CLOSE("portal_close", .65f),
    DISCOVERY("discovery", .65f), PICKUP("pickup", .85f), COMPLETE("quest_complete", .8f),
    STEP(null, .12f), LAND(null, .22f),
}

/** One immutable-timeline mixer for phone stereo and independent relay PCM readers.
 * Reading the phone audio never consumes a sound intended for broadcast. No device API here.
 */
class PcmEffects {
    private data class Voice(val pcm: ShortArray, val atUs: Long, val left: Float, val right: Float, val readerStarts: MutableMap<String,Long> = mutableMapOf())
    private val voices = ArrayDeque<Voice>()
    private val ducks=mutableMapOf<String,Float>()
    @Volatile var volume: Float = .7f
    @Volatile var muted: Boolean = false
    val activeVoices: Int get() = synchronized(voices) { voices.size }
    fun clear() = synchronized(voices) { voices.clear();ducks.clear() }
    fun cue(pcm: ShortArray, atUs: Long, gain: Float = 1f, pan: Float = 0f) {
        if (pcm.isEmpty() || pcm.size > RATE * 10 || !gain.isFinite() || !pan.isFinite() || muted) return
        val angle = (pan.coerceIn(-1f,1f) + 1f) * PI.toFloat() / 4f
        synchronized(voices) {
            while (voices.size >= 12) voices.removeFirst()
            voices.addLast(Voice(pcm,atUs,cos(angle)*gain.coerceIn(0f,1f),sin(angle)*gain.coerceIn(0f,1f)))
        }
    }

    /** PCM16 little-endian. Microphone input is copied, never retained or modified. */
    fun render(atUs: Long, frames: Int, channels: Int = 1, microphone: ByteArray? = null, reader: String = "default"): ByteArray {
        require(frames in 1..8192 && channels in 1..2 && reader in setOf("default","phone","relay"))
        val output = ByteArray(frames * channels * 2)
        val current = synchronized(voices) {
            // Keep a small grace interval for the two independently buffered output sinks.
            voices.removeAll { atUs - it.atUs > it.pcm.size * 1_000_000L / RATE + 300_000L }
            voices.map { voice ->
                // A queued AudioTrack may render ahead of wall time. Its first read must retain
                // the attack rather than skip to the middle of a newly triggered sound.
                val start=voice.readerStarts.getOrPut(reader) { maxOf(voice.atUs,atUs) }
                voice to ((atUs-start)*RATE/1_000_000L).toInt()
            }
        }
        val gain = if (muted) 0f else volume.takeIf { it.isFinite() }?.coerceIn(0f,1f) ?: 0f
        var micEnergy=0.0
        if(microphone!=null) for(i in 0 until minOf(frames,microphone.size/2)) {
            val s=((microphone[i*2].toInt() and 255) or (microphone[i*2+1].toInt() shl 8)).toShort().toDouble()
            micEnergy+=s*s
        }
        val targetDuck=if(micEnergy/maxOf(1,frames)>600.0*600.0) .5f else 1f
        val (previousDuck,nextDuck)=synchronized(voices) {
            val previous=ducks[reader] ?: 1f
            val tau=if(targetDuck<previous).01f else .25f
            val next=targetDuck+(previous-targetDuck)*exp(-frames.toFloat()/RATE/tau)
            ducks[reader]=next
            previous to next
        }
        for (i in 0 until frames) for (channel in 0 until channels) {
            val outAt = (i*channels+channel)*2
            val mic = microphone?.takeIf { it.size > outAt+1 }?.let { ((it[outAt].toInt() and 255) or (it[outAt+1].toInt() shl 8)).toShort().toInt() } ?: 0
            var sample = mic.toFloat()
            val duck=previousDuck+(nextDuck-previousDuck)*i/frames
            current.forEach { (voice,offset) ->
                val index = offset + i
                if (index in voice.pcm.indices) sample += voice.pcm[index] * gain * duck *
                    if (channels == 1) (voice.left+voice.right)*.5f else if (channel == 0) voice.left else voice.right
            }
            // Headroom for summing voices; hostile/overlapping peaks cannot wrap PCM16.
            val magnitude=abs(sample)
            val limited = (if(magnitude<=28_000f)sample else sign(sample)*(28_000f+4767f*(1f-exp(-(magnitude-28_000f)/4767f)))).coerceIn(-32767f,32767f).toInt()
            output[outAt] = limited.toByte(); output[outAt+1] = (limited shr 8).toByte()
        }
        return output
    }
    companion object { const val RATE = 48_000 }
}
