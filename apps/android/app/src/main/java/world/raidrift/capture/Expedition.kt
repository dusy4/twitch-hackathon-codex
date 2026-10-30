package world.raidrift.capture

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

enum class TrailPhase { OFF, FRAGMENTS, SHRINE, PARTY, COMPLETE }
enum class TrailKind { CRYSTAL, SHRINE }
data class TrailSite(val id: String, val kind: TrailKind, val foot: FootPosition, val createdAt: Long, val depthChecked: Boolean)
data class TrailCandidate(val foot: FootPosition, val surfaceId: Int, val depthChecked: Boolean)
data class TrailParticipant(val id: String, val name: String, val action: String, val serial: Long)
data class TrailObservation(
    val now: Long, val frameTimestamp: Long, val camera: FootPosition,
    val tracked: Boolean, val candidate: TrailCandidate? = null,
    val siteTracked: Boolean = true, val siteFoot: FootPosition? = null,
    val siteVisible: Boolean = false, val participants: List<TrailParticipant> = emptyList(),
    val candidateHint: String? = null,
)
enum class TrailEventKind { DISCOVERED, COLLECTED, RESTORED, CHEER, COMPLETED, LOST }
data class TrailEvent(val id: Long, val kind: TrailEventKind, val foot: FootPosition?, val text: String)
data class TrailState(
    val phase: TrailPhase = TrailPhase.OFF, val collected: Int = 0, val distance: Float = 0f,
    val site: TrailSite? = null, val charge: Float = 0f, val cheers: List<String> = emptyList(),
    val hint: String = "Start a Rift Trail to discover magic as you explore",
) {
    val active get() = phase != TrailPhase.OFF
    val title get() = when (phase) {
        TrailPhase.OFF -> "Rift Trail"
        TrailPhase.FRAGMENTS -> "Gather the lost fragments"
        TrailPhase.SHRINE -> "Restore the rift shrine"
        TrailPhase.PARTY -> "A cheer from the party"
        TrailPhase.COMPLETE -> "Rift Trail complete"
    }
    val progress get() = when (phase) {
        TrailPhase.FRAGMENTS -> "$collected / 3 crystals"
        TrailPhase.SHRINE -> "3 / 3 crystals · shrine revealed next"
        TrailPhase.PARTY -> "${cheers.size} / 2 party members"
        TrailPhase.COMPLETE -> "3 crystals · shrine restored · party celebrated"
        else -> "Discover · collect · restore"
    }
}

/** Ephemeral local expedition. No networking, wallet, rewards, GPS or trusted quest proof.
 * Inputs are actual AR observations (or an explicitly labelled preview). All clocks are monotonic.
 */
class Expedition {
    var state = TrailState(); private set
    private var serial = 0L
    private var epoch = 0L
    private var frame = Long.MIN_VALUE
    private var previous: TrailObservation? = null
    private var keyCamera: FootPosition? = null
    private var settledAt = Long.MIN_VALUE
    private var candidate: TrailCandidate? = null
    private var candidateAt = 0L
    private var candidateSamples = 0
    private var dwellAt: Long? = null
    private var dwellMs=0L
    private var lastDiscoveryCamera: FootPosition? = null
    private var lastPickupDistance=0f
    private var partyNeedsBaseline=false
    private val sites = ArrayDeque<FootPosition>()
    private val baselineActions = mutableMapOf<String, Long>()
    private val cheering = linkedMapOf<String, String>()
    private var lost = false

