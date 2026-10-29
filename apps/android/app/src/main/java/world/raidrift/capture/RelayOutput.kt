package world.raidrift.capture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.pedro.common.ConnectChecker
import com.pedro.common.TimeUtils
import com.pedro.encoder.audio.AudioEncoder
import com.pedro.encoder.audio.GetAudioData
import com.pedro.encoder.input.audio.MicrophoneManager
import com.pedro.encoder.video.FormatVideoEncoder
import com.pedro.encoder.video.GetVideoData
import com.pedro.encoder.video.VideoEncoder
import com.pedro.rtmp.rtmp.RtmpClient
import com.pedro.srt.srt.SrtClient
import io.github.sceneview.utils.SurfaceMirrorer
import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer

/** A user-supplied private ingest, never a Twitch/chat-provided URL. */
internal data class RelayEndpoint(val url: String, val scheme: String) {
    companion object {
        fun parse(value: String): RelayEndpoint {
            val raw = value.trim()
            require(raw.length in 1..4096 && raw.none { it.isWhitespace() || it.code < 32 }) { "Enter an SRT, RTMPS or RTMP ingest URL" }
            val uri = runCatching { URI(raw) }.getOrNull()
                ?: throw IllegalArgumentException("Invalid ingest URL")
            val scheme = uri.scheme?.lowercase()
            require(scheme in setOf("srt", "rtmps", "rtmp")) { "Use SRT, RTMPS or RTMP. SRTLA bonding is not implemented." }
            require(!uri.host.isNullOrBlank() && uri.rawUserInfo == null && uri.rawFragment == null) { "Ingest needs a host and must not contain user information or a fragment" }
            require(uri.port == -1 || uri.port in 1..65535) { "Invalid ingest port" }
            if (scheme == "srt") {
                require(uri.port in 1..65535) { "Use the SRT port supplied by your relay" }
                val query = uri.rawQuery.orEmpty().split('&')
                require(!uri.rawPath.isNullOrEmpty() && uri.rawPath != "/" || query.any { it.startsWith("streamid=") && it.length > 9 }) { "Include the relay's SRT stream ID" }
                require(query.none { it.startsWith("mode=") && it != "mode=caller" }) { "This publisher supports SRT caller mode" }
                val options = query.filter { it.isNotEmpty() }.map { part ->
                    val key = part.substringBefore('=')
                    val decoded = runCatching { URLDecoder.decode(part.substringAfter('=', ""), "UTF-8") }.getOrNull()
                    require(decoded != null) { "Invalid SRT option encoding" }
                    require(key in setOf("streamid", "latency", "passphrase", "pbkeylen", "mode")) { "Unsupported SRT URL option" }
                    key to decoded
                }
                require(options.map { it.first }.distinct().size == options.size) { "Duplicate SRT options are ambiguous" }
                val values = options.toMap()
                values["passphrase"]?.let { require(it.length in 10..79) { "SRT passphrase must contain 10–79 characters" } }
                values["pbkeylen"]?.let { require(it in setOf("16", "24", "32") && values.containsKey("passphrase")) { "SRT pbkeylen uses 16, 24 or 32 bytes and requires a passphrase" } }
                values["latency"]?.let { require(it.toLongOrNull() in 20_000L..5_000_000L) { "SRT URL latency uses microseconds: 20000–5000000" } }
                // OBS/FFmpeg URLs use microseconds and AES key bytes. RootEncoder's
                // transport parser expects milliseconds and bits. Preserve private
                // stream IDs/passphrases exactly while adapting only these units.
                val adapted = query.joinToString("&") { part -> when (part.substringBefore('=')) {
                    "latency" -> "latency=${(values.getValue("latency").toLong() + 999) / 1000}"
                    "pbkeylen" -> "pbkeylen=${values.getValue("pbkeylen").toInt() * 8}"
                    else -> part
                } }
                return RelayEndpoint(raw.substringBefore('?') + if (uri.rawQuery != null) "?$adapted" else "", scheme)
            } else require(uri.rawPath.orEmpty().count { it == '/' } >= 2 && !uri.rawPath.endsWith('/')) { "Include the RTMP application and stream key" }
            return RelayEndpoint(raw, scheme!!)
        }
    }
}

