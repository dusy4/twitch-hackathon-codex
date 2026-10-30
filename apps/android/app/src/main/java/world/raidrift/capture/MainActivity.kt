package world.raidrift.capture

import android.os.Bundle
import android.Manifest
import android.os.SystemClock
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import android.widget.MediaController
import android.widget.VideoView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.ar.core.Anchor
import com.google.ar.core.CameraConfig
import com.google.ar.core.CameraConfigFilter
import com.google.ar.core.Config
import com.google.ar.core.Session
import io.github.sceneview.math.Direction
import io.github.sceneview.math.Scale
import io.github.sceneview.math.Size
import io.github.sceneview.node.ContactShadowContext
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Plane
import com.google.ar.core.Pose
import com.google.ar.core.TrackingState
import io.github.sceneview.*
import io.github.sceneview.ar.*
import io.github.sceneview.ar.scene.SceneUnderstanding
import io.github.sceneview.math.Position
import io.github.sceneview.math.Rotation
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private val connection: WorldConnection by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xffbca6ff))) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CaptureApp(connection)
                }
            }
        }
    }
}

/** Debug-build defaults for the owner's Tailscale test setup. */
private const val DEBUG_SERVER = "https://raidrift-pc.tail7252b4.ts.net"
private const val DEBUG_RELAY = "rtmp://raidrift-pc.tail7252b4.ts.net:1935/live/raidrift"

/** Follow-me: re-anchor once the streamer is this far from the anchor. */
private const val REANCHOR_METRES = 6f
/** Follow-me: an actor this far behind its goal re-enters at the goal. */
private const val RECALL_METRES = 5f
/** Rendered character height: a small creature on a desk or floor. */
private const val CHARACTER_HEIGHT_METRES = 0.30f
// KayKit heroes share one skeleton: GLB origin is between the feet on the ground, head top at
// ~2.19 units (hats/capes excluded). One fixed scale keeps every hero the same body size.
private const val KAYKIT_BODY_HEIGHT_UNITS = 2.19f

private class ContactFrame(var pose: Pose? = null) { val clock = PresentationClock() }
private class ArFrameDiagnostics(var timestamp: Long = 0, var frames: Int = 0, var since: Long = 0)