    fun start() {
        epoch++; serial = 0; frame = Long.MIN_VALUE; previous = null; keyCamera = null
        settledAt = Long.MIN_VALUE; candidate = null; candidateSamples = 0; dwellAt = null;dwellMs=0
        lastDiscoveryCamera = null;lastPickupDistance=0f;partyNeedsBaseline=false; sites.clear(); baselineActions.clear(); cheering.clear(); lost = false
        state = TrailState(phase = TrailPhase.FRAGMENTS, hint = "Scan an open floor slowly to reveal the first crystal")
    }
    fun stop() { start(); state = TrailState() }
    /** Breaking observation continuity preserves objectives but cannot preserve a partial pickup. */
    fun pause() { previous = null; keyCamera = null; dwellAt = null;dwellMs=0; candidate = null; candidateSamples = 0; settledAt = Long.MIN_VALUE;partyNeedsBaseline=true; state = state.copy(charge = 0f) }
    private fun baselinePeople(o:TrailObservation) { if(state.phase==TrailPhase.PARTY) o.participants.forEach { baselineActions[it.id]=max(baselineActions[it.id] ?: Long.MIN_VALUE,it.serial) } }

    private fun horizontal(a: FootPosition, b: FootPosition) = hypot(a.x - b.x, a.z - b.z)
    private fun finite(p: FootPosition) = p.x.isFinite() && p.y.isFinite() && p.z.isFinite()
    fun allowsLocation(p: FootPosition):Boolean = finite(p) && (lost || sites.none { horizontal(it,p)<1.2f && abs(it.y-p.y)<.3f })
    private fun emit(kind: TrailEventKind, at: FootPosition?, text: String) = TrailEvent(++serial, kind, at, text)

    /** Called only when a native objective anchor permanently stops, not for a brief PAUSED state. */
    fun loseSite(): TrailEvent? {
        val site = state.site ?: return null
        if(state.phase==TrailPhase.COMPLETE) { state=state.copy(site=null);return null }
        state = state.copy(site = null, charge = 0f,
            hint = "Objective tracking lost · scan nearby to reveal it again")
        candidate = null; candidateSamples = 0; dwellAt = null;dwellMs=0;partyNeedsBaseline=true; lost = true
        return emit(TrailEventKind.LOST, site.foot, "Objective lost · progress saved; rescan a surface")
    }

