package world.raidrift.capture

import org.junit.Assert.*
import org.junit.Test

class PcmEffectsTest {
    private fun sample(b:ByteArray,i:Int)=((b[i*2].toInt() and 255) or (b[i*2+1].toInt() shl 8)).toShort().toInt()
    @Test fun independentPhoneAndRelayReadersHearTheSameEvent() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(960){10000},1_000_000)
        val stereo=m.render(1_000_000,960,2)
        val mono=m.render(1_000_000,960)
        assertTrue(sample(stereo,0)>0);assertTrue(kotlin.math.abs(sample(stereo,0)-sample(mono,0))<=1)
        assertEquals(sample(mono,0),sample(m.render(1_000_000,960),0))
    }
    @Test fun panAttenuatesOppositePhoneChannelAndBroadcastRetainsSignal() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(100){10000},0,pan=-1f)
        val b=m.render(0,50,2)
        assertEquals(10000,sample(b,0));assertEquals(0,sample(b,1))
        assertEquals(5000,sample(m.render(0,50),0))
    }
    @Test fun silenceMuteAndVolumeAreIndependentOfMicrophone() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(100){10000},0)
        m.muted=true
        val mic=ByteArray(200).also { for(i in 0 until 100){ it[i*2]=100;it[i*2+1]=0 } }
        assertTrue(m.render(0,100).all { it==0.toByte() })
        assertEquals(100,sample(m.render(0,100,microphone=mic),0))
        m.muted=false;m.volume=0f
        assertEquals(100,sample(m.render(0,100,microphone=mic),0))
    }
    @Test fun voicesAreBoundedExpireAndCannotOverflowPcm() {
        val m=PcmEffects().also { it.volume=1f }
        repeat(40){m.cue(ShortArray(100){30000},0)}
        assertEquals(12,m.activeVoices)
        assertTrue(sample(m.render(0,100),0) in 30000..32767)
        assertTrue(m.render(1_000_000,100).all { it==0.toByte() });assertEquals(0,m.activeVoices)
    }
    @Test fun microphoneIsCopiedAndSpeechDucksGameEffects() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(100){10000},0)
        val mic=ByteArray(4096).also { for(i in 0 until 2048){it[i*2]=0x10;it[i*2+1]=0x27} }
        val copy=mic.copyOf()
        m.clear();m.cue(ShortArray(4096){10000},0)
        val mixed=m.render(0,2048,microphone=mic)
        assertArrayEquals(copy,mic)
        assertTrue(sample(mixed,0)>sample(mixed,2047))
        assertTrue(sample(mixed,2047) in 13000..14000)
    }
    @Test fun latePhoneReaderPreservesAttackWithoutConsumingOrReplayingRelay() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(2000){ if(it<100)10000 else 1000 },0)
        assertTrue(sample(m.render(80000,100,reader="phone"),0)>6000)
        assertTrue(sample(m.render(0,100,reader="relay"),0)>6000)
        assertTrue(sample(m.render(82500,100,reader="phone"),0)<1000)
    }
    @Test fun timingDoesNotPlayBeforeScheduledAndClearRemovesTails() {
        val m=PcmEffects().also { it.volume=1f }
        m.cue(ShortArray(480){10000},1_000_000)
        assertTrue(m.render(0,100).all { it==0.toByte() })
        assertTrue(sample(m.render(1_000_000,100),0)>0)
        m.clear();assertTrue(m.render(1_000_000,100).all { it==0.toByte() })
    }
}