@Composable
private fun CaptureApp(connection: WorldConnection) {
    val state by connection.state.collectAsStateWithLifecycle()
    var server by remember { mutableStateOf(if (BuildConfig.DEBUG) connection.savedServer ?: DEBUG_SERVER else "") }
    var token by remember { mutableStateOf("") }
    // This internal build opens directly into the requested streamer test, even with a saved pairing.
    var testRoom by remember { mutableStateOf(BuildConfig.DEBUG) }
    val paired = state.pairingRequested && !testRoom
    var pairingPanel by remember { mutableStateOf(false) }
    var quickPairing by remember { mutableStateOf(false) }
    var outputPanel by remember { mutableStateOf(false) }
    var reviewClip by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var ar by remember { mutableStateOf(false) }
    var followMe by remember { mutableStateOf(false) }
    var viewSize by remember { mutableStateOf(0 to 0) }
    var lastAutoPlace by remember { mutableLongStateOf(0) }
    var anchor by remember { mutableStateOf<Anchor?>(null) }
    var pendingTap by remember { mutableStateOf<Pair<Float, Float>?>(null) }
    var tracking by remember { mutableStateOf("Camera is off · orbit the 3D preview with one finger") }
    var depth by remember { mutableStateOf("Depth not started") }
    var depthSupported by remember { mutableStateOf(false) }
    var lastDepthCheck by remember { mutableLongStateOf(0) }
    var surfaces by remember { mutableIntStateOf(0) }
    val motor = remember { SurfaceMotor() }
    var feet by remember { mutableStateOf<Map<String, HeroPose>>(emptyMap()) }
    val rt = remember { NorthstarRuntime() }
    var liveTracks by remember { mutableStateOf<List<TrackView>>(emptyList()) }
    var portal by remember { mutableStateOf<PortalWorld?>(null) }
    var bursts by remember { mutableStateOf<List<ConfettiBurst>>(emptyList()) }
    var sceneClock by remember { mutableLongStateOf(0) }
    var debugOpen by remember { mutableStateOf(false) }
    var showBoxes by remember { mutableStateOf(true) }
    var placementMode by remember { mutableStateOf(false) }
    var selectMode by remember { mutableStateOf(false) }
    var selectedTarget by remember { mutableStateOf<Pair<String, String>?>(null) }
    var selectedActor by remember { mutableStateOf<String?>(null) }
    var selectedLabel by remember { mutableStateOf("surface") }
    var labelTarget by remember { mutableStateOf<String?>(null) }
    var settingsOpen by remember { mutableStateOf(false) }
    var controlsOpen by remember { mutableStateOf(false) }
    var capturePanel by remember { mutableStateOf(false) }
    var pendingTargetTap by remember { mutableStateOf<Pair<Float, Float>?>(null) }
    var touchStart by remember { mutableStateOf<Triple<Float, Float, Long>?>(null) }
    val playground = remember { LocalPlayground() }
    var localWorld by remember { mutableStateOf(playground.world) }
    var testMessages by remember { mutableStateOf(playground.messages) }
    var testRunning by remember { mutableStateOf(false) }
    var testDelivered by remember { mutableIntStateOf(0) }
    var testViewer by remember { mutableStateOf(playground.viewers.first().id) }
    var consumedTestRaid by remember { mutableStateOf<String?>(null) }
    var detectorOn by remember { mutableStateOf(true) }
    var localDebug by remember { mutableStateOf(LocalDebug()) }
    var arFps by remember { mutableFloatStateOf(0f) }
    var propsNote by remember { mutableStateOf("") }
    var toast by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    LaunchedEffect(toast) { if (toast != null) { delay(5000); toast = null } }
    val contactFrame = remember { ContactFrame() }
    val arDiagnostics = remember { ArFrameDiagnostics() }
    var lightMode by remember { mutableStateOf(LightMode.AMBIENT) }
    var shadowMode by remember { mutableStateOf(ShadowMode.BLOB) }
    // Off by default: ARCore depth is low-res and a few cm noisy at the floor, which hides the lower
    // part (or all) of a 30 cm character standing on it. DBG can switch it on to compare.
    var occlusionOn by remember { mutableStateOf(false) }
    var shadowPlanes by remember { mutableStateOf<List<Plane>>(emptyList()) }
    var trackingOk by remember { mutableStateOf(false) }
    var feedActive by remember { mutableStateOf(true) }
    val feedReady by rememberUpdatedState({ !paired && feedActive && (!ar || trackingOk && anchor?.trackingState == TrackingState.TRACKING) })
    val feedTracks by rememberUpdatedState(liveTracks.filter { rt.space[it.id] != null } + rt.manualTargets.values.mapNotNull { t ->
        rt.space[t.id]?.let { TrackView(t.id, t.label, TrackBox(0f, 0f, 1f, 1f), 1f, "tap") }
    })
    LaunchedEffect(playground) { while (true) {
        delay(100)
        playground.tick(System.currentTimeMillis(), feedReady(), feedTracks)
        localWorld = playground.world; testMessages = playground.messages
        testRunning = playground.running; testDelivered = playground.delivered
    } }
    // Keep the callback stable per light mode: changing it asks SceneView to reconfigure ARCore.
    // ENVIRONMENTAL_HDR gives SceneView a main directional light (direction/colour/intensity, shadow
    // caster) plus spherical-harmonics irradiance and a reflections cubemap; AMBIENT_INTENSITY is the fallback.
    val configureArSession = remember(lightMode) {
        { session: Session, config: Config ->
            // Session.isSupported(Config) is deprecated but is the only ARCore check for a light mode;
            // unsupported HDR must fall back instead of failing session.configure.
            @Suppress("DEPRECATION")
            val hdr = lightMode == LightMode.HDR && runCatching {
                session.isSupported(Config(session).also { it.lightEstimationMode = Config.LightEstimationMode.ENVIRONMENTAL_HDR })
            }.getOrDefault(false)
            config.lightEstimationMode = if (hdr) Config.LightEstimationMode.ENVIRONMENTAL_HDR else Config.LightEstimationMode.AMBIENT_INTENSITY
            config.focusMode = Config.FocusMode.AUTO
            config.updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
        }
    }
    // 720p CPU images (instead of ARCore's 640x480 default) so server detection gets a ~640 px wide
    // displayed frame; otherwise ARCore's own preference order is kept.
    val selectCameraConfig = remember {
        { session: Session ->
            runCatching {
                val configs = session.getSupportedCameraConfigs(CameraConfigFilter(session).setFacingDirection(CameraConfig.FacingDirection.BACK))
                pickCpuImageSize(configs.map { it.imageSize.width to it.imageSize.height })?.let { configs[it] }
            }.getOrNull() ?: session.cameraConfig
        }
    }
    val engine = rememberEngine()
    val modelLoader = rememberModelLoader(engine)
    val materialLoader = rememberMaterialLoader(engine)
    val camera = rememberCameraNode(engine) {
        position = Position(0f, 1.3f, 2f); lookAt(Position(0f, 0.15f, 0f))
    }
    val previewOrbit = remember { PreviewOrbit() }
    var orbitRevision by remember { mutableIntStateOf(0) }
    var lastPreviewTouch by remember { mutableStateOf<Pair<Float, Float>?>(null) }
    var lastPreviewPinch by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(orbitRevision) {
        val eye = previewOrbit.eye()
        camera.position = Position(eye.x, eye.y, eye.z)
        camera.lookAt(Position(0f, 0.15f, 0f))
    }
    val arCamera = rememberARCameraNode(engine)
    val mirror = rememberSurfaceMirrorer()
    val context = LocalContext.current
    val clip = remember(mirror) { LocalClip(context, mirror) }
    val output = remember(mirror) { CompositeOutput(context, mirror) }
    val relay = remember(mirror) { RelayOutput(context, mirror) }
    val detector = remember { DetectorWorker(context.applicationContext) }
    DisposableEffect(detector) { onDispose { detector.close() } }
    var relayPanel by remember { mutableStateOf(false) }
    var relayUrl by remember { mutableStateOf(if (BuildConfig.DEBUG) DEBUG_RELAY else "") }
    var relayConsent by remember { mutableStateOf(false) }
    var includeMicrophone by remember { mutableStateOf(false) }
    var microphoneMuted by remember { mutableStateOf(false) }
    var qualityMenu by remember { mutableStateOf(false) }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        includeMicrophone = granted
        if (!granted) error = "Microphone permission denied · video-only output remains available"
    }
    var outputConsent by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, clip) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                feedActive = false
                clip.stop(); output.stop(); relay.stop(); connection.pause(); reviewClip = false
                detector.invalidate(); rt.generation++; rt.frames.clear(); contactFrame.clock.reset()
                pendingTap = null; pendingTargetTap = null
                relayConsent = false; includeMicrophone = false; microphoneMuted = false
            } else if (event == Lifecycle.Event.ON_START) { feedActive = true; connection.resume() }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); clip.stop(); output.dispose(); relay.stop() }
    }
    DisposableEffect(anchor) { val current = anchor; onDispose { runCatching { current?.detach() } } }
    DisposableEffect(rt) { onDispose { rt.reset() } }
    LaunchedEffect(ar) { detector.invalidate(); if (!ar) { anchor = null; pendingTap = null; pendingTargetTap = null; selectedTarget = null; clip.stop(); output.stop(); relay.stop(); rt.reset(); motor.clear(); feet = emptyMap(); contactFrame.clock.reset(); contactFrame.pose = null; liveTracks = emptyList(); portal = null; bursts = emptyList() } }
    LaunchedEffect(clip.recording) { if (clip.recording) { delay(20_000); clip.stop() } }
    val visibleWorld = state.world?.takeIf { state.authorized && !it.paused }
    // Only a rejected/revoked pairing stops output. A paused world or a network
    // blip hides characters but keeps the streamer's camera live.
    LaunchedEffect(state.revoked, paired) { if (paired && state.revoked) { clip.stop(); output.stop(); relay.stop(); ar = false } }
    val world = if (paired) visibleWorld else localWorld
    LaunchedEffect(ar, world?.raid?.id) {
        if (!ar && world?.raid != null) repeat(300) { sceneClock = SystemClock.elapsedRealtime(); delay(33) }
    }
    fun sendCommand(text: String) {
        if (paired) {
            val actor = world?.heroes?.firstOrNull { it.id == selectedActor } ?: world?.heroes?.firstOrNull()
            val chosen = selectedTarget?.second
            val command = if (chosen != null && text in setOf("sit", "run", "dance")) "$text ${if (text == "run") "to" else "on"} the $chosen" else text
            connection.chat(command, actor?.name, actor?.id, selectedTarget?.first) { reply -> toast = reply.text to reply.ok }
        } else {
            val choices = liveTracks.filter { rt.space[it.id] != null } + listOfNotNull(selectedTarget?.takeIf { rt.space[it.first] != null }?.let { TrackView(it.first,it.second,TrackBox(0f,0f,1f,1f),1f,"tap") })
            val reply = playground.command(text, selectedActor, selectedTarget?.first, choices, System.currentTimeMillis())
            localWorld = playground.world; testMessages = playground.messages; toast = reply.text to reply.ok
        }
    }

    fun startTestRaid() {
        testRoom = true
        detector.invalidate(); rt.generation++; rt.frames.clear()
        playground.raid(System.currentTimeMillis()); localWorld = playground.world; testMessages = playground.messages
        testRunning = true; testDelivered = 0; selectedActor = null
        motor.clear(); feet = emptyMap(); rt.spawned.clear(); rt.previousFeet.clear(); rt.motorLift.clear(); rt.targetApproach.clear(); rt.facing.clear()
        toast = "Test raid received · just watch the chat and portal" to true
    }

    Box(Modifier.fillMaxSize().background(Color(0xff10121c)).onSizeChanged { viewSize = it.width to it.height }) {
        if (ar) {
            // Own the AR view so shadowing can follow the DBG shadow mode on top of the Performance preset.
            val arView = rememberARView(engine)
            LaunchedEffect(arView, shadowMode) {
                arView.applyRenderQuality(RenderQuality.Performance)
                arView.setShadowingEnabled(shadowMode.real)
            }
            ARSceneView(
                modifier = Modifier.fillMaxSize(), engine = engine, modelLoader = modelLoader,
                materialLoader = materialLoader, cameraNode = arCamera, surfaceMirrorer = mirror,
                depthMode = Config.DepthMode.AUTOMATIC,
                planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL,
                instantPlacementMode = Config.InstantPlacementMode.DISABLED,
                sessionConfiguration = configureArSession,
                sessionCameraConfig = selectCameraConfig,
                view = arView,
                renderQuality = null,
                // occlusion -> ARCameraStream.isDepthOcclusionEnabled: swaps the camera background to the
                // depth material (writes real-world depth, drawn first) and uploads acquireDepthImage16Bits each frame.
                sceneUnderstanding = SceneUnderstanding(occlusion = depthSupported && occlusionOn, lighting = true, planeVisualization = anchor == null),
                onSessionCreated = { session ->
                    rt.reset(); detector.invalidate(); anchor = null; motor.clear(); feet = emptyMap()
                    contactFrame.clock.reset(); contactFrame.pose = null
                    if (BuildConfig.DEBUG) android.util.Log.d("RaidRiftAR", "config planes=${session.config.planeFindingMode} light=${session.config.lightEstimationMode} update=${session.config.updateMode} cpu=${session.cameraConfig.imageSize}")
                    depthSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                    depth = if (depthSupported) "Depth supported · waiting for frames" else "Depth unavailable · anchors only"
                },
                onSessionUpdated = { session, frame ->
                    if (frame.timestamp != arDiagnostics.timestamp) { arDiagnostics.timestamp = frame.timestamp; arDiagnostics.frames++ }
                    val tracked = frame.camera.trackingState == TrackingState.TRACKING
                    if (tracked != trackingOk) trackingOk = tracked
                    val anchorTracked = anchor == null || anchor?.trackingState == TrackingState.TRACKING
                    // Tracking loss only hides the characters (AnchorNode shows them only while TRACKING).
                    // The camera keeps recording/broadcasting: a live IRL stream must not drop.
                    tracking = if (!tracked) {
                        val reason = frame.camera.trackingFailureReason.name.lowercase().replace('_', ' ')
                        if (reason == "none") "Camera tracking paused · move slowly" else "Camera tracking paused · $reason · move slowly"
                    } else if (!anchorTracked) {
                        if (anchor?.trackingState == TrackingState.STOPPED) "Room anchor lost · reset placement" else "Room anchor tracking paused · move slowly to relocalize"
                    } else if (anchor == null) {
                        if (followMe) "Looking for the ground ahead · point the camera at the floor"
                        else if (surfaces == 0) "Tracking ready · move slowly to detect a desk or floor" else "$surfaces surfaces detected · tap a desk or floor"
                    } else if (followMe) "Characters follow you · tap a surface to re-place"
                    else "Stage locked · use Setup → Move stage to relocate"
                    // Known floor height, extended past ARCore's detected patch (see mainFloorY).
                    val allPlanes = if (tracked) session.getAllTrackables(Plane::class.java).toList() else emptyList()
                    val floorY = if (tracked) mainFloorY(allPlanes, frame.camera.pose.ty()) else null
                    fun floorAnchor(x: Float, y: Float) = floorY?.let { fy -> infiniteFloorPoint(frame, fy, x, y, viewSize.first, viewSize.second) }
                        ?.let { p -> runCatching { session.createAnchor(com.google.ar.core.Pose.makeTranslation(p.x, p.y, p.z)) }.getOrNull() }
                    pendingTap?.let { point ->
                        pendingTap = null
                        if (tracked) {
                            // Measured plane, upward depth point, then the extended measured floor. Never guessed placement.
                            val hit = groundHit(frame, point.first, point.second)
                            val created = if (hit != null) runCatching { anchorGround(session, hit) }.getOrNull()
                                else floorAnchor(point.first, point.second)
                            if (BuildConfig.DEBUG) android.util.Log.d("RaidRiftAR", "surfaceTap planes=$surfaces hit=${hit?.trackable?.javaClass?.simpleName} anchored=${created != null}")
                            if (created == null) error = "No floor or desk found there yet. Keep scanning slowly, then tap a surface."
                            else {
                                anchor = created; placementMode = false; error = ""; motor.clear(); feet = emptyMap()
                                contactFrame.clock.reset(); contactFrame.pose = null
                            }
                        }
                    }
                    // Follow-me: no tap needed. Anchor on measured ground ahead (plane or upward depth point),
                    // and re-anchor when the streamer walks away from it or ARCore drops it.
                    if (followMe && tracked && viewSize.first > 0 && SystemClock.elapsedRealtime() - lastAutoPlace > 500) {
                        val camPose = frame.camera.pose
                        val current = anchor
                        val needsAnchor = current == null || current.trackingState == TrackingState.STOPPED ||
                            kotlin.math.hypot(current.pose.tx() - camPose.tx(), current.pose.tz() - camPose.tz()) > REANCHOR_METRES
                        if (needsAnchor) {
                            lastAutoPlace = SystemClock.elapsedRealtime()
                            val hit = groundHit(frame, viewSize.first / 2f, viewSize.second * 0.8f)
                            val created = if (hit != null) runCatching { anchorGround(session, hit) }.getOrNull()
                                else floorAnchor(viewSize.first / 2f, viewSize.second * 0.8f)
                            if (created != null) { anchor = created; contactFrame.pose = null; contactFrame.clock.reset(); error = "" }
                        }
                    }
                    val nowElapsed = SystemClock.elapsedRealtime()
                    val nowEpoch = System.currentTimeMillis()
                    val observed = allPlanes.filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null }.take(64)
                    pendingTargetTap?.let { point ->
                        pendingTargetTap = null
                        val u = point.first / viewSize.first.coerceAtLeast(1); val v = point.second / viewSize.second.coerceAtLeast(1)
                        val existing = liveTracks.filter { u in it.box.x..it.box.right && v in it.box.y..it.box.bottom }
                            .minByOrNull { it.box.area() }
                        if (existing != null && rt.space[existing.id] != null) {
                            selectedTarget = existing.id to existing.label; selectMode = false
                            toast = "${existing.label.replaceFirstChar(Char::uppercase)} selected" to true
                        } else if (tracked) {
                            val hit = groundHit(frame, point.first, point.second)
                            val record = captureFrameRecord(frame, "tap", nowEpoch, observed)
                            val p = Unproject.viaDepth(record, u, v) ?: hit?.hitPose?.foot()
                            if (p == null) toast = "No measured surface there yet · move slowly and tap again" to false
                            else {
                                val id = "tap-${rt.generation}-${++rt.frameCounter}"
                                runCatching { session.createAnchor(Pose.makeTranslation(p.x, p.y, p.z)) }.onSuccess { a ->
                                    val ground = floorY?.takeIf { it <= p.y } ?: anchor?.pose?.ty()?.takeIf { it <= p.y } ?: p.y
                                    if (rt.manualTargets.size >= 8) rt.manualTargets.keys.firstOrNull()?.let { old -> rt.dropObjectAnchor(old); rt.space.remove(old); rt.manualTargets.remove(old); rt.objectSizes.remove(old) }
                                    rt.objectAnchors[id] = a
                                    rt.space.pin(id, "surface", p.copy(y = ground), p.y.takeIf { it > ground + .08f }, "tap", nowEpoch)
                                    rt.manualTargets[id] = ManualTarget(id, "surface", a, p.y - ground)
                                    rt.objectSizes[id] = .25f to .25f
                                    selectedTarget = id to "surface"; selectedLabel = "surface"; labelTarget = id; selectMode = false
                                }.onFailure { toast = "Could not anchor that surface · try again" to false }
                            }
                        }
                    }
                    if (nowElapsed - lastDepthCheck > 1000) {
                        lastDepthCheck = nowElapsed
                        surfaces = observed.count { it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
                        val window = (lastDepthCheck - arDiagnostics.since).coerceAtLeast(1)
                        arFps = if (arDiagnostics.since == 0L) 0f else arDiagnostics.frames * 1000f / window
                        if (BuildConfig.DEBUG) {
                            val points = runCatching { frame.acquirePointCloud().use { it.points.remaining() / 4 } }.getOrDefault(0)
                            android.util.Log.d("RaidRiftAR", "frame state=${frame.camera.trackingState} floors=$surfaces points=$points imageFps=$arFps anchor=${anchor?.trackingState} previousFeet=${feet.size} detector=${detector.status}")
                        }
                        arDiagnostics.frames = 0; arDiagnostics.since = lastDepthCheck
                        if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depth = runCatching { frame.acquireDepthImage16Bits().use { "Depth frames ${it.width}x${it.height} · occlusion ${if (occlusionOn) "on" else "off (DBG)"}" } }.getOrDefault("Depth supported · no current depth frame")
                        // Real-shadow catchers: the largest tracked floors/desks.
                        val floors = observed.filter { it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }.sortedByDescending { it.extentX * it.extentZ }.take(6)
                        if (floors.toSet() != shadowPlanes.toSet()) shadowPlanes = floors
                        val estimate = runCatching { frame.lightEstimate.state.name }.getOrDefault("?")
                        val registry = rt.serverTracks
                        localDebug = LocalDebug(
                            tracking = frame.camera.trackingState.name, failure = frame.camera.trackingFailureReason.name,
                            planes = surfaces, walls = observed.count { it.type == Plane.Type.VERTICAL }, depthSupported = depthSupported, depth = depth,
                            fps = arFps, detector = if (detectorOn) detector.status else "Detector off", detectorFps = detector.fps, detectorLatency = detector.latencyMs,
                            anchor = anchor?.trackingState?.name ?: "none", connection = state.message,
                            relay = if (relay.active) "${relay.status} · ${relay.bitrate / 1000} kbps" else relay.status, output = output.status,
                            tracksPost = connection.lastTracksResult, props = propsNote,
                            portal = rt.portal?.let { "${it.banner} · ${(nowElapsed - it.createdAt) / 1000}s${if (it.footKnown) "" else " · no ground, no spawns"}" } ?: "",
                            light = "${session.config.lightEstimationMode.name.lowercase()} · estimate $estimate (want ${lightMode.label})",
                            shadow = shadowMode.label + if (shadowMode.real) " · ${shadowPlanes.size} catcher planes" else "",
                            occlusion = when { !depthSupported -> "unsupported (no Depth API)"; occlusionOn -> "on (depth camera material)"; else -> "off" },
                            camera = runCatching { "cpu ${session.cameraConfig.imageSize.width}x${session.cameraConfig.imageSize.height} · gpu ${session.cameraConfig.textureSize.width}x${session.cameraConfig.textureSize.height}" }.getOrDefault(""),
                            frameUpload = listOf(connection.lastFrameResult, detector.uploadStatus).filter { it.isNotBlank() }.joinToString(" · "),
                            frames = rt.frames.size,
                            serverTracks = "received ${registry.received} · anchored ${registry.entries().size} · unresolved ${registry.unresolved.size}",
                            unresolved = registry.unresolved.entries.toList().takeLast(5).map { "${it.key}: ${it.value}" },
                            objectAnchors = rt.objectAnchors.size
                        )
                    }
                    // Camera image for the on-device detector (~5 Hz) and, every ~1.5 s while paired, a JPEG of the
                    // displayed image for server open-vocabulary detection. Both are produced off the render thread.
                    val newCameraImage = frame.timestamp != rt.lastCameraTimestamp
                    val detectDue = detectorOn && detector.detectorAvailable && newCameraImage && nowElapsed - rt.lastDetectSubmit >= maxOf(200L, detector.latencyMs + 30L)
                    val uploadDue = paired && detectorOn && tracked && state.authorized && nowElapsed - rt.lastFrameUpload >= 1500 && !connection.frameBusy && detector.pendingUpload.get() == null
                    if (viewSize.first > 0 && (detectDue || uploadDue) && detector.idle) {
                        runCatching { frame.acquireCameraImage() }.getOrNull()?.use { image ->
                            runCatching {
                                val out = FloatArray(6)
                                val w = image.width.toFloat(); val h = image.height.toFloat()
                                frame.transformCoordinates2d(Coordinates2d.IMAGE_PIXELS, floatArrayOf(0f, 0f, w, 0f, 0f, h), Coordinates2d.VIEW_NORMALIZED, out)
                                val mapping = ImageToView(image.width, image.height, floatArrayOf(out[0], out[1]), floatArrayOf(out[2], out[3]), floatArrayOf(out[4], out[5]))
                                val frameId = if (uploadDue) "f-${rt.generation}-${++rt.frameCounter}" else null
                                val record = captureFrameRecord(frame, frameId ?: "local-${frame.timestamp}", nowEpoch, observed)
                                if (frameId != null) rt.frames.put(record)
                                val observation = ObservationContext(rt.generation, frame.timestamp, record, tracked)
                                if (detector.submit(image, mapping, detectDue, frameId, observation)) {
                                    if (detectDue) rt.lastDetectSubmit = nowElapsed
                                    if (frameId != null) rt.lastFrameUpload = nowElapsed
                                    rt.lastCameraTimestamp = frame.timestamp
                                }
                            }
                        }
                    }
                    detector.pendingUpload.getAndSet(null)?.takeIf { paired && it.frameId.startsWith("f-${rt.generation}-") }?.let { connection.postFrame(it.frameId, it.base64, it.width, it.height, it.bytes) }
                    detector.latest.getAndSet(null)?.let { batch ->
                        val context = batch.context ?: return@let
                        if (!detectorOn || context.generation != rt.generation || nowEpoch - context.record.capturedAt !in 0..2000) return@let
                        val canLocate = tracked && context.poseTracked && SpatialObservation.usable(context, rt.generation, nowEpoch)
                        val record = context.record
                        val predicted = rt.space.all().mapNotNull { (id, spot) ->
                            val size = rt.objectSizes[id] ?: return@mapNotNull null
                            val oldView = FloatArray(16)
                            // Predict in the capture frame (not the display frame when inference finishes).
                            android.opengl.Matrix.invertM(oldView, 0, poseMatrix(record.displayPose), 0)
                            Projection.box(spot.foot, size.first, size.second, oldView, record.projection)?.let { id to it }
                        }.toMap()
                        rt.tracker.preserve(rt.objectAnchors.keys.toSet())
                        rt.tracker.predict(predicted)
                        val active = rt.tracker.update(batch.detections, nowEpoch)
                        if (canLocate) active.filter { it.lastSeen == nowEpoch }.forEach { t ->
                            if (t.hits < 2 && t.score < .65f) return@forEach
                            val located = SpatialObservation.geometry(record, t.observedBox) ?: return@forEach
                            rt.objectSizes[t.id] = located.width to located.height
                            val action = runCatching { rt.space.observe(t.id, t.label, located.foot, located.supportY, located.source, nowEpoch) }.getOrDefault(AnchorAction.NONE)
                            // Consistent samples -> one ARCore anchor; static furniture then stops jittering.
                            if (action != AnchorAction.NONE) rt.space[t.id]?.anchorAt?.let { at ->
                                if (action == AnchorAction.MOVE) rt.dropObjectAnchor(t.id)
                                if (rt.objectAnchors.size < 24) runCatching { session.createAnchor(com.google.ar.core.Pose.makeTranslation(at.x, at.y, at.z)) }
                                    .onSuccess { rt.objectAnchors[t.id] = it; rt.space.anchor(t.id, at) }
                            }
                        }
                        liveTracks = active.map { TrackView(it.id, it.label, it.box, it.score, rt.space[it.id]?.takeIf { s -> s.anchored || nowEpoch - s.lastSeen < 1500 }?.let { s -> if (s.anchored) "${s.source}+anchor" else s.source }) }
                    }
                    if (!detectorOn && liveTracks.isNotEmpty()) { liveTracks = emptyList(); rt.tracker.clear() }
                    // Object anchors follow ARCore's refinements; a paused anchor keeps its last pose.
                    rt.objectAnchors.entries.toList().forEach { (id, a) ->
                        when (a.trackingState) {
                            TrackingState.TRACKING -> {
                                val manual = rt.manualTargets[id]
                                if (manual != null) {
                                    val p = a.pose.foot()
                                    rt.space.pin(id, manual.label, p.copy(y = p.y - manual.lift), p.y.takeIf { manual.lift > .08f }, "tap", nowEpoch)
                                } else rt.space.setAnchoredFoot(id, a.pose.foot())
                            }
                            TrackingState.STOPPED -> { rt.dropObjectAnchor(id); rt.space.unanchor(id) }
                            else -> Unit
                        }
                    }
                    // Server open-vocabulary tracks: unproject in the stored frame, anchor, then treat like local detections.
                    val pendingServer = rt.serverTracks.incoming(world?.tracks.orEmpty(), nowEpoch)
                    if (tracked) pendingServer.take(4).forEach { t ->
                        val record = rt.frames[t.frameId!!]
                        if (record == null) { rt.serverTracks.failed(t, "frame ${t.frameId} not in buffer"); return@forEach }
                        val hit = Unproject.locate(record, t.box.centerX.coerceIn(0f, 1f), t.box.bottom.coerceIn(0f, 0.995f))
                        if (hit == null) { rt.serverTracks.failed(t, "no depth or plane under box in ${t.frameId}"); return@forEach }
                        val (metricW, metricH) = Unproject.metricSize(t.box, hit.distance, record.projection)
                        runCatching { session.createAnchor(com.google.ar.core.Pose.makeTranslation(hit.foot.x, hit.foot.y, hit.foot.z)) }
                            .onSuccess { a ->
                                rt.serverTracks.resolved(t, a, metricW, metricH, hit.source, nowEpoch)
                                rt.space.pin(t.id, t.label, hit.foot, if (metricH > 0.08f) hit.foot.y + metricH.coerceAtMost(1.2f) * 0.8f else null, "server-${hit.source}", nowEpoch)
                            }
                            .onFailure { rt.serverTracks.failed(t, "anchor failed: ${it.javaClass.simpleName}") }
                    }
                    rt.serverTracks.entries().toList().forEach { e ->
                        when (e.anchor.trackingState) {
                            TrackingState.TRACKING -> rt.space.pin(e.id, e.label, e.anchor.pose.foot(), rt.space[e.id]?.topY, "server-${e.source}", nowEpoch)
                            TrackingState.STOPPED -> { rt.serverTracks.remove { it === e }; runCatching { e.anchor.detach() }; rt.space.remove(e.id); rt.serverBoxes.remove(e.id) }
                            else -> Unit
                        }
                    }
                    rt.serverTracks.expire(nowEpoch).forEach { runCatching { it.anchor.detach() }; rt.space.remove(it.id); rt.serverBoxes.remove(it.id) }
                    if (paired && state.authorized && tracked && nowElapsed - rt.lastTracksPost >= 400) {
                        rt.lastTracksPost = nowElapsed
                        val viewMatrix = FloatArray(16).also { frame.camera.getViewMatrix(it, 0) }
                        val projMatrix = FloatArray(16).also { frame.camera.getProjectionMatrix(it, 0, 0.05f, 50f) }
                        // Server tracks are re-posted with the same id/source/frameId and their current projected box.
                        val serverOut = rt.serverTracks.entries().mapNotNull { e ->
                            val box = (if (tracked) Projection.box(e.anchor.pose.foot(), e.metricW, e.metricH, viewMatrix, projMatrix) else null)
                                ?.also { rt.serverBoxes[e.id] = it } ?: rt.serverBoxes[e.id] ?: return@mapNotNull null
                            OutgoingTrack(e.id, e.label, box, e.confidence, nowEpoch, "server", e.frameId)
                        }
                        val localOut = rt.tracker.active(nowEpoch).filter { rt.space[it.id] != null && (it.hits >= 2 || it.score >= .65f) }
                            .map { t -> OutgoingTrack(t.id, t.label, t.box, t.score, t.lastSeen) }
                        val freshIds = localOut.map { it.id }.toSet()
                        // A measured static room object remains addressable while briefly looking away.
                        // Dynamic animals/people still expire; an AR anchor cannot follow an unseen mover.
                        val rememberedOut = rt.objectAnchors.mapNotNull { (id,a) ->
                            if (id in freshIds || id in rt.manualTargets || a.trackingState != TrackingState.TRACKING) return@mapNotNull null
                            val t = rt.tracker.remembered(id) ?: return@mapNotNull null
                            val spot = rt.space[id] ?: return@mapNotNull null
                            val size = rt.objectSizes[id] ?: return@mapNotNull null
                            if (t.label !in STATIC_SCENE_LABELS || nowEpoch - spot.lastSeen > 15_000) return@mapNotNull null
                            val box = Projection.box(a.pose.foot(),size.first,size.second,viewMatrix,projMatrix) ?: t.box
                            OutgoingTrack(id,t.label,box,t.score,nowEpoch,"phone",attributes=listOf("world_anchor"))
                        }
                        val manualOut = rt.manualTargets.values.mapNotNull { t ->
                            if (t.anchor.trackingState != TrackingState.TRACKING) return@mapNotNull null
                            val p = t.anchor.pose.foot()
                            val box = Projection.box(p, .25f, .25f, viewMatrix, projMatrix) ?: return@mapNotNull null
                            OutgoingTrack(t.id, t.label, box, 1f, nowEpoch)
                        }
                        connection.postTracks(localOut + rememberedOut + manualOut + serverOut)
                    }
                    rt.space.prune(nowEpoch, world?.heroes.orEmpty().filter { it.animation in RESTING_ANIMATIONS }.mapNotNull { it.target }.toSet())
                        .forEach { rt.dropObjectAnchor(it) }
                    // Raid portal: wait for a real stage, then play each new raid once.
                    if (tracked && anchor?.trackingState == TrackingState.TRACKING) {
                        val raid = world?.raid
                        fun openPortal(raid: Raid, createdAt: Long = nowElapsed) {
                            val stage = anchor?.takeIf { it.trackingState == TrackingState.TRACKING }?.pose ?: return
                            rt.portal = stagePortal(stage, raid, createdAt, frame.camera.pose) { foot ->
                                // The tapped stage point itself is measured. Offset entrances must also
                                // be on an upward plane at the SAME height, so a desk portal cannot spawn off its edge.
                                val atTap = kotlin.math.hypot(foot.x - stage.tx(), foot.z - stage.tz()) < .025f && kotlin.math.abs(foot.y - stage.ty()) < .025f
                                atTap || observed.any { plane -> plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING &&
                                    kotlin.math.abs(plane.centerPose.ty() - foot.y) < .035f &&
                                    plane.isPoseInPolygon(Pose.makeTranslation(foot.x, foot.y, foot.z)) }
                            }
                            runCatching { rt.portalAnchor?.detach() }
                            rt.portalAnchor = rt.portal?.let { p -> runCatching { session.createAnchor(Pose.makeTranslation(p.foot.x,p.foot.y,p.foot.z)) }.getOrNull() }
                            rt.portalStage = anchor
                            if (!paired) consumedTestRaid = raid.id
                        }
                        if (raid != null && rt.portal != null && rt.portalStage !== anchor && raid.id == rt.portal?.raidId) openPortal(raid, rt.portal!!.createdAt)
                        if (rt.seenRaid == NorthstarRuntime.UNSET) {
                            rt.seenRaid = raid?.id
                            if (raid != null && (paired || consumedTestRaid != raid.id) && raidIsFresh(raid.started, nowEpoch, 30_000)) openPortal(raid)
                        } else if (raid != null && raid.id != rt.seenRaid) {
                            rt.seenRaid = raid.id
                            // Skip stale raids seen for the first time after (re)pairing; allow phone/server clock skew.
                            if (raidIsFresh(raid.started, nowEpoch, 120_000)) openPortal(raid)
                        }
                        // Props: confetti bursts at the portal (or ahead of the camera); other kinds are noted only.
                        world?.props?.forEach { prop ->
                            if (rt.seenProps.add(prop.id) && prop.kind == "confetti") {
                                val cam = frame.camera.pose; val z = cam.zAxis
                                val origin = rt.portal?.center ?: FootPosition(cam.tx() - z[0] * 1.5f, cam.ty() - 0.5f, cam.tz() - z[2] * 1.5f)
                                rt.bursts = rt.bursts + ConfettiBurst(prop.id, origin, nowElapsed)
                            }
                        }
                        val unsupported = world?.props.orEmpty().map { it.kind }.filter { it != "confetti" }.distinct()
                        val note = if (unsupported.isEmpty()) "" else "not rendered: ${unsupported.joinToString()}"
                        if (note != propsNote) propsNote = note
                    }
                    if (rt.seenProps.size > 500) rt.seenProps.clear()
                    rt.portal?.let { p ->
                        // Local stub joins pause with tracking, so the entrance uses the same active
                        // clock. Real incoming Twitch raids keep their ordinary real-time lifetime.
                        val age = if (!paired && p.raidId == playground.world.raid?.id) playground.elapsedMs else nowElapsed - p.createdAt
                        if (age > 10_000) { rt.portal = null; runCatching { rt.portalAnchor?.detach() }; rt.portalAnchor = null; rt.portalStage = null }
                        else {
                            val current = if (!paired) p.copy(createdAt = nowElapsed - age) else p
                            rt.portal = rt.portalAnchor?.takeIf { it.trackingState == TrackingState.TRACKING }?.pose?.foot()?.let { f -> current.copy(foot=f,center=f.copy(y=f.y+.5f)) } ?: current
                        }
                    }
                    rt.bursts = rt.bursts.filter { nowElapsed - it.startedAt < 2200 }
                    if (portal != rt.portal) portal = rt.portal
                    if (bursts != rt.bursts) bursts = rt.bursts
                    if (rt.portal != null || rt.bursts.isNotEmpty()) sceneClock = nowElapsed
                    val origin = anchor?.takeIf { tracked && it.trackingState == TrackingState.TRACKING }?.pose
                    val presentationStep = contactFrame.clock.sample(frame.timestamp,nowElapsed,origin != null && world != null)
                    if (origin != null && world != null && presentationStep != null) {
                        val planes = observed.filter { it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
                        val walls = observed.filter { it.type == Plane.Type.VERTICAL }.mapNotNull { plane ->
                            val polygon = plane.polygon.duplicate()
                            if (polygon.remaining() !in 6..512 || polygon.remaining() % 2 != 0) null else runCatching {
                                val pose = plane.centerPose
                                val center = pose.translation
                                val origin = FootPosition(center[0], center[1], center[2])
                                fun axis(x: Float, y: Float, z: Float): FootPosition {
                                    val value = pose.transformPoint(floatArrayOf(x, y, z))
                                    return FootPosition(value[0] - center[0], value[1] - center[1], value[2] - center[2])
                                }
                                val points = mutableListOf<PlanePoint>()
                                while (polygon.hasRemaining()) points += PlanePoint(polygon.get(), polygon.get())
                                SensedWall(origin, axis(1f, 0f, 0f), axis(0f, 0f, 1f), axis(0f, 1f, 0f), points)
                            }.getOrNull()
                        }
                        // Support under a point: tracked upward planes, then the extended floor (past the
                        // detected patch). Not the 160x90 depth collider: its noise invented surfaces in mid-air
                        // (owner recording 2026-10-30: hero hovering at backpack height beside the backpack).
                        fun measuredSupport(query: FootPosition): Float? = planes.mapNotNull { plane ->
                            val height = plane.centerPose.ty()
                            val sample = com.google.ar.core.Pose.makeTranslation(query.x, height, query.z)
                            height.takeIf { it <= query.y + 0.035f && plane.isPoseInPolygon(sample) }
                        }.maxOrNull()
                        fun support(query: FootPosition): Float? = measuredSupport(query) ?: (floorY ?: origin.ty()).takeIf { it <= query.y + 0.035f }
                        val elapsed = presentationStep
                        contactFrame.pose?.let { previous ->
                            val inverse = previous.inverse()
                            runCatching { motor.rebase { point ->
                                val local = inverse.transformPoint(floatArrayOf(point.x, point.y, point.z))
                                val mapped = origin.transformPoint(local)
                                FootPosition(mapped[0], mapped[1], mapped[2])
                            } }.onFailure { motor.clear() }
                        }
                        contactFrame.pose = origin
                        val heroes = world.heroes.take(12)
                        val ids = heroes.map { it.id }.toSet()
                        motor.retain(ids); rt.previousFeet.keys.retainAll(ids); rt.motorLift.keys.retainAll(ids); rt.targetApproach.keys.retainAll(ids); rt.facing.keys.retainAll(ids)
                        val camPose = frame.camera.pose
                        val camZ = camPose.zAxis
                        val camFoot = FootPosition(camPose.tx(), camPose.ty(), camPose.tz())
                        val inverseOrigin = origin.inverse()
                        // Several heroes on one object get distinct slots around it.
                        val slots = heroes.filter { it.target != null }.groupBy { it.target }.values
                            .flatMap { group -> group.mapIndexed { index, hero -> hero.id to index } }.toMap()
                        feet = heroes.mapNotNull { hero ->
                            val spot = hero.target?.let { rt.space[it] }
                            val resting = hero.animation in RESTING_ANIMATIONS
                            var targetLift = 0f
                            var speed = 0.45f
                            val goal = if (spot != null) {
                                val approach = rt.targetApproach[hero.id]?.takeIf { it.first == hero.target }?.second ?: camFoot.also {
                                    rt.targetApproach[hero.id] = hero.target to it
                                }
                                val result = TargetGoal.goal(spot.foot, spot.topY, slots[hero.id] ?: 0, resting, approach.x, approach.z)
                                targetLift = result.lift; speed = 1.0f
                                // Probe slightly above the object's foot so the ground under it is found.
                                result.goal.copy(y = spot.foot.y + 0.25f)
                            } else if (followMe) {
                                // Probe just below the phone so any ground/desk under the goal is found.
                                Formation.goal(camFoot, -camZ[0], -camZ[2], hero.x, hero.y, camPose.ty() - 0.3f)
                            } else {
                                val g = origin.transformPoint(floatArrayOf((hero.x - 0.5f) * 1.4f, 0f, (hero.y - 0.5f)))
                                FootPosition(g[0], g[1], g[2])
                            }
                            // Raiders spawned in the last ~10 s walk out of the portal (only if its ground was measured).
                            val gate = rt.portal
                            val spawnedAt = hero.spawnedAt
                            if (gate != null && gate.footKnown && spawnedAt != null && raidIsFresh(spawnedAt, nowEpoch, 10_000) && hero.id !in rt.spawned && motor.place(hero.id, gate.foot)) {
                                rt.spawned += hero.id
                                if (rt.spawned.size > 500) rt.spawned.clear()
                            }
                            // Fixed-stage actors walk to object goals. Only the explicit walking mode can recall them.
                            if (followMe) motor.recall(hero.id, goal, RECALL_METRES)
                            val foot = motor.updateWithWalls(hero.id, goal, elapsed, { from, to -> walls.any { it.blocks(from, to) } }, speed) { query -> support(query) }
                                ?: return@mapNotNull null
                            val previous = rt.previousFeet.put(hero.id, foot)
                            val observedSpeed = if (previous != null && elapsed > 0.001f) kotlin.math.hypot(foot.x - previous.x, foot.z - previous.z) / elapsed else 0f
                            val moving = observedSpeed > 0.08f
                            val toGoal = kotlin.math.hypot(goal.x - foot.x, goal.z - foot.z)
                            val wantLift = if (spot != null && resting && toGoal < 0.12f) targetLift else 0f
                            val lift = (rt.motorLift[hero.id] ?: 0f).let { it + (wantLift - it) * kotlin.math.min(1f, elapsed * 5f) }
                            rt.motorLift[hero.id] = lift
                            val local = inverseOrigin.transformPoint(floatArrayOf(foot.x, foot.y + lift, foot.z))
                            // Contact shadow: at the feet when resting on an object, else on the measured support below.
                            val onObject = lift > 0.05f
                            val supportY = if (onObject) foot.y + lift else (support(foot) ?: foot.y).coerceAtMost(foot.y)
                            val shadowLocal = inverseOrigin.transformPoint(floatArrayOf(foot.x, supportY, foot.z))
                            // KayKit models face +Z (cape at -Z, toes/visor at +Z): face the walking direction, otherwise the camera.
                            val facing = if (moving && toGoal > 0.05f) floatArrayOf(goal.x - foot.x, 0f, goal.z - foot.z)
                                else floatArrayOf(camPose.tx() - foot.x, 0f, camPose.tz() - foot.z)
                            val localFacing = inverseOrigin.rotateVector(facing)
                            val clip = if (world.reducedMotion) "Idle" else presentedClip(hero.animation, moving, spot != null, lift > 0.05f)
                            val yaw = if (moving || hero.id !in rt.facing) TargetGoal.yaw(localFacing[0], localFacing[2]).also { rt.facing[hero.id] = it } else rt.facing.getValue(hero.id)
                            val rendered = if (clip == "Sit_Chair_Idle") SeatContact.root(FootPosition(local[0],local[1],local[2]),yaw) else FootPosition(local[0],local[1],local[2])
                            hero.id to HeroPose(Position(rendered.x, rendered.y, rendered.z), yaw, clip,
                                Position(shadowLocal[0], shadowLocal[1], shadowLocal[2]), if (onObject) 0f else foot.y + lift - supportY)
                        }.toMap()
                    } else if (anchor == null || anchor?.trackingState == TrackingState.STOPPED || world == null) {
                        contactFrame.clock.reset(); contactFrame.pose = null; motor.clear()
                        if (feet.isNotEmpty()) feet = emptyMap()
                    } else if (origin == null) {
                        // Brief tracking loss: keep the motor and last poses (hidden by AnchorNode); on
                        // reacquire the bodies are rebased from the old to the new anchor pose without a time jump.
                        contactFrame.clock.reset()
                    }
                },
                onSessionFailed = { error = "Room AR could not start: ${it.javaClass.simpleName}. Check Google Play Services for AR and device support. The local playground is available."; ar = false },
                onTouchEvent = { event, _ ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> touchStart = Triple(event.x, event.y, SystemClock.elapsedRealtime())
                        MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_CANCEL -> touchStart = null
                        MotionEvent.ACTION_UP -> {
                            val start = touchStart; touchStart = null
                            if (start != null && SystemClock.elapsedRealtime() - start.third < 500 && kotlin.math.hypot(event.x - start.first, event.y - start.second) < 20 * context.resources.displayMetrics.density) {
                                if (anchor == null || placementMode) pendingTap = event.x to event.y
                                else if (selectMode) pendingTargetTap = event.x to event.y
                            }
                        }
                    }
                    true
                }
            ) {
                // Real shadows: invisible shadow catchers on tracked floors/desks (only once placed, so they
                // never stack with the plane renderer's own receiver).
                if (shadowMode.real && anchor != null) shadowPlanes.forEach { plane -> key(plane) { ShadowReceiverPlane(plane = plane) } }
                anchor?.let { origin -> AnchorNode(anchor = origin) {
                    world?.let { CharacterWorld(it, feet, shadowMode.blob) { arCamera.worldPosition } }
                } }
                // Portal and props live in ARCore world space (top-level nodes), independent of the follow-me anchor.
                if (world != null && (portal != null || bursts.isNotEmpty())) NorthstarProps(portal, bursts, sceneClock) { arCamera.worldPosition }
            }
            // Compose overlays: never part of the SurfaceMirrorer broadcast/recording.
            if (anchor == null) ScanFloorOverlay(trackingOk, surfaces, followMe, Modifier.align(Alignment.Center))
            if (showBoxes && liveTracks.isNotEmpty()) DetectionOverlay(liveTracks, Modifier.fillMaxSize())
        } else {
            SceneView(Modifier.fillMaxSize(), engine = engine, modelLoader = modelLoader,
                materialLoader = materialLoader, cameraNode = camera, autoCenterContent = false,
                frameRatePolicy = FrameRatePolicy.OnDemand(maxFps = 30),
                renderQuality = RenderQuality.Performance,
                cameraManipulator = null, surfaceMirrorer = mirror,
                onTouchEvent = { event, _ ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { lastPreviewTouch = event.x to event.y; lastPreviewPinch = null }
                        MotionEvent.ACTION_POINTER_DOWN -> if (event.pointerCount >= 2) {
                            lastPreviewPinch = kotlin.math.hypot(event.getX(0) - event.getX(1), event.getY(0) - event.getY(1))
                        }
                        MotionEvent.ACTION_MOVE -> {
                            if (event.pointerCount >= 2) {
                                val distance = kotlin.math.hypot(event.getX(0) - event.getX(1), event.getY(0) - event.getY(1))
                                lastPreviewPinch?.takeIf { it > 1f }?.let { previewOrbit.zoom(distance / it) }
                                lastPreviewPinch = distance
                            } else {
                                lastPreviewTouch?.let { previewOrbit.drag(event.x - it.first, event.y - it.second) }
                                lastPreviewTouch = event.x to event.y
                            }
                            orbitRevision++
                        }
                        MotionEvent.ACTION_POINTER_UP -> { lastPreviewTouch = null; lastPreviewPinch = null }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { lastPreviewTouch = null; lastPreviewPinch = null }
                    }
                    true
                }) {
                val stageMaterial = remember(materialLoader) { materialLoader.createColorInstance(Color(0xff272238), roughness = .95f) }
                CubeNode(size = Size(2.2f, .035f, 1.5f), materialInstance = stageMaterial, position = Position(0f,-.03f,0f))
                world?.let { current ->
                    CharacterWorld(current) { camera.worldPosition }
                    current.raid?.takeIf { raidIsFresh(it.started,System.currentTimeMillis(),10_000) }?.let { raid ->
                        val started = remember(raid.id) { SystemClock.elapsedRealtime() }
                        NorthstarProps(PortalWorld(raid.id,"TEST RAID · ${raid.count} ARRIVALS",FootPosition(0f,.5f,-.25f),FootPosition(0f,0f,-.25f),0f,started),emptyList(),sceneClock) { camera.worldPosition }
                    }
                }
            }
        }
        RecoveryHud(
            ar = ar, placed = anchor != null, placing = placementMode, selecting = selectMode, tracking = trackingOk,
            status = when {
                !trackingOk -> "Move slowly · find a well-lit, textured surface"
                anchor == null -> if (surfaces == 0) "Scan a floor or table · move slowly side to side" else "Surface found · tap to place your characters"
                followMe -> "Walking mode · characters follow you"
                else -> "Stage locked · characters stay here when you walk away"
            },
            mode = if (!paired) "TEST RAID · 3 STUB VIEWERS" else if (world?.mode == "SIMULATOR") "TEST ROOM · ${world.heroes.size} PLAYERS" else if (state.authorized) "TWITCH ROOM" else "RECONNECTING",
            heroes = world?.heroes.orEmpty(), actor = selectedActor, target = selectedTarget, tracks = liveTracks,
            toast = toast ?: error.takeIf { it.isNotBlank() }?.let { it to false }, recording = clip.recording, relay = relay.active,
            onCamera = { if (ar) { clip.stop(); output.stop(); relay.stop() }; ar = !ar; error = "" },
            onSetup = { settingsOpen = true },
            onPlace = { placementMode = !placementMode; selectMode = false },
            onSelect = { selectMode = !selectMode; placementMode = false },
            onActor = { selectedActor = it },
            onTarget = { t ->
                if (rt.space[t.id] == null) toast = "${t.label} found · scan its surface or tap it to anchor" to false
                else { selectedTarget = t.id to t.label; selectMode = false }
            },
            onClearTarget = { selectedTarget = null }, onCommand = ::sendCommand,
            onRaid = ::startTestRaid,
            onChat = { controlsOpen = true }, onCapture = { outputPanel = false; capturePanel = true },
            testChat = testMessages.takeIf { !paired }, testRunning = testRunning, testDelivered = testDelivered,
            testTotal = playground.scenario.size, testHasRaid = localWorld.raid != null,
            onStopTest = { playground.pauseReplay(); testRunning = false }
        )
        if (debugOpen) DebugPanel(connection, localDebug, liveTracks, showBoxes, { showBoxes = it }, detectorOn, { detectorOn = it },
            { text, ok -> toast = text to ok }, Modifier.align(Alignment.CenterEnd).fillMaxWidth(.85f).fillMaxHeight(.55f),
            ArControls(occlusionOn, { occlusionOn = it }, lightMode, { lightMode = it }, shadowMode, { shadowMode = it }))
    }
    if (controlsOpen && !paired) TestChatSheet(playground.viewers, testMessages, testViewer,
        { id -> testViewer = id; selectedActor = playground.viewers.first { it.id == id }.characterId }, { controlsOpen = false },
        { viewerId, text ->
            val choices = liveTracks.filter { rt.space[it.id] != null } + listOfNotNull(selectedTarget?.takeIf { rt.space[it.first] != null }?.let { TrackView(it.first,it.second,TrackBox(0f,0f,1f,1f),1f,"tap") })
            val reply = playground.send(viewerId, text, selectedTarget?.first, choices, System.currentTimeMillis())
            localWorld = playground.world; testMessages = playground.messages; toast = reply.text to reply.ok
        })
    else if (controlsOpen) CommandSheet(world?.heroes?.firstOrNull { it.id == selectedActor }?.name ?: world?.heroes?.firstOrNull()?.name ?: "your character",
        selectedTarget?.second, { controlsOpen = false }, ::sendCommand)
    if (settingsOpen) AlertDialog(onDismissRequest = { settingsOpen = false }, title = { Text("Your room") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (paired) state.message else "Test raid replays three stub viewers' messages on this phone. You are the streamer: place a stage, tap Test raid, and watch. Pair a room for real Twitch viewers.", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = { settingsOpen = false; pairingPanel = true }, modifier = Modifier.fillMaxWidth()) { Text(if (paired) "Manage paired room" else "Connect Twitch room") }
            if (state.pairingRequested && testRoom) OutlinedButton(onClick = {
                playground.pauseReplay(); rt.portal = null; runCatching { rt.portalAnchor?.detach() }; rt.portalAnchor = null; rt.portalStage = null
                rt.seenRaid = NorthstarRuntime.UNSET; portal = null; motor.clear(); feet = emptyMap()
                testRoom = false; settingsOpen = false
            }) { Text("Return to paired room") }
            OutlinedButton(enabled = !ar || anchor != null, onClick = { settingsOpen = false; startTestRaid() }) { Text("Start 3-viewer test raid") }
            if (paired) TextButton(onClick = { connection.disconnect(); selectedActor = null; settingsOpen = false }) { Text("Switch to test raid / fake chat") }
            Row(verticalAlignment = Alignment.CenterVertically) { Switch(showBoxes, { showBoxes = it }); Spacer(Modifier.width(8.dp)); Text("Show detected objects") }
            Row(verticalAlignment = Alignment.CenterVertically) { Switch(detectorOn, { detectorOn = it }); Spacer(Modifier.width(8.dp)); Text("Recognize objects on this phone") }
            Row(verticalAlignment = Alignment.CenterVertically) { Switch(followMe, { followMe = it }); Spacer(Modifier.width(8.dp)); Text("Walking mode · characters follow") }
            Text(if (followMe) "Characters follow the camera. Beyond 5 m behind, they can reappear near you." else "Fixed stage: walking away leaves the characters here. Look back to see them again. The stage lasts for this AR session.", style = MaterialTheme.typography.bodySmall)
            if (depthSupported) Row(verticalAlignment = Alignment.CenterVertically) { Switch(occlusionOn, { occlusionOn = it }); Spacer(Modifier.width(8.dp)); Text("Depth occlusion · experimental") }
            Text("Tap once to place a stage. Use Select target to choose an object or the exact surface to sit on.", style = MaterialTheme.typography.bodySmall)
            if (ar && anchor != null) OutlinedButton(onClick = { placementMode = true; selectMode = false; settingsOpen = false }) { Text("Move stage") }
            TextButton(onClick = { settingsOpen = false; debugOpen = !debugOpen }) { Text("Diagnostics") }
        }
    }, confirmButton = { TextButton(onClick = { settingsOpen = false }) { Text("Done") } })
    if (labelTarget != null) AlertDialog(onDismissRequest = { labelTarget = null }, title = { Text("Target selected") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Name this surface so chat can refer to it. The target stays at the measured position.")
            OutlinedTextField(selectedLabel, { selectedLabel = it.take(40) }, label = { Text("Target name") }, singleLine = true)
            Row(Modifier.horizontalScroll(rememberScrollState())) { listOf("chair", "table", "sofa", "surface").forEach { label -> TextButton(onClick = { selectedLabel = label }) { Text(label) } } }
        }
    }, confirmButton = { TextButton(onClick = {
        val id = labelTarget
        val label = selectedLabel.trim().lowercase(java.util.Locale.ROOT).take(40).ifBlank { "surface" }
        if (id != null) { rt.manualTargets[id]?.label = label; selectedTarget = id to label }
        labelTarget = null; toast = "$label anchored · choose Sit here or a command" to true
    }) { Text("Use target") } }, dismissButton = { TextButton(onClick = { labelTarget = null }) { Text("Keep as surface") } })
    if (capturePanel) AlertDialog(onDismissRequest = { capturePanel = false }, title = { Text("Capture your world") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (ar) "Camera and characters are captured. App controls stay out of the video." else "Camera is off · capture records the local 3D scene.")
            Text(clip.message, style = MaterialTheme.typography.bodySmall)
            if (clip.file != null && !clip.recording) {
                Button(onClick = { clip.stop(); output.stop(); relay.stop(); ar = false; capturePanel = false; reviewClip = true }) { Text("Review clip") }
                OutlinedButton(onClick = { runCatching { clip.share() }.onFailure { error = "No sharing app available" } }) { Text("Share clip") }
                TextButton(onClick = { clip.discard() }) { Text("Discard clip") }
            } else Button(enabled = !output.active && !relay.active && world != null && (!ar || anchor?.trackingState == TrackingState.TRACKING), onClick = {
                if (clip.recording) clip.stop() else runCatching { clip.start() }.onFailure { error = it.message ?: "Recording unavailable" }
                capturePanel = false
            }) { Text(if (clip.recording) "Stop recording" else "Record 20-second clip") }
            OutlinedButton(enabled = relay.active || !clip.recording && !output.active, onClick = { capturePanel = false; if (relay.active) relay.stop() else relayPanel = true }) { Text(if (relay.active) "Stop broadcast" else "Broadcast to OBS / relay") }
            if (relay.active && relay.microphone) Row(verticalAlignment = Alignment.CenterVertically) { Switch(microphoneMuted, { microphoneMuted = it; relay.mute(it) }); Text("Mute microphone") }
            Text("Clips are silent and saved on this phone. Review before sharing.", style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { TextButton(onClick = { capturePanel = false }) { Text("Close") } })

    if (pairingPanel) AlertDialog(
        onDismissRequest = { pairingPanel = false }, title = { Text("Pair your room") },
        text = { Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (BuildConfig.DEBUG) "Creator Studio → camera pairing. Debug build: server URL and token are remembered on this phone." else "Creator Studio → camera pairing. Token stays in memory.")
            Text("While room AR and recognition are on, this server receives object labels and small camera JPEGs for named-object lookup. Use the local playground to keep all processing on this phone.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(server, { server = it }, label = { Text("HTTPS server URL") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (BuildConfig.DEBUG) OutlinedButton(enabled = !quickPairing, onClick = {
                quickPairing = true; error = ""
                connection.quickPair(server) { failure ->
                    quickPairing = false
                    if (failure == null) { clip.stop(); output.stop(); relay.stop(); playground.pauseReplay(); testRoom = false; token = ""; error = ""; pairingPanel = false } else error = failure
                }
            }) { Text(if (quickPairing) "Pairing…" else "Quick pair (test server)") }
            OutlinedTextField(token, { token = it }, label = { Text("Camera pairing token") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = { runCatching { connection.connect(server, token) }.onSuccess { clip.stop(); output.stop(); relay.stop(); playground.pauseReplay(); testRoom = false; token = ""; error = ""; pairingPanel = false }.onFailure { error = it.message ?: "Pairing failed" } }) { Text("Connect") } },
        dismissButton = { Row {
            if (paired) TextButton(onClick = { clip.stop(); output.stop(); relay.stop(); connection.disconnect(); ar = false; outputConsent = false; token = ""; pairingPanel = false }) { Text("Disconnect") }
            TextButton(onClick = { pairingPanel = false }) { Text("Cancel") }
        } }
    )
    if (relayPanel) AlertDialog(
        onDismissRequest = { relayPanel = false }, title = { Text("Broadcast to your relay") },
        text = { Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (ar) "Sends the camera + 3D characters to your existing relay or cloud OBS." else "Camera is off. This broadcasts only the 3D preview for a private setup test.")
            Text("720p30 H.264 · SRT or RTMPS/RTMP · no SRTLA bonding. Plain SRT/RTMP are not automatically encrypted.", style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(relayUrl, { relayUrl = it.take(4096) }, label = { Text("Private ingest URL") },
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(), singleLine = true)
            Text("SRT URL options follow OBS/FFmpeg: latency in microseconds, pbkeylen in bytes. Example: latency=200000 means 200 ms.", style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = includeMicrophone, onCheckedChange = {
                    if (it) microphonePermission.launch(Manifest.permission.RECORD_AUDIO) else includeMicrophone = false
                })
                Text("Include microphone audio")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = relayConsent, onCheckedChange = { relayConsent = it })
                Text("Allow this view and visible names to be sent")
            }
            Text(relay.status, style = MaterialTheme.typography.bodySmall)
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
            TextButton(enabled = paired && !clip.recording, onClick = { relayPanel = false; outputPanel = true }) { Text("Experimental LAN WebRTC instead") }
        } },
        confirmButton = { TextButton(enabled = relayConsent && world != null && !clip.recording && !output.active && (!ar || anchor?.trackingState == TrackingState.TRACKING), onClick = {
            runCatching { RelayEndpoint.parse(relayUrl); relay.start(relayUrl, includeMicrophone) }
                .onSuccess { if (relay.active) { relayPanel = false; microphoneMuted = false; error = "" } else error = relay.status }
                .onFailure { error = it.message ?: "Invalid ingest configuration" }
        }) { Text("Start broadcast") } },
        dismissButton = { TextButton(onClick = { relayPanel = false }) { Text("Cancel") } }
    )
    if (outputPanel) AlertDialog(
        onDismissRequest = { outputPanel = false }, title = { Text("Experimental LAN output") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Open Creator Studio's paired receiver in OBS. Camera + characters + visible names will be sent to it. No audio or recording is included. Direct LAN only; phone validation is still pending.")
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked = outputConsent, onCheckedChange = { outputConsent = it }); Text("Allow this view to be shared") }
            Text(output.status, style = MaterialTheme.typography.bodySmall)
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(enabled = outputConsent && ar && visibleWorld != null && anchor?.trackingState == TrackingState.TRACKING && !clip.recording, onClick = {
            runCatching { connection.startOutput(output) }.onSuccess { if (output.active) { outputPanel = false; error = "" } else error = output.status }.onFailure { error = it.message ?: "Output unavailable" }
        }) { Text("Start sharing") } },
        dismissButton = { TextButton(onClick = { outputPanel = false }) { Text("Cancel") } }
    )
    val recorded = clip.file
    if (reviewClip && recorded != null) AlertDialog(
        onDismissRequest = { reviewClip = false }, title = { Text("Review local clip · no audio") },
        text = { AndroidView(modifier = Modifier.fillMaxWidth().height(230.dp), factory = { currentContext ->
            VideoView(currentContext).apply {
                setMediaController(MediaController(currentContext).also { it.setAnchorView(this) })
                setVideoPath(recorded.absolutePath)
                setOnPreparedListener { player -> player.isLooping = true; start() }
                setOnErrorListener { _, _, _ -> error = "This clip could not be decoded. You can discard it."; reviewClip = false; true }
            }
        }, onRelease = { it.stopPlayback() }) },
        confirmButton = { TextButton(onClick = { reviewClip = false }) { Text("Close") } }
    )
}