    fun update(o: TrailObservation): List<TrailEvent> {
        if (!state.active || state.phase == TrailPhase.COMPLETE || o.frameTimestamp <= frame) return emptyList()
        frame = o.frameTimestamp
        if (!o.tracked || !finite(o.camera)) {
            baselinePeople(o)
            pause(); state = state.copy(hint = "Tracking paused · hold still and let the room recover")
            return emptyList()
        }
        val old = previous
        previous = o
        if (old == null) {
            baselinePeople(o)
            keyCamera = o.camera; settledAt = o.now + 900
            state = state.copy(hint = "Reading the room · move gently")
            return emptyList()
        }
        val gap = o.now - old.now
        val travel = horizontal(o.camera, old.camera)
        if (gap !in 1..650 || travel > gap / 1000f * 2.5f + .10f || abs(o.camera.y - old.camera.y) > .4f) {
            baselinePeople(o)
            pause(); previous = o; keyCamera = o.camera; settledAt = o.now + 1200
            state = state.copy(hint = "Room position changed · waiting for stable tracking")
            return emptyList()
        }
        if (o.now < settledAt) { baselinePeople(o);return emptyList() }
        val key = keyCamera ?: o.camera
        // Deadband keyframes ignore centimetre wrist jitter instead of summing it into metres.
        if (horizontal(key, o.camera) >= .18f) {
            state = state.copy(distance = (state.distance + horizontal(key, o.camera)).coerceAtMost(999f))
            keyCamera = o.camera
        }
        val events = mutableListOf<TrailEvent>()
        if (state.phase == TrailPhase.PARTY && state.site!=null) {
            if(partyNeedsBaseline) { baselinePeople(o);partyNeedsBaseline=false;return emptyList() }
            if (!o.siteTracked || !o.siteVisible) {
                state = state.copy(hint = "Keep the restored shrine in view for the party celebration")
                // Actions received while the shrine is not observed cannot count later.
                baselinePeople(o)
                return emptyList()
            }
            o.participants.take(12).forEach { player ->
                val oldSerial = baselineActions[player.id]
                baselineActions[player.id]=max(oldSerial ?: Long.MIN_VALUE,player.serial)
                if (oldSerial != null && player.serial>oldSerial && player.id !in cheering && player.action in setOf("wave", "dance", "jump")) {
                    cheering[player.id] = player.name.take(32)
                    events += emit(TrailEventKind.CHEER, state.site?.foot, "${player.name.take(32)} cheers for the trail!")
                }
            }
            state = state.copy(cheers = cheering.values.take(2), hint = "Two party members: wave, dance or jump in chat")
            if (cheering.size >= 2) {
                state = state.copy(phase = TrailPhase.COMPLETE, charge = 1f, hint = "Trail restored · your party brought the magic back")
                events += emit(TrailEventKind.COMPLETED, state.site?.foot, "Rift Trail complete · 3 crystals, one restored shrine, your party")
            }
            return events
        }
        val site = state.site
        if (site == null) {
            baselinePeople(o)
            val moved = lastDiscoveryCamera?.let { horizontal(it, o.camera) >= 1.25f && state.distance-lastPickupDistance>=1.5f } ?: true
            if (!moved && !lost) {
                val remaining=max(1.5f-(state.distance-lastPickupDistance),1.25f-(lastDiscoveryCamera?.let { horizontal(it,o.camera) } ?: 0f)).coerceAtLeast(.1f)
                state = state.copy(hint = "Explore new ground · ${"%.1f".format(java.util.Locale.ROOT,remaining)} m farther for the next ${if (state.phase == TrailPhase.SHRINE) "shrine" else "crystal"}")
                candidate = null; candidateSamples = 0
                return emptyList()
            }
            val next = o.candidate?.takeIf { c -> finite(c.foot) &&
                horizontal(c.foot, o.camera) in 1.15f..2.8f && o.camera.y - c.foot.y in .35f..2.2f &&
                allowsLocation(c.foot) }
            if (next == null) {
                candidate = null; candidateSamples = 0
                state = state.copy(hint = o.candidateHint ?: "Scan a clear floor ahead · magic needs a measured surface")
                return emptyList()
            }
            val first = candidate
            if (first == null || first.surfaceId != next.surfaceId || horizontal(first.foot, next.foot) > .12f || abs(first.foot.y - next.foot.y) > .035f) {
                candidate = next; candidateAt = o.now; candidateSamples = 1
            } else candidateSamples++
            state = state.copy(hint = "Something is forming · hold this surface in view")
            if (candidateSamples >= 3 && o.now - candidateAt >= 700) {
                val fixed = checkNotNull(candidate)
                val kind = if (state.phase == TrailPhase.FRAGMENTS) TrailKind.CRYSTAL else TrailKind.SHRINE
                val created = TrailSite("trail-$epoch-${state.collected}-${kind.name}", kind, fixed.foot, o.now, fixed.depthChecked)
                state = state.copy(site = created, hint = if (kind == TrailKind.CRYSTAL) "Crystal discovered · approach while keeping it in view" else "Rift shrine discovered · approach to restore it")
                candidate = null; candidateSamples = 0; lost = false
                events += emit(TrailEventKind.DISCOVERED, created.foot, if (kind == TrailKind.CRYSTAL) "Lost crystal ${state.collected + 1} discovered" else "The rift shrine is here")
            }
            return events
        }
        val at = o.siteFoot?.takeIf(::finite) ?: site.foot
        state = state.copy(site = site.copy(foot = at))
        val near = horizontal(at, o.camera) <= if(dwellMs>0)1.2f else 1.05f
        val reachable=near && o.camera.y - at.y in .3f..2.3f
        if (!o.siteTracked || !o.siteVisible || !reachable) {
            dwellAt = null
            dwellMs=if(!o.siteTracked)0 else max(0L,dwellMs-gap/2)
            state = state.copy(charge = dwellMs/750f, hint = when {
                !o.siteTracked -> "Objective tracking paused · look back at its surface"
                !o.siteVisible -> "Keep the ${if (site.kind == TrailKind.CRYSTAL) "crystal" else "shrine"} in view"
                else -> "Approach the ${if (site.kind == TrailKind.CRYSTAL) "crystal" else "shrine"} · it stays where you discovered it"
            })
            return emptyList()
        }
        if(dwellAt!=null) dwellMs=(dwellMs+gap).coerceAtMost(750)
        dwellAt=o.now
        val charge = (dwellMs / 750f).coerceIn(0f, 1f)
        state = state.copy(charge = charge, hint = if (site.kind == TrailKind.CRYSTAL) "Gathering crystal…" else "Restoring the shrine…")
        if (charge >= 1f) {
            dwellAt = null;dwellMs=0; sites.addLast(at); while (sites.size > 6) sites.removeFirst()
            lastDiscoveryCamera=o.camera;lastPickupDistance=state.distance
            if (site.kind == TrailKind.CRYSTAL) {
                val total = state.collected + 1
                state = state.copy(collected = total, site = null, charge = 0f,
                    phase = if (total >= 3) TrailPhase.SHRINE else TrailPhase.FRAGMENTS,
                    hint = if (total >= 3) "Three fragments recovered · explore to find their shrine" else "Crystal collected · explore farther for the next one")
                events += emit(TrailEventKind.COLLECTED, at, "Crystal $total / 3 recovered")
            } else {
                baselineActions.clear(); o.participants.forEach { baselineActions[it.id] = it.serial };partyNeedsBaseline=false
                state = state.copy(phase = TrailPhase.PARTY, charge = 0f, hint = "Shrine restored · two party members can wave, dance or jump to celebrate")
                events += emit(TrailEventKind.RESTORED, at, "Shrine restored · a cheer from two different characters completes the trail")
            }
        }
        return events
    }
}

