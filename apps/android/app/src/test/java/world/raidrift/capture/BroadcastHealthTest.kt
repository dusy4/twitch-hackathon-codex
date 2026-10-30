package world.raidrift.capture
import org.junit.Assert.*
import org.junit.Test
class BroadcastHealthTest {
    @Test fun connectionWithoutEncodedVideoIsNotOnAir() {
        assertFalse(BroadcastHealth.live(true,true,0,1000))
        assertFalse(BroadcastHealth.live(true,false,900,1000))
        assertFalse(BroadcastHealth.live(false,true,900,1000))
        assertTrue(BroadcastHealth.live(true,true,900,1000))
    }
    @Test fun stalledCameraAndClockDiscontinuityClearLiveStatus() {
        assertFalse(BroadcastHealth.live(true,true,1000,5001))
        assertFalse(BroadcastHealth.live(true,true,2000,1000))
        assertTrue(BroadcastHealth.live(true,true,1000,5000))
    }
}
