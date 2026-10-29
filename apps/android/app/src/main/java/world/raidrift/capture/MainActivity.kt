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
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import com.google.ar.core.Config
import com.google.ar.core.Plane
import com.google.ar.core.Pose
import com.google.ar.core.TrackingState
import io.github.sceneview.*
import io.github.sceneview.ar.*
import io.github.sceneview.ar.scene.SceneUnderstanding
import io.github.sceneview.ar.physics.DepthCollider
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

private class ContactFrame(var timestamp: Long = 0, var pose: Pose? = null)
private class ArFrameDiagnostics(var timestamp: Long = 0, var frames: Int = 0, var since: Long = 0)

@Composable
private fun CaptureApp(connection: WorldConnection) {
    val state by connection.state.collectAsStateWithLifecycle()
    var server by remember { mutableStateOf(if (BuildConfig.DEBUG) "http://127.0.0.1:3400" else "") }
    var token by remember { mutableStateOf("") }
    val paired = state.pairingRequested
    var pairingPanel by remember { mutableStateOf(false) }
    var outputPanel by remember { mutableStateOf(false) }
    var reviewClip by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var ar by remember { mutableStateOf(false) }
    var anchor by remember { mutableStateOf<Anchor?>(null) }
    var pendingTap by remember { mutableStateOf<Pair<Float, Float>?>(null) }
    var tracking by remember { mutableStateOf("Camera is off · orbit the 3D preview with one finger") }
    var depth by remember { mutableStateOf("Depth not started") }
    var depthSupported by remember { mutableStateOf(false) }
    var lastDepthCheck by remember { mutableLongStateOf(0) }
    var surfaces by remember { mutableIntStateOf(0) }
    val motor = remember { SurfaceMotor() }
    var feet by remember { mutableStateOf<Map<String, Position>>(emptyMap()) }
    var depthCollider by remember { mutableStateOf<DepthCollider?>(null) }
    val contactFrame = remember { ContactFrame() }
    val arDiagnostics = remember { ArFrameDiagnostics() }
    // Keep the callback stable: changing it asks SceneView to reconfigure ARCore.
    // Ambient estimation avoids rebuilding HDR cubemaps during a live mobile feed.
    val configureArSession = remember {
        { _: com.google.ar.core.Session, config: Config ->
            config.lightEstimationMode = Config.LightEstimationMode.AMBIENT_INTENSITY
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
    var relayPanel by remember { mutableStateOf(false) }
    var relayUrl by remember { mutableStateOf("") }
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
                clip.stop(); output.stop(); relay.stop(); connection.pause(); ar = false; reviewClip = false
                relayConsent = false; includeMicrophone = false; microphoneMuted = false
            } else if (event == Lifecycle.Event.ON_START) connection.resume()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); clip.stop(); output.dispose(); relay.stop() }
    }
    DisposableEffect(anchor) { val current = anchor; onDispose { current?.detach() } }
    LaunchedEffect(anchor) { motor.clear(); feet = emptyMap(); contactFrame.timestamp = 0; contactFrame.pose = null }
    LaunchedEffect(ar) { if (!ar) { anchor = null; pendingTap = null; clip.stop(); output.stop(); relay.stop() } }
    LaunchedEffect(clip.recording) { if (clip.recording) { delay(20_000); clip.stop() } }
    val visibleWorld = state.world?.takeIf { state.authorized && !it.paused }
    LaunchedEffect(visibleWorld == null, paired) { if (paired && visibleWorld == null) { clip.stop(); output.stop(); relay.stop(); ar = false } }
    val preview = NativeWorld("local", "LOCAL PREVIEW", false, false,
        listOf(Hero("preview-knight", "3D preview", 0.5f, 0.5f, "idle")), null)
    val world = if (paired) visibleWorld else preview

    Box(Modifier.fillMaxSize().background(Color(0xff10121c))) {
        if (ar) {
            ARSceneView(
                modifier = Modifier.fillMaxSize(), engine = engine, modelLoader = modelLoader,
                materialLoader = materialLoader, cameraNode = arCamera, surfaceMirrorer = mirror,
                depthMode = Config.DepthMode.AUTOMATIC,
                planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL,
                sessionConfiguration = configureArSession,
                // Use ARCore's camera default rather than SceneView's recording-oriented
                // highest-resolution selector; reserve the device budget for tracking.
                sessionCameraConfig = null,
                renderQuality = RenderQuality.Performance,
                sceneUnderstanding = SceneUnderstanding(occlusion = depthSupported, lighting = true, planeVisualization = anchor == null),
                onSessionCreated = { session ->
                    if (BuildConfig.DEBUG) android.util.Log.d("RaidRiftAR", "config planes=${session.config.planeFindingMode} light=${session.config.lightEstimationMode} update=${session.config.updateMode}")
                    depthSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
                    depth = if (depthSupported) "Depth supported · waiting for frames" else "Depth unavailable · anchors only"
                },
                onSessionUpdated = { session, frame ->
                    if (frame.timestamp != arDiagnostics.timestamp) { arDiagnostics.timestamp = frame.timestamp; arDiagnostics.frames++ }
                    val tracked = frame.camera.trackingState == TrackingState.TRACKING
                    val anchorTracked = anchor == null || anchor?.trackingState == TrackingState.TRACKING
                    if (!tracked || !anchorTracked) {
                        clip.stop()
                        if (output.active) output.stop("Tracking lost · sharing stopped")
                        if (relay.active) relay.stop("Tracking lost · relay output stopped")
                    }
                    tracking = if (!tracked) {
                        val reason = frame.camera.trackingFailureReason.name.lowercase().replace('_', ' ')
                        if (reason == "none") "Camera tracking paused · move slowly" else "Camera tracking paused · $reason · move slowly"
                    } else if (!anchorTracked) {
                        if (anchor?.trackingState == TrackingState.STOPPED) "Room anchor lost · reset placement" else "Room anchor tracking paused · move slowly to relocalize"
                    } else if (anchor == null) {
                        if (surfaces == 0) "Tracking ready · move slowly to detect a desk or floor" else "$surfaces surfaces detected · tap a desk or floor"
                    } else "Room anchor placed · tap another surface to move"
                    pendingTap?.let { point ->
                        pendingTap = null
                        if (tracked) {
                            val hit = frame.hitTest(point.first, point.second).firstOrNull { hit ->
                                val plane = hit.trackable as? Plane
                                plane != null && plane.trackingState == TrackingState.TRACKING && plane.subsumedBy == null && plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING && plane.isPoseInPolygon(hit.hitPose)
                            }
                            if (BuildConfig.DEBUG) android.util.Log.d("RaidRiftAR", "surfaceTap planes=$surfaces hit=${hit != null}")
                            if (hit == null) error = "No detected floor or desk at that point. Keep scanning, then tap a detected surface."
                            else runCatching { hit.createAnchor() }.onSuccess { anchor = it; error = "" }.onFailure { error = "Surface could not be anchored. Try again." }
                        }
                    }
                    if (SystemClock.elapsedRealtime() - lastDepthCheck > 1000) {
                        lastDepthCheck = SystemClock.elapsedRealtime()
                        surfaces = session.getAllTrackables(Plane::class.java).count { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
                        if (BuildConfig.DEBUG) {
                            val points = runCatching { frame.acquirePointCloud().use { it.points.remaining() / 4 } }.getOrDefault(0)
                            val elapsed = (lastDepthCheck - arDiagnostics.since).coerceAtLeast(1)
                            android.util.Log.d("RaidRiftAR", "frame state=${frame.camera.trackingState} floors=$surfaces points=$points imageFps=${arDiagnostics.frames * 1000L / elapsed} anchor=${anchor?.trackingState} previousFeet=${feet.size}")
                            arDiagnostics.frames = 0; arDiagnostics.since = lastDepthCheck
                        }
                        if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depth = runCatching { frame.acquireDepthImage16Bits().use { "Depth frames available · occlusion enabled" } }.getOrDefault("Depth supported · no current depth frame")
                    }
                    val origin = anchor?.takeIf { tracked && it.trackingState == TrackingState.TRACKING }?.pose
                    if (origin != null && world != null) {
                        val observed = session.getAllTrackables(Plane::class.java).filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null }.take(64)
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
                        val elapsed = if (contactFrame.timestamp == 0L) 0f else (frame.timestamp - contactFrame.timestamp) / 1_000_000_000f
                        contactFrame.timestamp = frame.timestamp
                        contactFrame.pose?.let { previous ->
                            val inverse = previous.inverse()
                            runCatching { motor.rebase { point ->
                                val local = inverse.transformPoint(floatArrayOf(point.x, point.y, point.z))
                                val mapped = origin.transformPoint(local)
                                FootPosition(mapped[0], mapped[1], mapped[2])
                            } }.onFailure { motor.clear() }
                        }
                        contactFrame.pose = origin
                        motor.retain(world.heroes.take(12).map { it.id }.toSet())
                        feet = world.heroes.take(12).mapNotNull { hero ->
                            val goal = origin.transformPoint(floatArrayOf((hero.x - 0.5f) * 1.4f, 0f, (hero.y - 0.5f)))
                            val foot = motor.updateWithWalls(hero.id, FootPosition(goal[0], goal[1], goal[2]), elapsed, { from, to -> walls.any { it.blocks(from, to) } }) { query ->
                                val measured = planes.mapNotNull { plane ->
                                    val height = plane.centerPose.ty()
                                    val sample = com.google.ar.core.Pose.makeTranslation(query.x, height, query.z)
                                    height.takeIf { it <= query.y + 0.035f && plane.isPoseInPolygon(sample) }
                                }.maxOrNull()
                                val collider = depthCollider
                                val recentDepth = collider?.takeIf { System.currentTimeMillis() - it.lastRebuildTimestampMs in 0..500 }
                                    ?.floorYAt(query.x, query.y + 0.035f, query.z, 0f)
                                listOfNotNull(measured, recentDepth).maxOrNull()
                            } ?: return@mapNotNull null
                            val local = origin.inverse().transformPoint(floatArrayOf(foot.x, foot.y, foot.z))
                            hero.id to Position(local[0], local[1], local[2])
                        }.toMap()
                    } else {
                        contactFrame.timestamp = 0; contactFrame.pose = null; motor.clear()
                        if (feet.isNotEmpty()) feet = emptyMap()
                    }
                },
                onSessionFailed = { error = "ARCore could not start: ${it.javaClass.simpleName}. Check Google Play Services for AR and device support." },
                onTouchEvent = { event, _ ->
                    if (event.action == MotionEvent.ACTION_UP) pendingTap = event.x to event.y
                    true
                }
            ) {
                if (depthSupported) {
                    val collider = rememberDepthCollider(refreshIntervalMs = 200, stride = 8)
                    SideEffect { depthCollider = collider }
                    DisposableEffect(collider) { onDispose { depthCollider = null } }
                }
                anchor?.let { origin -> AnchorNode(anchor = origin) {
                    world?.let { CharacterWorld(it, feet) { arCamera.worldPosition } }
                } }
            }
        } else {
            SceneView(Modifier.fillMaxSize(), engine = engine, modelLoader = modelLoader,
                materialLoader = materialLoader, cameraNode = camera, autoCenterContent = false,
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
                world?.let { CharacterWorld(it) { camera.worldPosition } }
            }
        }
        Column(Modifier.align(Alignment.TopCenter).statusBarsPadding().fillMaxWidth()
            .background(Color(0xdc10121c)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("RaidRift · characters in your room", style = MaterialTheme.typography.titleMedium)
            Text(if (ar) "ROOM AR" else "3D PREVIEW · CAMERA OFF", style = MaterialTheme.typography.labelSmall)
            Text(state.message, style = MaterialTheme.typography.bodySmall)
            if (BuildConfig.DEBUG && world?.mode == "SIMULATOR") {
                Text(world.heroes.take(3).joinToString(" · ") { "${it.name}: ${it.animation} x=${"%.2f".format(java.util.Locale.ROOT, it.x)}" }, style = MaterialTheme.typography.labelSmall)
            }
            if (state.world?.paused == true) Text("Streamer paused the world · characters hidden")
            if (ar) { Text(tracking, style = MaterialTheme.typography.bodySmall); Text(depth, style = MaterialTheme.typography.bodySmall) }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = ar || !paired || visibleWorld != null, onClick = { clip.stop(); output.stop(); relay.stop(); ar = !ar; error = "" }) { Text(if (ar) "Exit AR" else "Start room AR") }
                OutlinedButton(onClick = { pairingPanel = true }) { Text("Pair room") }
                if (anchor != null) TextButton(onClick = { clip.stop(); output.stop(); relay.stop(); anchor = null }) { Text("Reset") }
            }
        }
        Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().fillMaxWidth()
            .background(Color(0xdc10121c)).heightIn(max = 190.dp).verticalScroll(rememberScrollState()).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (relay.active) "${relay.status} · ${relay.bitrate / 1000} kbps" else if (output.active || outputConsent) output.status else if (relay.attempted && !clip.recording && clip.file == null) relay.status else clip.message, style = MaterialTheme.typography.bodySmall)
            Text("Camera footage + viewer names · review clips before sharing", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!clip.recording && clip.file != null) {
                    TextButton(onClick = { output.stop(); relay.stop(); ar = false; reviewClip = true }) { Text("Review") }
                    TextButton(onClick = { runCatching { clip.share() }.onFailure { error = "No video sharing app available" } }) { Text("Share") }
                    TextButton(onClick = { clip.discard() }) { Text("Discard") }
                } else {
                    Button(enabled = !output.active && !relay.active && world != null && (!ar || anchor?.trackingState == TrackingState.TRACKING),
                        onClick = { if (clip.recording) clip.stop() else runCatching { clip.start() }.onFailure { error = it.message ?: "Recording unavailable" } }) { Text(if (clip.recording) "Stop recording" else "Record 20s") }
                    OutlinedButton(onClick = { if (relay.active) relay.stop() else relayPanel = true }, enabled = relay.active || !clip.recording && !output.active && world != null) { Text(if (relay.active) "Stop relay" else "Broadcast") }
                }
            }
            if (relay.active && relay.microphone) Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = microphoneMuted, onCheckedChange = { microphoneMuted = it; relay.mute(it) })
                Text("Mute microphone", style = MaterialTheme.typography.bodySmall)
            }
            if (relay.active) Box {
                TextButton(onClick = { qualityMenu = true }) { Text("Adjust video bitrate") }
                DropdownMenu(expanded = qualityMenu, onDismissRequest = { qualityMenu = false }) {
                    listOf(1000, 1500, 2500, 4000).forEach { value ->
                        DropdownMenuItem(text = { Text("$value kbps") }, onClick = { relay.setQuality(value); qualityMenu = false })
                    }
                }
            }
            Text("25 cm 3D characters · up to 12 visible · measured floor and detected wall contact", style = MaterialTheme.typography.bodySmall)
        }
    }
    if (pairingPanel) AlertDialog(
        onDismissRequest = { pairingPanel = false }, title = { Text("Pair your room") },
        text = { Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Creator Studio → camera pairing. Token stays in memory.")
            OutlinedTextField(server, { server = it }, label = { Text("HTTPS server URL") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(token, { token = it }, label = { Text("Camera pairing token") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        } },
        confirmButton = { TextButton(onClick = { runCatching { connection.connect(server, token) }.onSuccess { clip.stop(); output.stop(); relay.stop(); token = ""; error = ""; pairingPanel = false }.onFailure { error = it.message ?: "Pairing failed" } }) { Text("Connect") } },
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
private fun SceneScope.CharacterWorld(world: NativeWorld, feet: Map<String, Position>? = null, cameraPosition: () -> Position) {
    SideEffect {
        if (BuildConfig.DEBUG && world.mode == "SIMULATOR") android.util.Log.d("RaidRiftScene", world.heroes.take(3).joinToString { "${it.id.take(8)}:${it.x}:${it.animation}" })
    }
    TextNode(text = "RAIDRIFT · ${world.mode}", position = Position(0f, 0.55f, 0f), widthMeters = 0.9f, heightMeters = 0.1f, cameraPositionProvider = cameraPosition)
    world.heroes.take(12).forEach { hero -> key(hero.id) {
        val models = listOf("Knight", "Mage", "Rogue", "Barbarian")
        val index = hero.id.fold(0u) { hash, char -> hash * 31u + char.code.toUInt() }.rem(4u).toInt()
        val instance = rememberModelInstance(modelLoader, assetFileLocation = "kaykit/${models[index]}.glb")
        val position = feet?.get(hero.id) ?: Position((hero.x - 0.5f) * 1.4f, 0f, (hero.y - 0.5f) * 1.0f)
        Node(position = position, isVisible = feet == null || hero.id in feet) {
            instance?.let { ModelNode(modelInstance = it, autoAnimate = false,
                animationName = if (world.reducedMotion) "Idle" else characterClip(hero.animation),
                animationSpeed = if (world.reducedMotion) 0.25f else 1f,
                scaleToUnits = 0.25f, centerOrigin = Position(0f, -1f, 0f),
                rotation = Rotation(0f, 0f, 0f)) }
            TextNode(text = hero.name, position = Position(0f, 0.3f, 0f), widthMeters = 0.28f, heightMeters = 0.06f, cameraPositionProvider = cameraPosition)
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
