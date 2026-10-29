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
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
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

/** Debug-build defaults for the owner's Tailscale test setup. */
private const val DEBUG_SERVER = "https://raidrift-pc.tail7252b4.ts.net"
private const val DEBUG_RELAY = "rtmp://raidrift-pc.tail7252b4.ts.net:1935/live/raidrift"

/** Follow-me: re-anchor once the streamer is this far from the anchor. */
private const val REANCHOR_METRES = 6f
/** Follow-me: an actor this far behind its goal re-enters at the goal. */
private const val RECALL_METRES = 5f

private class ContactFrame(var timestamp: Long = 0, var pose: Pose? = null)
private class ArFrameDiagnostics(var timestamp: Long = 0, var frames: Int = 0, var since: Long = 0)

@Composable
private fun CaptureApp(connection: WorldConnection) {
    val state by connection.state.collectAsStateWithLifecycle()
    var server by remember { mutableStateOf(if (BuildConfig.DEBUG) connection.savedServer ?: DEBUG_SERVER else "") }
    var token by remember { mutableStateOf("") }
    val paired = state.pairingRequested
    var pairingPanel by remember { mutableStateOf(false) }
    var quickPairing by remember { mutableStateOf(false) }
    var outputPanel by remember { mutableStateOf(false) }
    var reviewClip by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var ar by remember { mutableStateOf(false) }
    var followMe by remember { mutableStateOf(true) }
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
    var showBoxes by remember { mutableStateOf(BuildConfig.DEBUG) }
    var detectorOn by remember { mutableStateOf(true) }
    var localDebug by remember { mutableStateOf(LocalDebug()) }
    var arFps by remember { mutableFloatStateOf(0f) }
    var propsNote by remember { mutableStateOf("") }
    var toast by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    LaunchedEffect(toast) { if (toast != null) { delay(5000); toast = null } }
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
                clip.stop(); output.stop(); relay.stop(); connection.pause(); ar = false; reviewClip = false
                relayConsent = false; includeMicrophone = false; microphoneMuted = false
            } else if (event == Lifecycle.Event.ON_START) connection.resume()
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); clip.stop(); output.dispose(); relay.stop() }
    }
    DisposableEffect(anchor) { val current = anchor; onDispose { current?.detach() } }
    LaunchedEffect(anchor) { motor.clear(); feet = emptyMap(); contactFrame.timestamp = 0; contactFrame.pose = null }
    LaunchedEffect(ar) { if (!ar) { anchor = null; pendingTap = null; clip.stop(); output.stop(); relay.stop(); rt.reset(); liveTracks = emptyList(); portal = null; rt.portal = null; bursts = emptyList(); rt.bursts = emptyList() } }
    LaunchedEffect(clip.recording) { if (clip.recording) { delay(20_000); clip.stop() } }
    val visibleWorld = state.world?.takeIf { state.authorized && !it.paused }
    // Only a rejected/revoked pairing stops output. A paused world or a network
    // blip hides characters but keeps the streamer's camera live.
    LaunchedEffect(state.revoked) { if (state.revoked) { clip.stop(); output.stop(); relay.stop(); ar = false } }
    val preview = NativeWorld("local", "LOCAL PREVIEW", false, false,
        listOf(Hero("preview-knight", "3D preview", 0.5f, 0.5f, "idle")), null)
    val world = if (paired) visibleWorld else preview

    Box(Modifier.fillMaxSize().background(Color(0xff10121c)).onSizeChanged { viewSize = it.width to it.height }) {
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
                    // Tracking loss only hides the characters (feet are cleared below).
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
                    else "Room anchor placed · tap another surface to move"
                    fun floorHit(x: Float, y: Float) = frame.hitTest(x, y).firstOrNull { hit ->
                        val plane = hit.trackable as? Plane
                        plane != null && plane.trackingState == TrackingState.TRACKING && plane.subsumedBy == null && plane.type == Plane.Type.HORIZONTAL_UPWARD_FACING && plane.isPoseInPolygon(hit.hitPose)
                    }
                    pendingTap?.let { point ->
                        pendingTap = null
                        if (tracked) {
                            val hit = floorHit(point.first, point.second)
                            if (BuildConfig.DEBUG) android.util.Log.d("RaidRiftAR", "surfaceTap planes=$surfaces hit=${hit != null}")
                            if (hit == null) error = "No detected floor or desk at that point. Keep scanning, then tap a detected surface."
                            else runCatching { hit.createAnchor() }.onSuccess { anchor = it; error = "" }.onFailure { error = "Surface could not be anchored. Try again." }
                        }
                    }
                    // Follow-me: no tap needed. Anchor on the ground ahead, and re-anchor
                    // when the streamer walks away from it or ARCore drops it.
                    if (followMe && tracked && viewSize.first > 0 && SystemClock.elapsedRealtime() - lastAutoPlace > 500) {
                        val camPose = frame.camera.pose
                        val current = anchor
                        val needsAnchor = current == null || current.trackingState == TrackingState.STOPPED ||
                            kotlin.math.hypot(current.pose.tx() - camPose.tx(), current.pose.tz() - camPose.tz()) > REANCHOR_METRES
                        if (needsAnchor) {
                            lastAutoPlace = SystemClock.elapsedRealtime()
                            floorHit(viewSize.first / 2f, viewSize.second * 0.8f)?.let { hit ->
                                runCatching { hit.createAnchor() }.onSuccess { anchor = it; error = "" }
                            }
                        }
                    }
                    val nowElapsed = SystemClock.elapsedRealtime()
                    val nowEpoch = System.currentTimeMillis()
                    val observed = if (tracked) session.getAllTrackables(Plane::class.java).filter { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null }.take(64) else emptyList()
                    if (nowElapsed - lastDepthCheck > 1000) {
                        lastDepthCheck = nowElapsed
                        surfaces = session.getAllTrackables(Plane::class.java).count { it.trackingState == TrackingState.TRACKING && it.subsumedBy == null && it.type == Plane.Type.HORIZONTAL_UPWARD_FACING }
                        val window = (lastDepthCheck - arDiagnostics.since).coerceAtLeast(1)
                        arFps = if (arDiagnostics.since == 0L) 0f else arDiagnostics.frames * 1000f / window
                        if (BuildConfig.DEBUG) {
                            val points = runCatching { frame.acquirePointCloud().use { it.points.remaining() / 4 } }.getOrDefault(0)
                            android.util.Log.d("RaidRiftAR", "frame state=${frame.camera.trackingState} floors=$surfaces points=$points imageFps=$arFps anchor=${anchor?.trackingState} previousFeet=${feet.size} detector=${detector.status}")
                        }
                        arDiagnostics.frames = 0; arDiagnostics.since = lastDepthCheck
                        if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depth = runCatching { frame.acquireDepthImage16Bits().use { "Depth frames available · occlusion enabled" } }.getOrDefault("Depth supported · no current depth frame")
                        localDebug = LocalDebug(
                            tracking = frame.camera.trackingState.name, failure = frame.camera.trackingFailureReason.name,
                            planes = surfaces, walls = observed.count { it.type == Plane.Type.VERTICAL }, depthSupported = depthSupported, depth = depth,
                            fps = arFps, detector = if (detectorOn) detector.status else "Detector off", detectorFps = detector.fps, detectorLatency = detector.latencyMs,
                            anchor = anchor?.trackingState?.name ?: "none", connection = state.message,
                            relay = if (relay.active) "${relay.status} · ${relay.bitrate / 1000} kbps" else relay.status, output = output.status,
                            tracksPost = connection.lastTracksResult, props = propsNote,
                            portal = rt.portal?.let { "${it.banner} · ${(nowElapsed - it.createdAt) / 1000}s" } ?: ""
                        )
                    }
                    // On-device detection: copy one CPU camera image (~5 Hz) to the detector thread.
                    if (tracked && detectorOn && viewSize.first > 0 && nowElapsed - rt.lastDetectSubmit >= 200 && detector.idle) {
                        rt.lastDetectSubmit = nowElapsed
                        runCatching { frame.acquireCameraImage() }.getOrNull()?.use { image ->
                            runCatching {
                                val out = FloatArray(6)
                                val w = image.width.toFloat(); val h = image.height.toFloat()
                                frame.transformCoordinates2d(Coordinates2d.IMAGE_PIXELS, floatArrayOf(0f, 0f, w, 0f, 0f, h), Coordinates2d.VIEW_NORMALIZED, out)
                                detector.submit(image, ImageToView(image.width, image.height, floatArrayOf(out[0], out[1]), floatArrayOf(out[2], out[3]), floatArrayOf(out[4], out[5])))
                            }
                        }
                    }
                    detector.latest.getAndSet(null)?.let { batch ->
                        if (!detectorOn) return@let
                        val active = rt.tracker.update(batch.detections, nowEpoch)
                        if (tracked) active.filter { it.lastSeen == nowEpoch }.forEach { t ->
                            runCatching { locateTrack(frame, observed, t.box, viewSize.first, viewSize.second) }.getOrNull()?.let { located ->
                                runCatching { rt.space.observe(t.id, t.label, located.foot, located.topY, located.source, nowEpoch) }
                            }
                        }
                        liveTracks = active.map { TrackView(it.id, it.label, it.box, it.score, rt.space[it.id]?.takeIf { s -> nowEpoch - s.lastSeen < 1500 }?.source) }
                    }
                    if (!detectorOn && liveTracks.isNotEmpty()) { liveTracks = emptyList(); rt.tracker.clear() }
                    if (state.authorized && nowElapsed - rt.lastTracksPost >= 400) {
                        rt.lastTracksPost = nowElapsed
                        connection.postTracks(rt.tracker.active(nowEpoch).filter { it.hits >= 2 || it.score >= 0.5f }
                            .map { OutgoingTrack(it.id, it.label, it.box, it.score, it.lastSeen) })
                    }
                    rt.space.prune(nowEpoch, world?.heroes.orEmpty().filter { it.animation in RESTING_ANIMATIONS }.mapNotNull { it.target }.toSet())
                    // Raid portal: a new raid id opens a portal for ~10 s.
                    if (tracked) {
                        val raid = world?.raid
                        if (rt.seenRaid == NorthstarRuntime.UNSET) {
                            rt.seenRaid = raid?.id
                            if (raid != null && raidIsFresh(raid.started, nowEpoch, 30_000)) rt.portal = placePortal(frame, observed, viewSize.first, viewSize.second, raid, nowElapsed)
                        } else if (raid != null && raid.id != rt.seenRaid) {
                            rt.seenRaid = raid.id
                            // Skip stale raids seen for the first time after (re)pairing; allow phone/server clock skew.
                            if (raidIsFresh(raid.started, nowEpoch, 120_000)) rt.portal = placePortal(frame, observed, viewSize.first, viewSize.second, raid, nowElapsed)
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
                    rt.portal?.let { if (nowElapsed - it.createdAt > 10_000) rt.portal = null }
                    rt.bursts = rt.bursts.filter { nowElapsed - it.startedAt < 2200 }
                    if (portal != rt.portal) portal = rt.portal
                    if (bursts != rt.bursts) bursts = rt.bursts
                    if (rt.portal != null || rt.bursts.isNotEmpty()) sceneClock = nowElapsed
                    val origin = anchor?.takeIf { tracked && it.trackingState == TrackingState.TRACKING }?.pose
                    if (origin != null && world != null) {
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
                        val heroes = world.heroes.take(12)
                        val ids = heroes.map { it.id }.toSet()
                        motor.retain(ids); rt.previousFeet.keys.retainAll(ids); rt.motorLift.keys.retainAll(ids)
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
                                val result = TargetGoal.goal(spot.foot, spot.topY, slots[hero.id] ?: 0, resting, camPose.tx(), camPose.tz())
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
                            // Raiders spawned in the last ~10 s walk out of the portal.
                            val gate = rt.portal
                            val spawnedAt = hero.spawnedAt
                            if (gate != null && spawnedAt != null && raidIsFresh(spawnedAt, nowEpoch, 10_000) && hero.id !in rt.spawned && motor.place(hero.id, gate.foot)) {
                                rt.spawned += hero.id
                                if (rt.spawned.size > 500) rt.spawned.clear()
                            }
                            if (followMe || spot != null) motor.recall(hero.id, goal, RECALL_METRES)
                            val foot = motor.updateWithWalls(hero.id, goal, elapsed, { from, to -> walls.any { it.blocks(from, to) } }, speed) { query ->
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
                            val previous = rt.previousFeet.put(hero.id, foot)
                            val observedSpeed = if (previous != null && elapsed > 0.001f) kotlin.math.hypot(foot.x - previous.x, foot.z - previous.z) / elapsed else 0f
                            val moving = observedSpeed > 0.08f
                            val toGoal = kotlin.math.hypot(goal.x - foot.x, goal.z - foot.z)
                            val wantLift = if (spot != null && resting && toGoal < 0.12f) targetLift else 0f
                            val lift = (rt.motorLift[hero.id] ?: 0f).let { it + (wantLift - it) * kotlin.math.min(1f, elapsed * 5f) }
                            rt.motorLift[hero.id] = lift
                            val local = inverseOrigin.transformPoint(floatArrayOf(foot.x, foot.y + lift, foot.z))
                            // Face the walking direction, otherwise the camera.
                            val facing = if (moving && toGoal > 0.05f) floatArrayOf(goal.x - foot.x, 0f, goal.z - foot.z)
                                else floatArrayOf(camPose.tx() - foot.x, 0f, camPose.tz() - foot.z)
                            val localFacing = inverseOrigin.rotateVector(facing)
                            val clip = if (world.reducedMotion) "Idle" else presentedClip(hero.animation, moving, spot != null, lift > 0.05f)
                            hero.id to HeroPose(Position(local[0], local[1], local[2]), TargetGoal.yaw(localFacing[0], localFacing[2]), clip)
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
                // Portal and props live in ARCore world space (top-level nodes), independent of the follow-me anchor.
                if (world != null && (portal != null || bursts.isNotEmpty())) NorthstarProps(portal, bursts, sceneClock) { arCamera.worldPosition }
            }
            // Compose overlay: never part of the SurfaceMirrorer broadcast/recording.
            if (showBoxes && liveTracks.isNotEmpty()) DetectionOverlay(liveTracks, Modifier.fillMaxSize())
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
            visibleWorld?.raid?.let { raid -> Text("RAID${if (raid.from.isNotBlank()) " from ${raid.from}" else ""} · ${raid.count} viewers", color = Color(0xffbca6ff), style = MaterialTheme.typography.titleSmall) }
            if (ar) { Text(tracking, style = MaterialTheme.typography.bodySmall); Text(depth, style = MaterialTheme.typography.bodySmall) }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = ar || !paired || visibleWorld != null, onClick = { clip.stop(); output.stop(); relay.stop(); ar = !ar; error = "" }) { Text(if (ar) "Exit AR" else "Start room AR") }
                OutlinedButton(onClick = { pairingPanel = true }) { Text("Pair room") }
                if (ar) TextButton(onClick = { followMe = !followMe; anchor = null; error = "" }) { Text(if (followMe) "Follow me ✓" else "Follow me") }
                if (anchor != null) TextButton(onClick = { anchor = null }) { Text("Reset") }
                if (BuildConfig.DEBUG) TextButton(onClick = { debugOpen = !debugOpen }) { Text(if (debugOpen) "DBG ✓" else "DBG") }
            }
        }
        if (debugOpen) DebugPanel(connection, localDebug, liveTracks, showBoxes, { showBoxes = it }, detectorOn, { detectorOn = it },
            { text, ok -> toast = text to ok }, Modifier.align(Alignment.CenterEnd).fillMaxWidth(0.72f).fillMaxHeight(0.5f))
        Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().fillMaxWidth()) {
        toast?.let { (text, ok) ->
            Text(text, color = if (ok) Color(0xff9dffb0) else Color(0xffff9d9d), style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.fillMaxWidth().background(Color(0xe0101420)).padding(horizontal = 12.dp, vertical = 6.dp))
        }
        if (paired && state.authorized) ChatBar(connection) { text, ok -> toast = text to ok }
        Column(Modifier.fillMaxWidth()
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
    }
    if (pairingPanel) AlertDialog(
        onDismissRequest = { pairingPanel = false }, title = { Text("Pair your room") },
        text = { Column(Modifier.heightIn(max = 350.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (BuildConfig.DEBUG) "Creator Studio → camera pairing. Debug build: server URL and token are remembered on this phone." else "Creator Studio → camera pairing. Token stays in memory.")
            OutlinedTextField(server, { server = it }, label = { Text("HTTPS server URL") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (BuildConfig.DEBUG) OutlinedButton(enabled = !quickPairing, onClick = {
                quickPairing = true; error = ""
                connection.quickPair(server) { failure ->
                    quickPairing = false
                    if (failure == null) { clip.stop(); output.stop(); relay.stop(); token = ""; error = ""; pairingPanel = false } else error = failure
                }
            }) { Text(if (quickPairing) "Pairing…" else "Quick pair (test server)") }
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
private fun SceneScope.CharacterWorld(world: NativeWorld, feet: Map<String, HeroPose>? = null, cameraPosition: () -> Position) {
    SideEffect {
        if (BuildConfig.DEBUG && world.mode == "SIMULATOR") android.util.Log.d("RaidRiftScene", world.heroes.take(3).joinToString { "${it.id.take(8)}:${it.x}:${it.animation}" })
    }
    TextNode(text = world.raid?.let { "RAID${if (it.from.isNotBlank()) " FROM ${it.from.uppercase()}" else ""} · ${it.count}" } ?: "RAIDRIFT · ${world.mode}", position = Position(0f, 0.55f, 0f), widthMeters = 0.9f, heightMeters = 0.1f, cameraPositionProvider = cameraPosition)
    world.heroes.take(12).forEach { hero -> key(hero.id) {
        val models = listOf("Knight", "Mage", "Rogue", "Barbarian")
        val index = hero.id.fold(0u) { hash, char -> hash * 31u + char.code.toUInt() }.rem(4u).toInt()
        val instance = rememberModelInstance(modelLoader, assetFileLocation = "kaykit/${models[index]}.glb")
        val pose = feet?.get(hero.id)
        val position = pose?.position ?: Position((hero.x - 0.5f) * 1.4f, 0f, (hero.y - 0.5f) * 1.0f)
        Node(position = position, rotation = Rotation(0f, pose?.yaw ?: 0f, 0f), isVisible = feet == null || pose != null) {
            instance?.let { ModelNode(modelInstance = it, autoAnimate = false,
                animationName = pose?.clip ?: if (world.reducedMotion) "Idle" else characterClip(hero.animation),
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
