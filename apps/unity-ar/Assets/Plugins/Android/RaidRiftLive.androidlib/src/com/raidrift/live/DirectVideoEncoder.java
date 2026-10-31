package com.raidrift.live;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import com.pedro.encoder.TimestampMode;
import com.pedro.encoder.utils.CodecUtil;
import com.pedro.encoder.video.GetVideoData;
import com.pedro.encoder.video.VideoEncoder;
import java.nio.ByteBuffer;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;

/** RootEncoder custom buffer source: Unity owns the memory until takeReleased(). */
final class DirectVideoEncoder extends VideoEncoder {
    private static final class Input {
        final ByteBuffer data;
        final long timestamp;
        final int slot;
        Input(ByteBuffer data, long timestamp, int slot) {
            this.data = data; this.timestamp = timestamp; this.slot = slot;
        }
    }
    private final ArrayBlockingQueue<Input> inputs = new ArrayBlockingQueue<>(3);
    private final AtomicInteger released = new AtomicInteger();
    private final Object copyLock = new Object();
    private volatile boolean accepting = true;
    private final int bytes;
    private long newestTimestamp;

    DirectVideoEncoder(GetVideoData output, int width, int height) {
        super(output);
        bytes = width * height * 3 / 2;
        setTimestampMode(TimestampMode.BUFFER);
    }

    @Override protected MediaCodecInfo chooseEncoder(String mime) {
        // RootEncoder's default chooser accepts either YUV layout. We require
        // tightly packed NV12 (21), never a software encoder or a guessed layout.
        for (MediaCodecInfo info : CodecUtil.getAllHardwareEncoders(mime, true)) {
            MediaCodecInfo.CodecCapabilities caps = CodecUtil.getCapabilities(info, mime);
            if (caps == null) continue;
            for (int color : caps.colorFormats)
                if (color == MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar) return info;
        }
        return null;
    }

    synchronized boolean submit(ByteBuffer data, long timestamp, int slot) {
        if (!accepting || !isRunning() || data == null || !data.isDirect()
                || data.capacity() != bytes || slot < 0 || slot > 2
                || timestamp <= newestTimestamp) return false;
        // JNI creates a wrapper only; no byte[] or full-frame intermediate copy.
        data.position(0); data.limit(bytes);
        if (!inputs.offer(new Input(data, timestamp, slot))) return false;
        newestTimestamp = timestamp;
        return true;
    }

    int takeReleased() { return released.getAndSet(0); }
    private void release(Input frame) { released.getAndUpdate(mask -> mask | (1 << frame.slot)); }

    @Override public synchronized void stop(boolean resetTs) {
        // BaseEncoder can also stop itself from an error callback. Serialize it
        // with control-thread teardown so codec release cannot race itself.
        super.stop(resetTs);
    }

    @Override public void inputAvailable(MediaCodec codec, int index) {
        try {
            Input frame = inputs.take();
            synchronized (copyLock) {
                try {
                    if (!accepting) return;
                    ByteBuffer target = codec.getInputBuffer(index);
                    if (target == null || target.capacity() < bytes)
                        throw new IllegalStateException("NV12 input capacity");
                    target.clear();
                    target.put(frame.data);
                    codec.queueInputBuffer(index, 0, bytes,
                            Math.max(0L, frame.timestamp - presentTimeUs), 0);
                } finally { release(frame); }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    @Override protected boolean checkBuffer(ByteBuffer buffer, MediaCodec.BufferInfo info) {
        // Keep RootEncoder's SPS/PPS extraction, but undo its per-video origin
        // rebasing. AAC and video must retain the SAME session origin.
        long capturePts = info.presentationTimeUs;
        boolean valid = super.checkBuffer(buffer, info);
        info.presentationTimeUs = capturePts;
        return valid;
    }

    void closeInput() {
        accepting = false;
        // A codec callback may already hold an Input. Barrier before Unity frees
        // its NativeArrays, even if BaseEncoder.stop's thread join times out.
        synchronized (copyLock) {
            Input frame;
            while ((frame = inputs.poll()) != null) release(frame);
        }
    }
}
