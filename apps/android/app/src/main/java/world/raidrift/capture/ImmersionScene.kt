package world.raidrift.capture

import android.os.SystemClock
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import io.github.sceneview.SceneScope
import io.github.sceneview.math.Position
import io.github.sceneview.math.Rotation
import io.github.sceneview.math.Scale
import io.github.sceneview.math.Size
import kotlin.math.*

data class MagicBurst(val id: String, val foot: FootPosition, val at: Long, val gold: Boolean = false)

/** All positions are measured world/anchor coordinates; effects never move the AR camera. */
@Composable
fun SceneScope.TrailObjective(state: TrailState, reduced: Boolean, preview: Boolean = false, cameraPosition: () -> Position) {
    val site=state.site ?: return
    val violet=remember(materialLoader) { materialLoader.createColorInstance(Color(0xffc397ff),metallic=.25f,roughness=.2f) }
    val mint=remember(materialLoader) { materialLoader.createColorInstance(Color(0xff91ffe0),metallic=.15f,roughness=.15f) }
    val gold=remember(materialLoader) { materialLoader.createColorInstance(Color(0xffffcf72),metallic=.4f,roughness=.25f) }
    val stone=remember(materialLoader) { materialLoader.createColorInstance(Color(0xff30233e),metallic=.15f,roughness=.85f) }
    val current by rememberUpdatedState(state)
    val lowMotion by rememberUpdatedState(reduced)
    key(site.id) {
        val born=site.createdAt
        Node(position=Position(site.foot.x,site.foot.y,site.foot.z)) {
            // Four rune corners give contact/scale even when the crystal floats above the floor.
            repeat(4) { i ->
                val a=i*PI.toFloat()/2
                CubeNode(size=Size(.07f,.012f,.022f),materialInstance=violet,
                    position=Position(cos(a)*.18f,.012f,sin(a)*.18f),rotation=Rotation(0f,-i*90f,0f))
            }
            TorusNode(majorRadius=.15f,minorRadius=.006f,majorSegments=28,minorSegments=6,materialInstance=violet,
                position=Position(0f,.012f,0f))
            if(site.kind==TrailKind.CRYSTAL) {
                Node(position=Position(0f,.2f,0f),apply={ onFrame={
                    val age=((SystemClock.elapsedRealtime()-born)/1000f).coerceAtLeast(0f)
                    position=Position(0f,.22f+if(lowMotion)0f else .025f*sin(age*2.4f),0f)
                    rotation=Rotation(0f,if(lowMotion)25f else age*42f,0f)
                    val grow=if(lowMotion)1f else (age/.45f).coerceIn(.05f,1f)
                    scale=Scale(grow*(1f-current.charge*.22f))
                } }) {
                    ConeNode(radius=.065f,height=.12f,sideCount=5,materialInstance=mint,position=Position(0f,.06f,0f))
                    ConeNode(radius=.065f,height=.08f,sideCount=5,materialInstance=violet,position=Position(0f,-.04f,0f),rotation=Rotation(180f,0f,0f))
                    Node(position=Position(.07f,-.055f,.01f),rotation=Rotation(0f,0f,-25f)) {
                        ConeNode(radius=.027f,height=.07f,sideCount=5,materialInstance=violet,position=Position(0f,.035f,0f))
                        ConeNode(radius=.027f,height=.045f,sideCount=5,materialInstance=mint,position=Position(0f,-.0225f,0f),rotation=Rotation(180f,0f,0f))
                    }
                    Node(position=Position(-.06f,-.06f,.02f),rotation=Rotation(0f,0f,30f)) {
                        ConeNode(radius=.023f,height=.06f,sideCount=5,materialInstance=gold,position=Position(0f,.03f,0f))
                        ConeNode(radius=.023f,height=.04f,sideCount=5,materialInstance=violet,position=Position(0f,-.02f,0f),rotation=Rotation(180f,0f,0f))
                    }
                }
            } else {
                CubeNode(size=Size(.32f,.06f,.32f),materialInstance=stone,position=Position(0f,.03f,0f),rotation=Rotation(0f,45f,0f))
                CubeNode(size=Size(.23f,.07f,.23f),materialInstance=stone,position=Position(0f,.09f,0f))
                repeat(3) { i ->
                    val a=i*2*PI.toFloat()/3
                    CubeNode(size=Size(.045f,.08f,.045f),materialInstance=mint,
                        position=Position(cos(a)*.10f,.16f,sin(a)*.10f),rotation=Rotation(0f,i*120f,25f))
                }
                val restored=state.phase in setOf(TrailPhase.PARTY,TrailPhase.COMPLETE)
                Node(position=Position(0f,.28f,0f),apply={ onFrame={
                    val age=(SystemClock.elapsedRealtime()-born)/1000f
                    rotation=Rotation(0f,if(lowMotion)0f else age*30,0f)
                } }) {
                    TorusNode(majorRadius=.075f,minorRadius=.008f,majorSegments=24,minorSegments=6,
                        materialInstance=if(restored)gold else violet,rotation=Rotation(90f,0f,0f))
                    if(restored) CubeNode(size=Size(.045f),materialInstance=gold,rotation=Rotation(45f,45f,0f))
                }
            }
            // Segments are progress, not flashing brightness. Low-motion mode keeps this feedback.
            repeat((state.charge*16).toInt().coerceIn(0,16)) { i ->
                val a=i*2*PI.toFloat()/16
                CubeNode(size=Size(.023f,.009f,.023f),materialInstance=gold,position=Position(cos(a)*.21f,.018f,sin(a)*.21f))
            }
            TextNode(text=when {
                state.phase==TrailPhase.COMPLETE -> "RIFT RESTORED"
                state.phase==TrailPhase.PARTY -> "PARTY CHEER  ${state.cheers.size}/2"
                site.kind==TrailKind.SHRINE -> "RESTORE THE SHRINE"
                else -> "LOST CRYSTAL  ${state.collected+1}/3"
            },position=Position(0f,.46f,0f),widthMeters=.50f,heightMeters=.065f,cameraPositionProvider=cameraPosition)
            if(preview) TextNode(text="LOCAL TRAIL PREVIEW",position=Position(0f,.39f,0f),widthMeters=.40f,heightMeters=.035f,cameraPositionProvider=cameraPosition)
        }
    }
}

