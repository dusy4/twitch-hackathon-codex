package world.raidrift.capture

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.google.ar.core.Anchor
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Pose
import com.google.ar.core.Session
import com.google.ar.core.TrackingState

/** Owns at most one native quest anchor. No Frame/Image is retained between callbacks. */
class TrailRuntime : AutoCloseable {
    val engine = Expedition()
    var state by mutableStateOf(engine.state); private set
    var anchor by mutableStateOf<Anchor?>(null); private set
    var paused by mutableStateOf(false); private set
    var previewWalk by mutableFloatStateOf(0f); private set
    var preview by mutableStateOf(false); private set
    var occluded by mutableStateOf(false); private set
    var guidance by mutableStateOf(""); private set
    private var previewGoal = 0f
    private var lastUpdate = 0L
    private var lastPreview = 0L
    private var siteId: String? = null
    private val visibility=ObjectiveVisibility()

    fun start(simulated: Boolean) {
        release(); engine.start(); paused=false; preview=simulated; previewWalk=0f; previewGoal=0f;occluded=false
        lastUpdate=0;lastPreview=0;state=engine.state
    }
    fun togglePause() { paused=!paused;engine.pause();state=engine.state }
    fun stop() { release();engine.stop();state=engine.state;paused=false;guidance="" }
    fun suspendObservation() { engine.pause();lastUpdate=0;lastPreview=0;state=engine.state }
    fun previewStep() { if(preview && !paused && state.active) previewGoal=(previewGoal+.35f).coerceAtMost(24f) }
    fun stepPreview(now: Long, participants: List<TrailParticipant>): List<TrailEvent> {
        if(!preview || paused || !state.active) return emptyList()
        val dt=if(lastPreview==0L)0f else ((now-lastPreview)/1000f).coerceIn(0f,.1f)
        lastPreview=now
        previewWalk=minOf(previewGoal,previewWalk+dt*.65f)
        if(now-lastUpdate<250) return emptyList()
        lastUpdate=now
        val camera=FootPosition(0f,1.35f,-previewWalk)
        val events=engine.update(TrailObservation(now,now*1_000_000L,camera,true,
            TrailCandidate(FootPosition(0f,0f,-previewWalk-1.5f),0,false),
            siteVisible=state.site?.let { site -> site.foot.z<camera.z-.15f && kotlin.math.abs(site.foot.x-camera.x)<.6f } ?: false,
            participants=participants))
        state=engine.state
        guidance=state.site?.let { site ->
            if(site.foot.z>=camera.z-.15f) "Objective behind you · look back" else "${"%.1f".format(java.util.Locale.ROOT,kotlin.math.abs(site.foot.z-camera.z))} m away · simulated surface"
        } ?: ""
        return events
    }

    fun update(session: Session, frame: Frame, planes: List<Plane>, depthSupported: Boolean, participants: List<TrailParticipant>): List<TrailEvent> {
        if(preview || paused || !state.active) return emptyList()
        val now=SystemClock.elapsedRealtime()
        if(now-lastUpdate<250) return emptyList()
        lastUpdate=now
        val events=mutableListOf<TrailEvent>()
        val cameraTracked=frame.camera.trackingState==TrackingState.TRACKING
        if(anchor?.trackingState==TrackingState.STOPPED) {
            engine.loseSite()?.let(events::add);release()
        }
        val record=if(cameraTracked) captureFrameRecord(frame,"trail",now,emptyList()) else null
        val surfaces=if(cameraTracked) landingSurfaces(planes) else emptyList()
        val candidate=if(record!=null && engine.state.site==null) TrailPlacement.choose(record,surfaces.map { it.first },depthSupported) else null
        val native=anchor
        val foot=native?.takeIf { it.trackingState==TrackingState.TRACKING }?.pose?.foot()
        val point=foot ?: engine.state.site?.foot
        val depthClearance=if(record!=null && point!=null && depthSupported) LandingPlanner.depthClearance(record,point) else if(!depthSupported)Clearance.CLEAR else Clearance.UNKNOWN
        val depthVisible=visibility.update(engine.state.site?.id,depthClearance,now)
        occluded=visibility.hidden
        val visible=if(record!=null && point!=null) {
            val view=FloatArray(16).also { frame.camera.getViewMatrix(it,0) }
            val projected=Projection.toView(point.copy(y=point.y+.18f),view,record.projection)
            val distance=kotlin.math.hypot(point.x-frame.camera.pose.tx(),point.z-frame.camera.pose.tz())
            val direction=when {
                occluded -> "Hidden behind a surface · change your view"
                projected==null -> "Look back toward your objective"
                projected.first<.15f -> "← Objective to your left"
                projected.first>.85f -> "Objective to your right →"
                projected.second>.90f -> "Look down toward the objective"
                projected.second<.12f -> "Look up toward the objective"
                else -> "Objective in view"
            }
            guidance="$direction · ${"%.1f".format(java.util.Locale.ROOT,distance)} m"
            projected!=null && projected.first in .08f.. .92f && projected.second in .12f.. .90f &&
                depthVisible
        } else { guidance=if(point!=null)"Waiting for objective tracking" else "";false }
        events+=engine.update(TrailObservation(now,frame.timestamp,frame.camera.pose.foot(),cameraTracked,candidate,
            siteTracked=native?.trackingState==TrackingState.TRACKING,siteFoot=foot,siteVisible=visible,participants=participants))
        val site=engine.state.site
        if(site?.id!=siteId) {
            release()
            if(site!=null) {
                val pose=Pose.makeTranslation(site.foot.x,site.foot.y,site.foot.z)
                val plane=surfaces.firstOrNull { it.first.id==candidate?.surfaceId }?.second
                anchor=runCatching { plane?.createAnchor(pose) ?: session.createAnchor(pose) }.getOrNull()
                if(anchor==null) {
                    engine.loseSite()
                    // Do not announce or sound an objective whose anchor creation failed.
                    events.removeAll { it.kind==TrailEventKind.DISCOVERED }
                } else siteId=site.id
            }
        }
        state=engine.state
        return events
    }
    private fun release() { runCatching { anchor?.detach() };anchor=null;siteId=null }
    override fun close() { stop() }
}

fun NativeWorld.trailParticipants()=heroes.take(12).map { TrailParticipant(it.id,it.name,it.animation,it.actionSerial) }
