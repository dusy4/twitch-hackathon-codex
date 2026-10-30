package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class RaidArrivalGateTest {
    private val epoch=1_800_000_000_000L
    @Test fun raidReceivedDuringScanWaitsThenOpensExactlyOnce() {
        val gate=RaidArrivalGate(); gate.observe(null,epoch,0)
        val raid=Raid("one",epoch,3)
        gate.observe(raid,epoch,100)
        assertNull(gate.take(false,45_000))
        assertEquals(raid,gate.take(true,45_100))
        gate.observe(raid,epoch+45_000,45_200)
        assertNull(gate.take(true,45_300))
    }
    @Test fun heroesThatJoinedDuringTheScanStillEnterThroughFreshPortal() {
        assertTrue(portalArrivalEligible(epoch+2000,epoch,epoch+45_000,500))
        assertFalse(portalArrivalEligible(epoch-5000,epoch,epoch+45_000,500))
        assertFalse(portalArrivalEligible(epoch+2000,epoch,epoch+45_000,11_000))
    }
    @Test fun staleInitialSnapshotConsumedLocalRaidAndExpiredQueueNeverReplay() {
        val gate=RaidArrivalGate()
        gate.observe(Raid("stale",epoch-40_000,3),epoch,0)
        assertNull(gate.take(true,0))
        gate.observe(Raid("consumed",epoch,3),epoch,100,"consumed")
        assertNull(gate.take(true,100))
        gate.observe(Raid("fresh",epoch,3),epoch,200)
        assertNull(gate.take(true,121_000))
        gate.observe(Raid("fresh",epoch,3),epoch,121_100)
        assertNull(gate.take(true,121_100))
    }
}