/** Invisible, depth-only boxes over measured furniture: characters behind a bed are hidden by it
 * without per-pixel floor depth noise eating their feet. Boxes never cast or receive shadows. */
@Composable
fun SceneScope.RoomOccluders(boxes: List<RoomObstacles.Occluder>) {
    val hidden=remember(materialLoader) { materialLoader.createOcclusionInstance() }
    boxes.forEach { b -> key(b) {
        CubeNode(size=Size(b.width,b.top-b.bottom,b.depth),materialInstance=hidden,
            position=Position(b.x,(b.bottom+b.top)/2,b.z),
            // After the camera background (0, occluder mode on), before characters (default 4).
            apply={ isShadowCaster=false;isShadowReceiver=false;setPriority(io.github.sceneview.ar.camera.ARCameraStream.OCCLUDER_PRIORITY) })
    } }
}

@Composable
fun SceneScope.MagicBursts(bursts: List<MagicBurst>, reduced: Boolean) {
    val pale=remember(materialLoader) { materialLoader.createColorInstance(Color(0xffb9ffe6),metallic=.15f,roughness=.25f) }
    val gold=remember(materialLoader) { materialLoader.createColorInstance(Color(0xffffd579),metallic=.2f,roughness=.25f) }
    if(reduced) return
    bursts.takeLast(4).forEach { b -> key(b.id) {
        Node(position=Position(b.foot.x,b.foot.y+.1f,b.foot.z)) {
            repeat(14) { i ->
                val a=i*2.39996f
                Node(apply={ onFrame={
                    val age=((SystemClock.elapsedRealtime()-b.at)/1000f).coerceIn(0f,1.8f)
                    val radius=.12f+age*(.12f+i%3*.045f)
                    position=Position(cos(a)*radius,.15f+age*.3f-age*age*.16f,sin(a)*radius)
                    scale=Scale((1f-age/1.8f).coerceAtLeast(.001f))
                    rotation=Rotation(age*160f,age*100f,45f)
                } }) { CubeNode(size=Size(.018f),materialInstance=if(b.gold)gold else pale) }
            }
        }
    } }
}
