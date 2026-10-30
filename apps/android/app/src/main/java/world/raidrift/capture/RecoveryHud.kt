package world.raidrift.capture

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val RiftInk = Color(0xe6101220)
private val RiftViolet = Color(0xffc2a8ff)
private val RiftMint = Color(0xff9be7c4)

/** Camera-first controls. These never appear in SurfaceMirrorer recordings or the live output. */
@Composable
fun RecoveryHud(
    ar: Boolean, placed: Boolean, placing: Boolean, selecting: Boolean, tracking: Boolean,
    status: String, mode: String, heroes: List<Hero>, actor: String?, target: Pair<String, String>?,
    tracks: List<TrackView>, toast: Pair<String, Boolean>?, recording: Boolean, relay: Boolean,
    onCamera: () -> Unit, onSetup: () -> Unit, onPlace: () -> Unit, onSelect: () -> Unit,
    onActor: (String) -> Unit, onTarget: (TrackView) -> Unit, onClearTarget: () -> Unit,
    onCommand: (String) -> Unit, onRaid: () -> Unit, onChat: () -> Unit, onCapture: () -> Unit,
    testChat: List<TestChatLine>? = null, testRunning: Boolean = false, testDelivered: Int = 0,
    testTotal: Int = 0, testHasRaid: Boolean = false, onStopTest: () -> Unit = {},
) {
    var expanded by remember { mutableStateOf(false) }
    var chatVisible by remember { mutableStateOf(true) }
    val fullControls = !ar || expanded
    LaunchedEffect(target?.first) { if (target != null) expanded = true }
    Box(Modifier.fillMaxSize().imePadding()) {
        Column(Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(horizontal = 14.dp, vertical = 8.dp)) {
            Row(Modifier.fillMaxWidth().background(RiftInk, RoundedCornerShape(22.dp)).padding(start = 16.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                    Text("RAIDRIFT", color = Color.White, fontWeight = FontWeight.Black, fontSize = 18.sp, letterSpacing = 2.sp)
                    Text(mode, color = RiftViolet, fontSize = 10.sp, letterSpacing = 1.sp)
                }
                if (recording || relay) Text(if (relay) "● ON AIR" else "● REC", color = Color(0xffff9caa), fontSize = 11.sp)
                TextButton(onClick = onCamera, contentPadding = PaddingValues(horizontal = 10.dp)) { Text(if (ar) "Camera off" else "Start AR", fontSize = 12.sp) }
                TextButton(onClick = onSetup, contentPadding = PaddingValues(horizontal = 10.dp)) { Text("Setup", fontSize = 12.sp) }
            }
            if (ar) Row(Modifier.fillMaxWidth().padding(top = 7.dp).background(RiftInk, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (tracking) "●" else "◌", color = if (tracking) RiftMint else RiftViolet)
                Text(when { placing -> "Tap a surface to move the stage"; selecting -> "Tap an object or the surface you want to use"; else -> status },
                    color = Color(0xffe6e1f0), fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 2)
            }
        }
        if (!ar && !testHasRaid) Column(Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 108.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Your chat. In your world.", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 23.sp)
            Text("Start AR → scan a floor or table → tap to place.", color = Color(0xffc6bfd6), fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp))
        }
        Column(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (testChat != null && testHasRaid) Column(Modifier.fillMaxWidth().background(RiftInk, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 5.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("STUB CHAT · $testDelivered/$testTotal", color = RiftViolet, fontSize = 10.sp, modifier = Modifier.weight(1f))
                    if (testRunning) TextButton(onClick = onStopTest, contentPadding = PaddingValues(horizontal = 6.dp)) { Text("Stop chat", fontSize = 11.sp) }
                    TextButton(onClick = { chatVisible = !chatVisible }, contentPadding = PaddingValues(horizontal = 6.dp)) { Text(if (chatVisible) "Hide" else "Show", fontSize = 11.sp) }
                }
                val recentChat = if (testChat.lastOrNull()?.speaker == "Test room") testChat.dropLast(1) else testChat
                if (chatVisible) recentChat.takeLast(2).forEach { line ->
                    Text("${line.speaker}: ${line.text}", color = if (!line.ok) Color(0xffffa7b1) else if (line.system) Color(0xffc6bfd6) else RiftMint,
                        fontSize = 11.sp, lineHeight = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(bottom = 3.dp))
                }
                if (testRunning && ar && !tracking) Text("Chat paused while camera tracking recovers", color = RiftViolet, fontSize = 11.sp)
            }
            if (!ar && !testHasRaid) Button(onClick = onCamera, modifier = Modifier.fillMaxWidth()) { Text("Open AR camera") }
            if (testChat != null && !testHasRaid) Button(onClick = onRaid, enabled = !ar || placed, modifier = Modifier.fillMaxWidth()) {
                Text(if (ar && !placed) "Place your stage, then test a raid" else if (!ar) "Preview test raid · 3 viewers" else "Test raid · 3 viewers")
            }
            toast?.let { (text, ok) ->
                Text(text, color = if (ok) RiftMint else Color(0xffffa7b1), fontSize = 12.sp, maxLines = 3,
                    lineHeight = 16.sp, modifier = Modifier.fillMaxWidth().background(RiftInk, RoundedCornerShape(12.dp)).padding(12.dp))
            }
            Column(Modifier.fillMaxWidth().background(RiftInk, RoundedCornerShape(22.dp)).border(1.dp, Color(0x337d6caa), RoundedCornerShape(22.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (fullControls && testChat == null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    heroes.take(8).forEachIndexed { i, hero ->
                        FilterChip(selected = hero.id == (actor ?: heroes.firstOrNull()?.id), onClick = { onActor(hero.id) }, label = { Text(hero.name, fontSize = 12.sp) })
                    }
                    if (heroes.isEmpty()) Text(if (testChat != null) "Test viewers join through the portal" else "Waiting for viewers to join", color = Color(0xffc6bfd6), fontSize = 12.sp)
                }
                if (ar && placed && fullControls) Row(Modifier.horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(selected = selecting, onClick = onSelect, label = { Text(if (selecting) "Tap a target…" else "+ Select target", fontSize = 11.sp) })
                    target?.let { AssistChip(onClick = onClearTarget, label = { Text("${it.second}  ×", color = RiftMint, fontSize = 11.sp) }) }
                    tracks.distinctBy { it.id }.take(6).forEach { t ->
                        FilterChip(selected = t.id == target?.first, onClick = { onTarget(t) }, label = { Text(t.label, fontSize = 11.sp) })
                    }
                }
                if (fullControls && testChat == null) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("Wave" to "wave", "Dance" to "dance", "Jump" to "jump", (if (target == null) "Sit" else "Sit here") to "sit", "Stop" to "stop").forEach { (label, command) ->
                        FilledTonalButton(onClick = { onCommand(command) }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) { Text(label, fontSize = 12.sp) }
                    }
                    if (ar && testChat == null) FilledTonalButton(onClick = onRaid, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) { Text("Test raid", fontSize = 12.sp) }
                }
                if (fullControls && (testChat == null || ar)) HorizontalDivider(color = Color(0x337d6caa), modifier = Modifier.padding(vertical = 3.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    if (testChat == null || ar) TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 5.dp)) { Text(if (expanded) "Less" else if (testChat != null) "Targets" else "Play", fontSize = 12.sp) }
                    if (testChat != null && testHasRaid) TextButton(onClick = onRaid, enabled = !ar || placed, contentPadding = PaddingValues(horizontal = 5.dp)) { Text("Replay raid", fontSize = 12.sp) }
                    TextButton(onClick = if (ar && placed) onSelect else onCamera, contentPadding = PaddingValues(horizontal = 8.dp)) { Text(if (ar && placed) "Target" else "Camera", fontSize = 12.sp) }
                    TextButton(onClick = onChat, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("Chat", fontSize = 12.sp) }
                    TextButton(onClick = onCapture, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("Capture", fontSize = 12.sp) }
                }
            }
        }
    }
}