/** Cheap, bounded candidate search over observed polygons plus same-frame depth clearance. */
object TrailPlacement {
    data class Search(val candidate: TrailCandidate?, val hint: String)
    fun choose(record: FrameRecord, surfaces: List<LandingSurface>, depthRequired: Boolean): TrailCandidate? = search(record,surfaces,depthRequired).candidate
    fun search(record: FrameRecord, surfaces: List<LandingSurface>, depthRequired: Boolean, preferred: TrailCandidate? = null, allowed: (FootPosition)->Boolean = { true }): Search {
        if(record.projection.size!=16 || record.projection.any { !it.isFinite() } || record.projection[0]<=0f || record.projection[5]<=0f) return Search(null,"Waiting for calibrated camera tracking")
        if(surfaces.isEmpty()) return Search(null,"Floor not measured · sweep the camera slowly side to side")
        if(depthRequired && record.depth==null) return Search(null,"Waiting for room depth · move slowly in good light")
        val camera = record.displayPose
        var reason="Look a little farther ahead at an open floor"
        fun evaluate(c: TrailCandidate): Search {
            val surface=surfaces.firstOrNull { it.id==c.surfaceId } ?: return Search(null,reason)
            val p=c.foot.copy(y=surface.y)
            if(!listOf(p.x,c.foot.y,p.z,surface.y).all { it.isFinite() } || surface.polygon.size !in 3..256 || surface.polygon.any { !it.u.isFinite() || !it.v.isFinite() } || kotlin.math.abs(surface.y-c.foot.y)>.035f) return Search(null,reason)
            if(hypot(p.x-camera.tx,p.z-camera.tz) !in 1.15f..2.8f || camera.ty-p.y !in .35f..2.2f) return Search(null,reason)
            if(!allowed(p)) return Search(null,"Explore another patch · this ground was already discovered")
            // A prior candidate stays world-fixed while the camera jitters, but must remain in view.
            val delta=FootPosition(p.x-camera.tx,p.y-camera.ty,p.z-camera.tz)
            val local=RigidPose(0f,0f,0f,-camera.qx,-camera.qy,-camera.qz,camera.qw).rotate(delta.x,delta.y,delta.z)
            if(local.z>=-.1f) return Search(null,reason)
            val u=(record.projection[0]*local.x/-local.z-record.projection[8]+1f)*.5f
            val v=(1f-record.projection[5]*local.y/-local.z+record.projection[9])*.5f
            if(u !in .08f.. .92f || v !in .12f.. .96f) return Search(null,reason)
            val patch=PlaneSnapshot(surface.y,surface.polygon)
            val corners=listOf(-.18f to -.18f,-.18f to .18f,.18f to -.18f,.18f to .18f)
            if(corners.any { !patch.contains(p.x+it.first,p.z+it.second,0f) }) return Search(null,"Measured patch too small · scan a wider open floor")
            if(surfaces.any { it.y>p.y+.07f && it.y<p.y+1.05f && PlaneSnapshot(it.y,it.polygon).contains(p.x,p.z,0f) }) return Search(null,"Furniture above this patch · look at open floor beside it")
            val feet=corners.map { (x,z) -> LandingPlanner.depthClearance(record,p.copy(x=p.x+x,z=p.z+z),true) }
            val center=LandingPlanner.depthClearance(record,p,true)
            val body=LandingPlanner.depthClearance(record,p.copy(y=p.y+.35f))
            if(Clearance.BLOCKED in feet || center==Clearance.BLOCKED || body==Clearance.BLOCKED) return Search(null,"Something blocks this patch · scan the floor beside it")
            // One missing edge sample is tolerated; actual blocking evidence is never relaxed.
            val checked=center==Clearance.CLEAR && body==Clearance.CLEAR && feet.count { it==Clearance.CLEAR }>=3
            if(depthRequired && !checked) return Search(null,"Depth incomplete here · hold the open floor in view")
            return Search(c.copy(foot=p,depthChecked=checked),"")
        }
        preferred?.let { evaluate(it).takeIf { result -> result.candidate!=null }?.let { result -> return result } }
        for (v in listOf(.70f, .83f, .58f,.92f)) for (u in listOf(.5f, .35f, .65f,.22f,.78f)) {
            val ray = GroundRay.cameraDirection(u, v, record.projection)
            val direction = camera.rotate(ray.x, ray.y, ray.z)
            for (surface in surfaces.take(24).sortedBy { it.y }) {
                if (!surface.y.isFinite() || camera.ty - surface.y !in .35f..2.2f || surface.polygon.size !in 3..256 || surface.polygon.any { !it.u.isFinite() || !it.v.isFinite() }) continue
                val p = GroundRay.intersect(camera.origin, direction, surface.y, 3.5f) ?: continue
                if (hypot(p.x-camera.tx,p.z-camera.tz) !in 1.15f..2.8f) continue
                val result=evaluate(TrailCandidate(p,surface.id,false))
                if(result.candidate!=null) return result
                reason=result.hint
            }
        }
        return Search(null,reason)
    }
}

/** Depth can miss a frame. Grace is brief and only follows an actual clear observation;
 * blocked evidence immediately stops collection, but requires consensus before hiding visuals. */
class ObjectiveVisibility {
    private var id:String?=null
    private var clearAt=Long.MIN_VALUE
    private val history=ArrayDeque<Clearance>()
    var hidden=false;private set
    fun update(site:String?, evidence:Clearance, now:Long):Boolean {
        if(site!=id) { id=site;clearAt=Long.MIN_VALUE;history.clear();hidden=false }
        if(site==null) return false
        history.addLast(evidence);while(history.size>3)history.removeFirst()
        hidden=history.count { it==Clearance.BLOCKED }>=2
        if(evidence==Clearance.CLEAR)clearAt=now
        return evidence==Clearance.CLEAR || evidence==Clearance.UNKNOWN && clearAt!=Long.MIN_VALUE && now-clearAt in 0..500
    }
}
