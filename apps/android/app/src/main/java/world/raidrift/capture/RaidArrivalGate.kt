package world.raidrift.capture

/** One bounded pending raid, observed before landing readiness. Replayed snapshots never retrigger.
 * A stale first snapshot is ignored; events received in an active session can wait two minutes. */
class RaidArrivalGate {
    private var initialized=false
    private var seen: String?=null
    private var pending: Raid?=null
    private var received=0L
    fun clear() { initialized=false;seen=null;pending=null;received=0 }
    fun observe(raid:Raid?, epoch:Long, elapsed:Long, consumed:String?=null) {
        val first=!initialized; initialized=true
        if(raid==null || raid.id==seen) return
        seen=raid.id
        if(raid.id==consumed || !raidIsFresh(raid.started,epoch,if(first)30_000 else 120_000)) return
        pending=raid; received=elapsed
    }
    fun take(ready:Boolean, elapsed:Long):Raid? {
        val raid=pending ?: return null
        if(elapsed<received || elapsed-received>120_000) { pending=null;return null }
        if(!ready) return null
        pending=null;return raid
    }
}

/** Delayed landing still gives the newly joined heroes a portal entrance; established players stay put. */
fun portalArrivalEligible(spawned:Long, raidStarted:Long, epoch:Long, portalAge:Long):Boolean {
    if(portalAge !in 0..10_000) return false
    fun ms(value:Long)=if(value in 1..99_999_999_999)value*1000 else value
    if(raidStarted<=0) return raidIsFresh(spawned,epoch,10_000)
    return ms(spawned)>=ms(raidStarted) && ms(spawned)<=epoch+60_000
}