/** Optional manual test console. The streamer does not need this for the automatic incoming feed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TestChatSheet(viewers: List<TestViewer>, messages: List<TestChatLine>, selectedViewer: String,
                  onViewer: (String) -> Unit, onDismiss: () -> Unit, onSend: (String, String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val viewer = viewers.first { it.id == selectedViewer }
    val scroll = rememberScrollState()
    LaunchedEffect(messages.lastOrNull()?.id) { scroll.animateScrollTo(scroll.maxValue) }
    fun send(value: String = text) { if (value.isNotBlank()) { onSend(viewer.id, value); text = "" } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xff151622)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.9f).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Test stream chat", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Stub viewers · each controls only their own named character", color = RiftViolet, fontSize = 12.sp, lineHeight = 16.sp)
            Column(Modifier.fillMaxWidth().heightIn(min = 90.dp, max = 160.dp).verticalScroll(scroll), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                messages.forEach { line -> Text("${line.speaker}: ${line.text}", fontSize = 12.sp, lineHeight = 16.sp,
                    color = if (!line.ok) Color(0xffffa7b1) else if (line.system) Color(0xffc6bfd6) else RiftMint) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                viewers.forEach { v -> FilterChip(selected = v.id == viewer.id, onClick = { onViewer(v.id) }, label = { Text(v.name) }) }
            }
            Text("Typing as ${viewer.name} → ${viewer.character}", color = RiftMint, fontSize = 12.sp, lineHeight = 16.sp)
            OutlinedTextField(text, { text = it.take(300) }, label = { Text("Message as ${viewer.name}") }, placeholder = { Text("Walk right then jump / come closer") },
                modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                listOf("walk left", "walk right", "come closer", "jump", "turn around", "dance", "sit down", "join").forEach { action -> SuggestionChip(onClick = { send(action) }, label = { Text(action) }) }
            }
            Button(onClick = { send() }, enabled = text.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Send as ${viewer.name}") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandSheet(actor: String, target: String?, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    fun send() { if (text.isNotBlank()) { onSend(text); text = ""; onDismiss() } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Color(0xff151622)) {
        Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 22.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Give $actor a quest", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(target?.let { "Selected target: $it" } ?: "Select a detected object or tap a surface in AR.", color = Color(0xffc6bfd6), fontSize = 13.sp)
            OutlinedTextField(text, { text = it.take(300) }, label = { Text("Command") }, placeholder = { Text("Run to the chair and sit on it") },
                modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { send() }))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("run", "sit", "dance", "wave").forEach { action -> SuggestionChip(onClick = { onSend(action); onDismiss() }, label = { Text(action.replaceFirstChar(Char::uppercase)) }) }
            }
            Button(onClick = { send() }, enabled = text.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Send command") }
        }
    }
}
