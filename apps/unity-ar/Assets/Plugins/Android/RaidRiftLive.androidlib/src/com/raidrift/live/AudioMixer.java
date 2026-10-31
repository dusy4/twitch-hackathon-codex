package com.raidrift.live;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import com.pedro.common.TimeUtils;
import com.pedro.encoder.Frame;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.locks.LockSupport;

/** 48 kHz stereo game PCM + mono mic. One producer and one codec consumer. */
final class AudioMixer {
    static final int RATE = 48000, FRAMES = 960;
    private final short[] game = new short[32768];
    private volatile long write, read;
    private final short[] mic = new short[FRAMES];
    private final byte[] pcm = new byte[FRAMES * 4];
    private AudioRecord recorder;
    private AcousticEchoCanceler echo;
    private volatile boolean running = true;
    volatile boolean muted;
    volatile float gameVolume = 1f;
    private long nextUs;
    private final Frame frame;

    AudioMixer(boolean microphone, long origin) {
        nextUs = origin;
        frame = new Frame(pcm, 0, pcm.length, origin);
        try {
        if (microphone) {
            int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException("Microphone format");
            recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(minimum, FRAMES * 8));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED)
                throw new IllegalStateException("Microphone unavailable");
            if (AcousticEchoCanceler.isAvailable()) {
                echo = AcousticEchoCanceler.create(recorder.getAudioSessionId());
                if (echo != null) echo.setEnabled(true);
            }
            recorder.startRecording();
            if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING)
                throw new IllegalStateException("Microphone start");
        }
        } catch (RuntimeException unavailable) {
            close();
            throw unavailable;
        }
    }

    boolean pushGame(ByteBuffer source, int samples) {
        if (!running || samples < 0 || (samples & 1) != 0 || samples * 2 > source.capacity()) return false;
        long w = write;
        if (w - read + samples > game.length) return false;
        source.order(ByteOrder.LITTLE_ENDIAN); source.position(0);
        for (int i = 0; i < samples; i++) game[(int)(w + i) & (game.length - 1)] = source.getShort();
        write = w + samples;
        return true;
    }

    Frame nextFrame() throws InterruptedException {
        long now = TimeUtils.getCurrentTimeMicro();
        if (now - nextUs > 100_000) {
            // A stalled codec must not burst stale sound. Keep clock alignment.
            nextUs = now;
            read = write;
        }
        long remaining;
        while (running && (remaining = nextUs + 20_000 - TimeUtils.getCurrentTimeMicro()) > 0) {
            LockSupport.parkNanos(Math.min(remaining * 1000, 5_000_000));
            if (Thread.interrupted()) throw new InterruptedException();
        }
        if (!running) throw new InterruptedException();
        int count = recorder == null ? 0 : recorder.read(mic, 0, FRAMES, AudioRecord.READ_NON_BLOCKING);
        if (count < 0) throw new IllegalStateException("Microphone read");
        long r = read, w = write;
        // Bound game latency to 80 ms. The consumer alone advances read.
        if (w - r > RATE * 2 * 80 / 1000) r = w - FRAMES * 2;
        float gain = gameVolume;
        for (int i = 0; i < FRAMES; i++) {
            int voice = !muted && i < count ? mic[i] : 0;
            for (int channel = 0; channel < 2; channel++) {
                int sound = r < w ? game[(int)r++ & (game.length - 1)] : 0;
                int mixed = Math.max(-32768, Math.min(32767, voice + Math.round(sound * gain)));
                int offset = (i * 2 + channel) * 2;
                pcm[offset] = (byte)mixed; pcm[offset + 1] = (byte)(mixed >> 8);
            }
        }
        read = r;
        frame.setTimeStamp(nextUs);
        nextUs += 20_000;
        return frame; // AudioEncoder copies this before asking for another frame.
    }

    void cancel() { running = false; }
    void close() {
        running = false;
        if (echo != null) { echo.release(); echo = null; }
        if (recorder != null) {
            try { recorder.stop(); } catch (IllegalStateException ignored) { }
            recorder.release(); recorder = null;
        }
    }
}