/** Encodes the actual Filament composition; does not open a second camera or screen-capture UI. */
internal class RelayOutput(private val context: Context, private val mirror: SurfaceMirrorer) {
    var active by mutableStateOf(false); private set
    var connected by mutableStateOf(false); private set
    var microphone by mutableStateOf(false); private set
    var bitrate by mutableLongStateOf(0); private set
    var status by mutableStateOf("Relay output is off"); private set
    var attempted by mutableStateOf(false); private set
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var generation = 0
    private var video: VideoEncoder? = null
    private var audio: AudioEncoder? = null
    private var mic: MicrophoneManager? = null
    private var surface: Surface? = null
    private var srt: SrtClient? = null
    private var rtmp: RtmpClient? = null

    fun start(value: String, includeMicrophone: Boolean) {
        check(Looper.myLooper() == Looper.getMainLooper())
        val endpoint = RelayEndpoint.parse(value)
        if (includeMicrophone) check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Microphone permission is required only when audio is enabled" }
        stop()
        val current = generation
        val diagnosticStart = android.os.SystemClock.elapsedRealtime()
        var diagnosticVideo = 0L
        var diagnosticAudio = 0L
        var connectionAttempt = 0
        fun awaitConnection(message: String) {
            val attempt = ++connectionAttempt
            main.postDelayed({
                if (generation == current && active && !connected && connectionAttempt == attempt) stop(message)
            }, 20_000)
        }
        active = true; attempted = true; microphone = includeMicrophone; status = "Connecting to relay…"
        val checker = object : ConnectChecker {
            override fun onConnectionStarted(url: String) = Unit // Never expose a stream-key URL.
            override fun onConnectionSuccess() { main.post {
                if (active && generation == current) {
                    connected = true
                    connectionAttempt++
                    video?.requestKeyframe()
                    status = "Relay connected · H.264${if (includeMicrophone) " + microphone AAC" else " · video only"}"
                }
            } }
            override fun onConnectionFailed(reason: String) { main.post {
                if (active && generation == current) {
                    connected = false
                    bitrate = 0
                    awaitConnection("Relay reconnect timed out · restart when ready")
                    if (srt?.shouldRetry(reason) == true) {
                        status = "Relay interrupted · reconnecting"; srt?.reConnect(1000)
                    } else if (rtmp?.shouldRetry(reason) == true) {
                        status = "Relay interrupted · reconnecting"; rtmp?.reConnect(1000)
                    } else stop("Relay connection failed · check ingest and restart")
                }
            } }
            override fun onDisconnect() { main.post {
                if (active && generation == current) stop("Relay disconnected · restart when ready")
            } }
            override fun onAuthError() { main.post {
                if (active && generation == current) stop("Relay rejected authentication · check the private ingest")
            } }
            override fun onAuthSuccess() = Unit
            override fun onNewBitrate(bitrate: Long) { main.post {
                if (active && generation == current) this@RelayOutput.bitrate = bitrate
            } }
        }
        try {
            if (endpoint.scheme == "srt") srt = SrtClient(checker).also {
                it.setOnlyVideo(!includeMicrophone); it.setAudioInfo(48_000, false); it.setReTries(3); it.setLogs(false)
            } else rtmp = RtmpClient(checker).also {
                it.setOnlyVideo(!includeMicrophone); it.setAudioInfo(48_000, false); it.setReTries(3); it.setLogs(false)
            }
            val srtSession = srt; val rtmpSession = rtmp
            val encoder = VideoEncoder(object : GetVideoData {
                override fun onVideoInfo(sps: ByteBuffer, pps: ByteBuffer?, vps: ByteBuffer?) {
                    if (generation == current) { srtSession?.setVideoInfo(sps, pps, vps); rtmpSession?.setVideoInfo(sps, pps, vps) }
                }
                override fun getVideoData(videoBuffer: ByteBuffer, info: MediaCodec.BufferInfo) {
                    if (BuildConfig.DEBUG && android.os.SystemClock.elapsedRealtime() - diagnosticVideo > 5000) {
                        diagnosticVideo = android.os.SystemClock.elapsedRealtime()
                        android.util.Log.d("RaidRiftTiming", "video elapsedMs=${diagnosticVideo - diagnosticStart} ptsUs=${info.presentationTimeUs}")
                    }
                    if (generation == current && active) { srtSession?.sendVideo(videoBuffer, info); rtmpSession?.sendVideo(videoBuffer, info) }
                }
                override fun onVideoFormat(mediaFormat: MediaFormat) = Unit
            })
            video = encoder
            encoder.forceBt709Color(true)
            check(encoder.prepareVideoEncoder(1280, 720, 30, 2_500_000, 0, 2, FormatVideoEncoder.SURFACE)) { "H.264 encoder unavailable" }
            if (includeMicrophone) {
                val audioEncoder = AudioEncoder(object : GetAudioData {
                    override fun getAudioData(audioBuffer: ByteBuffer, info: MediaCodec.BufferInfo) {
                        if (BuildConfig.DEBUG && android.os.SystemClock.elapsedRealtime() - diagnosticAudio > 5000) {
                            diagnosticAudio = android.os.SystemClock.elapsedRealtime()
                            android.util.Log.d("RaidRiftTiming", "audio elapsedMs=${diagnosticAudio - diagnosticStart} ptsUs=${info.presentationTimeUs}")
                        }
                        if (generation == current && active) { srtSession?.sendAudio(audioBuffer, info); rtmpSession?.sendAudio(audioBuffer, info) }
                    }
                    override fun onAudioFormat(mediaFormat: MediaFormat) = Unit
                })
                audio = audioEncoder
                check(audioEncoder.prepareAudioEncoder(96_000, 48_000, false)) { "AAC encoder unavailable" }
                mic = MicrophoneManager(audioEncoder).also {
                    check(it.createMicrophone(48_000, false, true, true)) { "Microphone unavailable" }
                }
            }
            val mediaOrigin = TimeUtils.getCurrentTimeMicro()
            encoder.start(mediaOrigin)
            audio?.start(mediaOrigin); mic?.start()
            surface = encoder.inputSurface
            mirror.startMirroring(checkNotNull(surface), width = 1280, height = 720)
            awaitConnection("Relay connection timed out · restart when ready")
            srt?.connect(endpoint.url); rtmp?.connect(endpoint.url)
            // Late OBS readers and restored connections need a bounded random-access interval,
            // even when a device encoder's frame-based GOP is stretched by rendering slowdown.
            val keyframes = object : Runnable {
                override fun run() {
                    if (generation != current || !active) return
                    if (connected) video?.requestKeyframe()
                    main.postDelayed(this, 2000)
                }
            }
            main.postDelayed(keyframes, 2000)
        } catch (_: Exception) {
            stop("Relay encoder could not start · camera and microphone output stopped")
        }
    }

    fun setQuality(kilobits: Int) {
        require(kilobits in setOf(1000, 1500, 2500, 4000))
        if (active) video?.setVideoBitrateOnFly(kilobits * 1000)
    }

    fun mute(value: Boolean) { if (microphone) { if (value) mic?.mute() else mic?.unMute() } }

    fun stop(message: String = "Relay output stopped") {
        generation++; active = false; connected = false; microphone = false; bitrate = 0
        surface?.let { runCatching { mirror.stopMirroring(it) } }; surface = null
        runCatching { mic?.stop() }; mic = null
        runCatching { audio?.stop() }; audio = null
        runCatching { video?.stop() }; video = null
        srt?.disconnect(); srt = null
        rtmp?.disconnect(); rtmp = null
        status = message
    }
}
