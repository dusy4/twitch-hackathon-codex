package world.raidrift.capture

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.sceneview.utils.SurfaceMirrorer
import okhttp3.*
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.TimeUnit

internal fun nativeMediaRequest(server: HttpUrl, token: String): Request = Request.Builder()
    .url(server.newBuilder().addPathSegments("v1/media").build())
    .header("Authorization", "Bearer $token").build()

/** Explicit, video-only LAN output. A GPU surface receives the camera+virtual scene. */
class CompositeOutput(private val context: Context, private val mirror: SurfaceMirrorer) {
    var active by mutableStateOf(false); private set
    var status by mutableStateOf("Experimental LAN output · no audio"); private set
    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).pingInterval(15, TimeUnit.SECONDS).build()
    private var generation = 0
    private var socket: WebSocket? = null
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var helper: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var surface: Surface? = null
    private var peer: PeerConnection? = null
    private var offerStarted = false
    private var remoteReady = false
    private var connected = false
    private val candidates = mutableListOf<IceCandidate>()

    fun start(server: HttpUrl, token: String) {
        check(Looper.myLooper() == Looper.getMainLooper())
        check(!active)
        val current = ++generation
        active = true; connected = false; offerStarted = false; remoteReady = false
        status = "Preparing composed output · waiting for paired receiver"
        try {
            initialize(context.applicationContext)
            val shared = EglBase.create().also { egl = it }
            val rtcFactory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(shared.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(shared.eglBaseContext))
                .createPeerConnectionFactory().also { factory = it }
            val video = rtcFactory.createVideoSource(false).also { source = it }
            video.adaptOutputFormat(1280, 720, 24)
            val frames = SurfaceTextureHelper.create("RaidRiftCompositeFrames", shared.eglBaseContext)
                ?: throw IllegalStateException("Texture capture unavailable")
            helper = frames
            frames.setTextureSize(1280, 720)
            frames.startListening { frame -> video.capturerObserver.onFrameCaptured(frame) }
            video.capturerObserver.onCapturerStarted(true)
            val target = Surface(frames.surfaceTexture).also { surface = it }
            mirror.startMirroring(target, width = 1280, height = 720)
            val configuration = PeerConnection.RTCConfiguration(emptyList()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            }
            peer = rtcFactory.createPeerConnection(configuration, object : PeerConnection.Observer {
                override fun onSignalingChange(state: PeerConnection.SignalingState) {}
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
                override fun onIceCandidatesRemoved(values: Array<out IceCandidate>) {}
                override fun onAddStream(stream: MediaStream) {}
                override fun onRemoveStream(stream: MediaStream) {}
                override fun onDataChannel(channel: DataChannel) {}
                override fun onRenegotiationNeeded() {}
                override fun onIceCandidate(candidate: IceCandidate) = dispatch(current) {
                    send(JSONObject().put("type", "candidate").put("candidate", candidate.sdp)
                        .put("sdpMid", candidate.sdpMid ?: JSONObject.NULL).put("sdpMLineIndex", candidate.sdpMLineIndex))
                }
                override fun onConnectionChange(state: PeerConnection.PeerConnectionState) = dispatch(current) {
                    when (state) {
                        PeerConnection.PeerConnectionState.CONNECTED -> { connected = true; status = "LAN peer connected · composed video only" }
                        PeerConnection.PeerConnectionState.FAILED, PeerConnection.PeerConnectionState.DISCONNECTED, PeerConnection.PeerConnectionState.CLOSED -> stop("LAN connection ended · sharing stopped")
                        else -> status = "LAN media ${state.name.lowercase()}"
                    }
                }
            }) ?: throw IllegalStateException("Peer creation failed")
            track = rtcFactory.createVideoTrack("raidrift-composite-video", video).also {
                check(peer!!.addTrack(it, listOf("raidrift-composite")) != null)
            }
            socket = client.newWebSocket(nativeMediaRequest(server, token), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) = dispatch(current) {
                    status = "Sharing armed · open the paired OBS receiver · direct LAN only"
                }
                override fun onMessage(webSocket: WebSocket, text: String) = dispatch(current) {
                    try {
                        require(text.length <= 110_000)
                        val signal = JSONObject(text)
                        when (signal.getString("type")) {
                            "ready" -> offer(current)
                            "answer" -> {
                                val sdp = signal.getString("sdp"); require(sdp.length <= 100_000)
                                peer?.setRemoteDescription(observer(current, onSet = {
                                    remoteReady = true
                                    candidates.forEach { peer?.addIceCandidate(it) }; candidates.clear()
                                }), SessionDescription(SessionDescription.Type.ANSWER, sdp))
                            }
                            "candidate" -> {
                                val value = signal.getString("candidate"); require(value.length <= 5000)
                                val index = signal.optInt("sdpMLineIndex", 0); require(index in 0..20)
                                val mid = if (signal.isNull("sdpMid")) null else signal.getString("sdpMid").also { require(it.length <= 50) }
                                val candidate = IceCandidate(mid, index, value)
                                if (remoteReady) peer?.addIceCandidate(candidate) else { require(candidates.size < 64); candidates += candidate }
                            }
                            else -> throw IllegalArgumentException("Unknown signal")
                        }
                    } catch (_: Exception) { stop("Invalid LAN signaling · sharing stopped") }
                }
                override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) = dispatch(current) { stop("LAN signaling failed · check receiver, pairing and network") }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) = dispatch(current) { stop("Paired media session ended · sharing stopped") }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dispatch(current) { stop("Paired media session ended · sharing stopped") }
            })
            main.postDelayed({ if (current == generation && active && !connected) stop("No direct LAN connection within 20 seconds · sharing stopped") }, 20_000)
        } catch (_: Exception) { stop("Composed video output could not start on this device") }
    }

    private fun offer(current: Int) {
        if (offerStarted) return
        offerStarted = true
        peer?.createOffer(observer(current, onCreate = { description ->
            peer?.setLocalDescription(observer(current, onSet = {
                send(JSONObject().put("type", "offer").put("sdp", description.description))
            }), description)
        }), MediaConstraints())
    }

    private fun observer(current: Int, onCreate: (SessionDescription) -> Unit = {}, onSet: () -> Unit = {}) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = dispatch(current) { onCreate(description) }
        override fun onSetSuccess() = dispatch(current) { onSet() }
        override fun onCreateFailure(error: String) = dispatch(current) { stop("Media negotiation failed · sharing stopped") }
        override fun onSetFailure(error: String) = dispatch(current) { stop("Media negotiation failed · sharing stopped") }
    }
    private fun dispatch(current: Int, action: () -> Unit) { main.post { if (current == generation && active) action() } }
    private fun send(signal: JSONObject) { if (socket?.send(signal.toString()) != true) stop("LAN signaling unavailable · sharing stopped") }

    fun stop(message: String = "Sharing stopped · no media retained") {
        check(Looper.myLooper() == Looper.getMainLooper())
        ++generation; active = false; connected = false; candidates.clear()
        socket?.cancel(); socket = null
        surface?.let { runCatching { mirror.stopMirroring(it) } }
        helper?.stopListening()
        source?.capturerObserver?.onCapturerStopped()
        peer?.close(); peer?.dispose(); peer = null
        track?.dispose(); track = null
        source?.dispose(); source = null
        surface?.release(); surface = null
        helper?.dispose(); helper = null
        factory?.dispose(); factory = null
        egl?.release(); egl = null
        status = message
    }
    fun dispose() { stop(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll() }

    companion object {
        private var initialized = false
        @Synchronized private fun initialize(context: Context) {
            if (!initialized) {
                PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context)
                    .setEnableInternalTracer(false).createInitializationOptions())
                initialized = true
            }
        }
    }
}
