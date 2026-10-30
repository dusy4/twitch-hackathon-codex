package world.raidrift.capture

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject

/** One detection as shown in debug views. [source] = plane/depth/ray or null when no 3D point. */
data class TrackView(val id: String, val label: String, val box: TrackBox, val score: Float, val source: String?)

/** Local AR/runtime facts for the debug panel (refreshed ~1 Hz). */
data class LocalDebug(
    val tracking: String = "", val failure: String = "", val planes: Int = 0, val walls: Int = 0, val depthSupported: Boolean = false,
    val depth: String = "", val fps: Float = 0f, val detector: String = "", val detectorFps: Float = 0f, val detectorLatency: Long = 0,
    val anchor: String = "", val connection: String = "", val relay: String = "", val output: String = "", val tracksPost: String = "",
    val props: String = "", val portal: String = "",
    val light: String = "", val shadow: String = "", val occlusion: String = "", val camera: String = "",
    val frameUpload: String = "", val frames: Int = 0, val serverTracks: String = "", val unresolved: List<String> = emptyList(),
    val objectAnchors: Int = 0
)

/** DBG toggles for AR realism comparisons. */
data class ArControls(
    val occlusion: Boolean, val onOcclusion: (Boolean) -> Unit,
    val light: LightMode, val onLight: (LightMode) -> Unit,
    val shadow: ShadowMode, val onShadow: (ShadowMode) -> Unit
)

/** "Scan the floor" onboarding shown until characters have measured ground (Compose only, not broadcast). */
@Composable
fun ScanFloorOverlay(trackingOk: Boolean, surfaces: Int, followMe: Boolean, modifier: Modifier = Modifier, automaticLanding: Boolean = false, landingStatus: String = "") {
    val (title, hint) = when {
        !trackingOk -> "1 · Find a surface" to "Hold the phone steady, then move it slowly"
        surfaces == 0 -> "1 · Scan a floor or table" to "Point at a textured surface and move slowly side to side"
        followMe -> "Floor found" to "Keep the floor in view · characters are on their way"
        automaticLanding -> "Preparing a raid landing" to landingStatus
        else -> "2 · Tap to place your stage" to "Tap the floor or table once. Then press Test raid and watch."
    }
    Column(modifier.padding(24.dp).background(Color(0xb0101420), androidx.compose.foundation.shape.RoundedCornerShape(14.dp)).padding(horizontal = 18.dp, vertical = 12.dp),
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Color(0xffbca6ff))
        Text(hint, style = MaterialTheme.typography.bodySmall, color = Color.White)
        if (trackingOk && surfaces == 0) LinearProgressIndicator(modifier = Modifier.width(140.dp).padding(top = 4.dp))
    }
}

private val CHAT_CHIPS = listOf("run to the dog", "sit on the dog", "dance", "jump", "!join")

/**
 * Compose overlay only: SurfaceMirrorer copies the Filament surface, so nothing here
 * (chat, toasts, boxes, debug text) reaches the relay/recording output.
 */
@Composable
fun ChatBar(connection: WorldConnection, onToast: (String, Boolean) -> Unit) {
    var text by remember { mutableStateOf("") }
    var viewer by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    fun send(value: String) {
        if (value.isBlank() || sending) return
        sending = true
        connection.chat(value, viewer) { reply -> sending = false; onToast(reply.text, reply.ok) }
    }
    Column(Modifier.fillMaxWidth().background(Color(0xcc10121c)).padding(horizontal = 8.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            CHAT_CHIPS.forEach { chip -> AssistChip(onClick = { send(chip) }, label = { Text(chip, fontSize = 12.sp) }, enabled = !sending) }
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = { viewer = if (viewer == null) RANDOM_VIEWERS.random() else null }, contentPadding = PaddingValues(horizontal = 6.dp)) {
                Text(if (viewer == null) "as Streamer" else "as $viewer", fontSize = 12.sp)
            }
            OutlinedTextField(text, { text = it.take(300) }, modifier = Modifier.weight(1f), singleLine = true, placeholder = { Text("!rift run to the dog…", fontSize = 13.sp) },
                textStyle = MaterialTheme.typography.bodySmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send(text); text = "" }))
            Button(onClick = { send(text); text = "" }, enabled = !sending && text.isNotBlank(), contentPadding = PaddingValues(horizontal = 10.dp)) { Text(if (sending) "…" else "Send") }
        }
    }
}

