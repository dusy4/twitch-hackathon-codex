package world.raidrift.capture

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun TrailCard(state: TrailState, paused: Boolean, preview: Boolean, guidance: String, onOpen: () -> Unit, onStep: () -> Unit, compact: Boolean = false) {
    if(!state.active) return
    Surface(onClick=onOpen,color=Color(0xe6101220),shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth().padding(top=7.dp)) {
        Column(Modifier.padding(horizontal=13.dp,vertical=10.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            if(!compact) Text(if(preview) "SIMULATED TRAIL · LOCAL PRACTICE" else "RIFT TRAIL · LOCAL SESSION",color=Color(0xffc2a8ff),fontSize=9.sp,lineHeight=12.sp,letterSpacing=1.sp)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                Text(state.title,color=Color.White,fontWeight=FontWeight.Bold,fontSize=13.sp,lineHeight=16.sp,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                Text(state.progress.substringBefore('·').trim(),color=Color(0xff9be7c4),fontSize=12.sp,lineHeight=16.sp,maxLines=1)
            }
            Text(if(paused) "Trail paused · tap to resume" else state.hint,color=Color(0xffd9d1e8),fontSize=11.sp,lineHeight=14.sp,maxLines=if(compact)1 else 2,overflow=TextOverflow.Ellipsis)
            if(!paused && guidance.isNotBlank() && state.site!=null && state.phase!=TrailPhase.COMPLETE) Text(guidance,color=Color(0xff9be7c4),fontSize=10.sp,lineHeight=12.sp,maxLines=1)
            if(state.charge>0 && state.charge<1) LinearProgressIndicator(progress={state.charge},modifier=Modifier.fillMaxWidth(),color=Color(0xff9be7c4))
            if(preview && !paused && state.phase!=TrailPhase.COMPLETE) TextButton(onClick=onStep,contentPadding=PaddingValues(horizontal=2.dp,vertical=0.dp),modifier=Modifier.height(32.dp)) {
                Text("Walk forward · preview only",fontSize=11.sp,lineHeight=14.sp)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrailSheet(state: TrailState, paused: Boolean, ar: Boolean, follow: Boolean, roomQuests: List<Quest> = emptyList(),
               onStart: () -> Unit, onPause: () -> Unit, onStop: () -> Unit, onFollow: (Boolean) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest=onDismiss,sheetState=rememberModalBottomSheetState(skipPartiallyExpanded=true),containerColor=Color(0xff151622)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.9f).navigationBarsPadding().padding(horizontal=22.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Bring the world to life",style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.Bold)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Text("Rift Trail",color=Color(0xffc2a8ff),fontWeight=FontWeight.Bold)
            Text("Explore at your own pace. Crystals appear on clear surfaces as you discover the room. Approach one and keep it in view to collect it. Find three, restore their shrine, then let two viewers cheer through chat.")
            Text(if(ar) "Uses measured surfaces and session anchors. Looking away leaves objectives where you found them." else "Camera is off. This is a labelled simulation: Walk forward advances a virtual camera through the same quest rules.",fontSize=12.sp,color=Color(0xffc6bfd6))
            if(state.active) {
                Text("${state.title}\n${state.progress}\n${"%.1f".format(java.util.Locale.ROOT,state.distance)} m explored this session",fontSize=13.sp)
                if(state.phase==TrailPhase.PARTY) Text("Two different joined characters can wave, dance or jump through chat. With a test raid running and its stage tracked, the stub viewers send celebration messages automatically. Otherwise start a test raid or use your connected viewers.",fontSize=12.sp)
                if(state.phase!=TrailPhase.COMPLETE) OutlinedButton(onClick=onPause,modifier=Modifier.fillMaxWidth()) { Text(if(paused) "Resume trail" else "Pause trail") }
                TextButton(onClick=onStop) { Text("End trail") }
            }
            if(ar) {
                Row { Switch(follow,onFollow);Text("Party walks with me",modifier=Modifier.padding(start=10.dp,top=13.dp)) }
                Text(if(follow) "Characters walk toward you where ground is available; chat still controls their actions." else "Fixed stage: your characters stay at their landing place while you explore. Enable following if you want the party alongside.",fontSize=12.sp,color=Color(0xffc6bfd6))
            }
            Text("Local adventure progress · no Shards or competitive rewards",fontSize=11.sp,color=Color(0xffc2a8ff))
            if(roomQuests.isNotEmpty()) {
                HorizontalDivider()
                Text("Connected room quests",fontWeight=FontWeight.Bold)
                roomQuests.take(4).forEach { quest -> Text("${if(quest.completed) "✓" else "◇"} ${quest.title}\n${quest.progress}",fontSize=12.sp) }
                Text("Room progress and rewards are evaluated by the server, separately from this local trail.",fontSize=11.sp,color=Color(0xffc6bfd6))
            }
            }
            Button(onClick=onStart,modifier=Modifier.fillMaxWidth()) { Text(if(state.active) "Restart Rift Trail" else if(ar) "Start exploring" else "Try trail preview") }
        }
    }
}