@Composable
private fun SceneScope.CharacterWorld(world: NativeWorld, feet: Map<String, HeroPose>? = null, blobShadows: Boolean = true, cameraPosition: () -> Position) {
    SideEffect {
        if (BuildConfig.DEBUG && world.mode == "SIMULATOR") android.util.Log.d("RaidRiftScene", world.heroes.take(3).joinToString { "${it.id.take(8)}:${it.x}:${it.animation}" })
    }
    if (world.mode.startsWith("LOCAL") || world.mode == "SIMULATOR") TextNode(text = if (world.mode == "SIMULATOR") "TEST ROOM" else "TEST RAID", position = Position(0f, .035f, .45f), widthMeters = .32f, heightMeters = .035f, cameraPositionProvider = cameraPosition)
    world.heroes.take(12).forEach { hero -> key(hero.id) {
        val models = listOf("Knight", "Mage", "Rogue", "Barbarian")
        val index = hero.id.fold(0u) { hash, char -> hash * 31u + char.code.toUInt() }.rem(4u).toInt()
        val instance = rememberModelInstance(modelLoader, assetFileLocation = "kaykit/${models[index]}.glb")
        val pose = feet?.get(hero.id)
        val position = pose?.position ?: Position((hero.x - 0.5f) * 1.4f, 0f, (hero.y - 0.5f) * 1.0f)
        val visible = feet == null || pose != null
        // SceneView's procedural ContactShadow (contact_shadow material: alpha gradient, depth-tested):
        // a soft pool on the support under the feet that widens and fades with height above it.
        if (blobShadows && visible) {
            val airborne = pose?.airborne ?: 0f
            val at = pose?.shadow ?: position.copy(y = 0f)
            ContactShadow(size = Size(BlobShadow.SIZE, 0f, BlobShadow.SIZE), context = ContactShadowContext.Floor, normal = Direction(0f, 1f, 0f),
                intensity = BlobShadow.intensity(airborne), position = Position(at.x, at.y + 0.008f, at.z), scale = Scale(BlobShadow.scale(airborne)))
        }
        Node(position = position, rotation = Rotation(0f, pose?.yaw ?: 0f, 0f), isVisible = visible) {
            // ~30 cm tall. Uses the GLB's own origin (feet) and a fixed scale. Not scaleToUnits/centerOrigin:
            // those fit the bounding box (hats, capes, T-pose arms), so size and pivot varied per hero.
            instance?.let { ModelNode(modelInstance = it, autoAnimate = false,
                animationName = pose?.clip ?: if (world.reducedMotion) "Idle" else characterClip(hero.animation),
                animationSpeed = if (world.reducedMotion) 0.25f else 1f,
                scale = Scale(CHARACTER_HEIGHT_METRES / KAYKIT_BODY_HEIGHT_UNITS),
                rotation = Rotation(0f, 0f, 0f)) }
            TextNode(text = hero.name, position = Position(0f, CHARACTER_HEIGHT_METRES + 0.06f, 0f), widthMeters = 0.28f, heightMeters = 0.06f, cameraPositionProvider = cameraPosition)
            if (hero.message.isNotBlank()) TextNode(text = hero.message.take(60), position = Position(0f, CHARACTER_HEIGHT_METRES + 0.15f, 0f), widthMeters = 0.46f, heightMeters = 0.065f, cameraPositionProvider = cameraPosition)
        }
    } }
}

internal fun characterClip(action: String): String = when (action) {
    "walk", "navigate", "follow", "follow_track" -> "Walking_A"
    "run", "sprint" -> "Running_A"
    "sit" -> "Sit_Floor_Idle"
    "sleep", "lie" -> "Lie_Idle"
    "wave", "cheer", "dance" -> "Cheer"
    "jump" -> "Jump_Full_Short"
    "attack", "punch" -> "Unarmed_Melee_Attack_Punch_A"
    "interact", "build" -> "Interact"
    else -> "Idle"
}

private fun poseMatrix(p: RigidPose): FloatArray = FloatArray(16).also {
    Pose(floatArrayOf(p.tx, p.ty, p.tz), floatArrayOf(p.qx, p.qy, p.qz, p.qw)).toMatrix(it, 0)
}