@Composable
fun DetectionOverlay(tracks: List<TrackView>, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val paint = android.graphics.Paint().apply { color = android.graphics.Color.YELLOW; textSize = 34f; isAntiAlias = true }
        tracks.forEach { t ->
            val color = if (t.source != null) Color(0xff7dff8a) else Color(0xffffd23f)
            drawRect(color, Offset(t.box.x * size.width, t.box.y * size.height), Size(t.box.w * size.width, t.box.h * size.height), style = Stroke(4f))
            drawCircle(color, 8f, Offset(t.box.centerX * size.width, t.box.bottom * size.height))
            paint.color = if (t.source != null) android.graphics.Color.GREEN else android.graphics.Color.YELLOW
            drawContext.canvas.nativeCanvas.drawText("${t.id} ${"%.2f".format(java.util.Locale.ROOT, t.score)} ${t.source ?: "no3D"}",
                t.box.x * size.width + 6f, (t.box.y * size.height - 8f).coerceAtLeast(30f), paint)
        }
    }
}

@Composable
fun DebugPanel(
    connection: WorldConnection, local: LocalDebug, tracks: List<TrackView>,
    overlay: Boolean, onOverlay: (Boolean) -> Unit, detectorOn: Boolean, onDetector: (Boolean) -> Unit,
    onToast: (String, Boolean) -> Unit, modifier: Modifier = Modifier, arControls: ArControls? = null
) {
    var questAction by remember { mutableStateOf(QUEST_ACTIONS.first()) }
    var questTarget by remember { mutableStateOf("chair") }
    var questMenu by remember { mutableStateOf(false) }
    val server by connection.debugState.collectAsStateWithLifecycle()
    val serverError by connection.debugError.collectAsStateWithLifecycle()
    DisposableEffect(Unit) { connection.startDebugPolling(); onDispose { connection.stopDebugPolling() } }
    var raidFrom by remember { mutableStateOf("test_raider") }
    var viewers by remember { mutableStateOf("25") }
    var chatters by remember { mutableFloatStateOf(3f) }
    fun event(json: JSONObject) = connection.debugEvent(json) { onToast(it, !it.contains("fail", true) && !it.contains("disabled") && !it.contains("rejected")) }
    val small = MaterialTheme.typography.labelSmall
    Column(modifier.background(Color(0xe0101420)).verticalScroll(rememberScrollState()).padding(8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("DEBUG", style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(raidFrom, { raidFrom = it.take(25) }, label = { Text("Raid from", fontSize = 11.sp) }, singleLine = true, textStyle = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            OutlinedTextField(viewers, { viewers = it.filter(Char::isDigit).take(6) }, label = { Text("Viewers", fontSize = 11.sp) }, singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(90.dp))
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Text("Chatters ${chatters.toInt()}", style = small)
                Slider(chatters, { chatters = it }, valueRange = 0f..12f, steps = 11)
            }
        }
        FlowRowButtons(listOf(
            "Raid" to { event(JSONObject().put("type", "raid").put("from", raidFrom.ifBlank { "test_raider" }).put("viewers", viewers.toIntOrNull() ?: 25).put("chatters", chatters.toInt())) },
            "Chat viewer" to { event(JSONObject().put("type", "chat").put("name", RANDOM_VIEWERS.random()).put("text", listOf("!rift dance", "!rift run to the dog", "!join", "!rift jump").random())) },
            "Dup raid" to { event(JSONObject().put("type", "duplicate_raid")) },
            "Revoke auth" to { event(JSONObject().put("type", "revoke").put("status", "authorization_revoked")) },
            "Revoke user" to { event(JSONObject().put("type", "revoke").put("status", "user_removed")) },
            "Reset scene" to { event(JSONObject().put("type", "reset")) },
        ))
        // Quest row: action + free-text object (any noun; the server's open-vocabulary detector finds it), 2 players.
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box {
                OutlinedButton(onClick = { questMenu = true }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp), modifier = Modifier.height(32.dp)) { Text("$questAction ▾", fontSize = 11.sp) }
                DropdownMenu(expanded = questMenu, onDismissRequest = { questMenu = false }) {
                    QUEST_ACTIONS.forEach { a -> DropdownMenuItem(text = { Text(a) }, onClick = { questAction = a; questMenu = false }) }
                }
            }
            OutlinedTextField(questTarget, { questTarget = it.take(40) }, label = { Text("Object", fontSize = 11.sp) }, singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = {
                runCatching { questPayload(questAction, questTarget, 2) }.onSuccess { event(it) }.onFailure { onToast(it.message ?: "Invalid quest", false) }
            }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp), modifier = Modifier.height(32.dp)) { Text("Quest x2", fontSize = 11.sp) }
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Checkbox(overlay, onOverlay); Text("Boxes", style = small)
            Checkbox(detectorOn, onDetector); Text("Detector", style = small)
        }
        arControls?.let { c ->
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(c.occlusion, c.onOcclusion); Text("Occlusion", style = small)
                TextButton(onClick = { c.onLight(if (c.light == LightMode.HDR) LightMode.AMBIENT else LightMode.HDR) }, contentPadding = PaddingValues(horizontal = 4.dp)) {
                    Text("Light: ${if (c.light == LightMode.HDR) "HDR" else "ambient"}", fontSize = 11.sp)
                }
                TextButton(onClick = { c.onShadow(ShadowMode.entries[(c.shadow.ordinal + 1) % ShadowMode.entries.size]) }, contentPadding = PaddingValues(horizontal = 4.dp)) {
                    Text("Shadow: ${c.shadow.name.lowercase()}", fontSize = 11.sp)
                }
            }
        }
        HorizontalDivider()
        Text("LOCAL", style = small, color = Color(0xffbca6ff))
        Text("AR ${local.tracking}${if (local.failure.isNotBlank() && local.failure != "NONE") " · ${local.failure}" else ""}", style = small)
        Text("planes ${local.planes} floor / ${local.walls} wall · depth ${if (local.depthSupported) "yes" else "no"} · ${"%.0f".format(local.fps)} fps", style = small)
        Text(local.depth, style = small)
        Text("anchor ${local.anchor} · object anchors ${local.objectAnchors}", style = small)
        Text("light: ${local.light}", style = small)
        Text("shadow: ${local.shadow} · occlusion: ${local.occlusion}", style = small)
        if (local.camera.isNotBlank()) Text("camera: ${local.camera}", style = small)
        Text("frame upload: ${local.frameUpload.ifBlank { "none yet" }} · buffer ${local.frames}", style = small)
        Text("server tracks: ${local.serverTracks}", style = small)
        local.unresolved.forEach { Text("  unresolved $it", style = small, color = MaterialTheme.colorScheme.error) }
        Text("${local.detector} · ${"%.1f".format(local.detectorFps)} Hz · ${local.detectorLatency} ms", style = small)
        tracks.take(10).forEach { t -> Text("  ${t.id} ${t.label} ${"%.2f".format(java.util.Locale.ROOT, t.score)} 3D:${t.source ?: "none"}", style = small) }
        Text("tracks POST: ${local.tracksPost}", style = small)
        Text("conn: ${local.connection}", style = small)
        Text("relay: ${local.relay}", style = small)
        Text("lan: ${local.output}", style = small)
        if (local.portal.isNotBlank()) Text("portal: ${local.portal}", style = small)
        if (local.props.isNotBlank()) Text("props: ${local.props}", style = small)
        HorizontalDivider()
        Text("SERVER", style = small, color = Color(0xffbca6ff))
        if (serverError.isNotBlank()) Text(serverError, style = small, color = MaterialTheme.colorScheme.error)
        server?.let { s ->
            Text("inbox pending ${s.pending} · done ${s.done} · failed ${s.failed} · avatars ${s.avatars}", style = small)
            Text("AI ${s.aiProvider} ${s.aiModel} · ${s.aiLatencyMs?.let { "$it ms" } ?: "-"}", style = small)
            if (s.aiError.isNotBlank()) Text("AI error: ${s.aiError}", style = small, color = MaterialTheme.colorScheme.error)
            if (s.quests.isNotEmpty()) { Text("quests", style = small); s.quests.forEach { Text("  $it", style = small) } }
            if (s.leaderboard.isNotEmpty()) Text("top: " + s.leaderboard.take(5).joinToString(" · "), style = small)
            if (s.tracks.isNotEmpty()) Text("server tracks: " + s.tracks.take(6).joinToString(" · "), style = small)
            s.log.forEach { line -> Text("${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(java.util.Date(line.at))} ${line.kind}: ${line.text}", style = small) }
        }
    }
}

@Composable
private fun FlowRowButtons(buttons: List<Pair<String, () -> Unit>>) {
    buttons.chunked(3).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            row.forEach { (label, action) ->
                OutlinedButton(onClick = action, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp), modifier = Modifier.height(32.dp)) { Text(label, fontSize = 11.sp) }
            }
        }
    }
}
