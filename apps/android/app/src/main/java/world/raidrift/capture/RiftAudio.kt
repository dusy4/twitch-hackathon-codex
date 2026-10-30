package world.raidrift.capture

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import com.pedro.encoder.Frame
import kotlin.concurrent.thread
import kotlin.math.*

/** Offline PCM assets. No runtime provider request or API key ships in the app. */
class RiftAudio(context: Context) : AutoCloseable {
    val mixer = PcmEffects()
    @Volatile var enabled = true
    @Volatile var monitor = true
    @Volatile var microphonePublishing = false
    @Volatile private var closed = false
    @Volatile private var foreground = true
    @Volatile private var samples: Map<RiftCue, ShortArray> = emptyMap()
    @Volatile var ready = false; private set
    @Volatile var monitoringAvailable = true; private set
    private var lastStep = 0L
    private val worker = thread(name = "RaidRift-SFX", isDaemon = true) {
        var track: AudioTrack? = null
        try {
            samples = RiftCue.entries.associateWith { cue ->
                cue.asset?.let { name ->
                    val bytes = context.assets.open("audio/$name.pcm").use { it.readBytes() }
                    ShortArray(bytes.size/2) { i -> ((bytes[i*2].toInt() and 255) or (bytes[i*2+1].toInt() shl 8)).toShort() }
                } ?: ShortArray(if(cue == RiftCue.STEP) 2400 else 4200) { i ->
                    val t=i.toFloat()/PcmEffects.RATE
                    // Original soft wooden tick/thump, not a sampled third-party game sound.
                    (sin(2*PI*(if(cue==RiftCue.STEP)190 else 105)*t)*exp(-t*85)*9000).toInt().toShort()
                }
            }
            ready = true
            val minimum = AudioTrack.getMinBufferSize(PcmEffects.RATE,AudioFormat.CHANNEL_OUT_STEREO,AudioFormat.ENCODING_PCM_16BIT)
            track = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(PcmEffects.RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(max(minimum,7680)).setTransferMode(AudioTrack.MODE_STREAM).build()
            track.play()
            var origin = nowUs()
            var writtenFrames=0L
            while(!closed) {
                if (!foreground || !monitor || microphonePublishing || !enabled) {
                    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) { track.pause(); track.flush() }
                    Thread.sleep(25); origin = nowUs();writtenFrames=0; continue
                }
                if(track.playState != AudioTrack.PLAYSTATE_PLAYING) { origin=nowUs();writtenFrames=0;track.play() }
                var at=origin+writtenFrames*1_000_000L/PcmEffects.RATE
                // Resynchronize only forward after an underrun; never replay a queued interval.
                if(nowUs()-at>100_000) { origin=nowUs();writtenFrames=0;at=origin }
                val pcm=mixer.render(at,960,2,reader="phone")
                var written=0
                while(written<pcm.size && !closed) {
                    val count=track.write(pcm,written,pcm.size-written,AudioTrack.WRITE_BLOCKING)
                    if(count<=0) throw IllegalStateException("Audio output unavailable")
                    written+=count
                }
                writtenFrames+=960
            }
        } catch (_: InterruptedException) {
            // Normal lifecycle shutdown.
        } catch (_: Exception) {
            monitoringAvailable = false // Relay mixing can still use successfully loaded assets.
        } finally { runCatching { track?.stop() }; track?.release() }
    }
    fun foreground(value: Boolean) { foreground=value; if(!value) mixer.clear() }
    fun play(cue: RiftCue, foot: FootPosition? = null, listener: FootPosition? = null, right: FootPosition? = null) {
        if(!enabled || !foreground || closed) return
        val pcm=samples[cue] ?: return
        val distance=if(foot!=null && listener!=null) hypot(foot.x-listener.x,foot.z-listener.z) else 1f
        val pan=if(foot!=null && listener!=null && right!=null && distance>.01f)
            ((foot.x-listener.x)*right.x+(foot.z-listener.z)*right.z)/distance else 0f
        mixer.cue(pcm,nowUs(),cue.gain/(1f+max(0f,distance-1f)*.35f),pan)
    }
    /** Crowd footsteps are globally capped instead of multiplying volume by the player count. */
    fun step(cue: RiftCue = RiftCue.STEP, foot: FootPosition? = null, listener: FootPosition? = null, right: FootPosition? = null) {
        val now=nowUs()
        if(now-lastStep < if(cue==RiftCue.LAND) 140_000 else 280_000) return
        lastStep=now; play(cue,foot,listener,right)
    }
    fun mixMicrophone(frame: Frame): Frame {
        val size=frame.size.coerceIn(0,8192)
        if(size<2) return frame
        val input=frame.buffer.copyOfRange(frame.offset,frame.offset+size)
        val pcm=mixer.render(frame.timeStamp,size/2,microphone=input,reader="relay")
        return Frame(pcm,0,pcm.size,frame.timeStamp)
    }
    /** Effects-only broadcast: never opens a microphone or requires RECORD_AUDIO. */
    fun streamEffects(sink: (Frame) -> Unit): AutoCloseable {
        val running=java.util.concurrent.atomic.AtomicBoolean(true)
        val producer=thread(name="RaidRift-Relay-SFX",isDaemon=true) {
            var origin=nowUs()
            var frames=0L
            try { while(running.get() && !closed) {
                var at=origin+frames*1_000_000L/PcmEffects.RATE
                val now=nowUs()
                if(now<at) { Thread.sleep(((at-now)/1000).coerceAtLeast(1));continue }
                if(now-at>100_000) { origin=now;frames=0;at=now }
                val pcm=mixer.render(at,1024,reader="relay")
                sink(Frame(pcm,0,pcm.size,at))
                frames+=1024
            } } catch (_:InterruptedException) { /* stop */ }
        }
        return AutoCloseable { running.set(false);producer.interrupt() }
    }
    override fun close() { closed=true; mixer.clear(); worker.interrupt() }
    // RootEncoder uses elapsedRealtimeNanos (includes deep sleep), not System.nanoTime.
    // A different monotonic origin can put AAC hours away from video on a real phone.
    companion object { fun nowUs()=com.pedro.common.TimeUtils.getCurrentTimeMicro() }
}
