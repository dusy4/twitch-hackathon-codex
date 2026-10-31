package com.raidrift.live;

import com.pedro.encoder.Frame;
import com.pedro.encoder.audio.AudioEncoder;
import com.pedro.encoder.audio.GetAudioData;

/** Java's GetFrame SAM cannot declare interruption; use the protected source hook. */
final class MixedAudioEncoder extends AudioEncoder {
    private final AudioMixer source;
    MixedAudioEncoder(GetAudioData output, AudioMixer source) {
        super(output); this.source = source;
    }
    @Override protected Frame getInputFrame() throws InterruptedException {
        return source.nextFrame();
    }
    @Override public synchronized void stop(boolean resetTs) {
        super.stop(resetTs);
    }
}
