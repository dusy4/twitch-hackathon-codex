package com.raidrift.live;

import android.app.Activity;
import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.media.MediaCodecInfo;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import com.pedro.common.ConnectChecker;
import com.pedro.common.TimeUtils;
import com.pedro.encoder.CodecErrorCallback;
import com.pedro.encoder.audio.AudioEncoder;
import com.pedro.encoder.audio.GetAudioData;
import com.pedro.encoder.utils.CodecUtil;
import com.pedro.encoder.video.FormatVideoEncoder;
import com.pedro.encoder.video.GetVideoData;
import com.pedro.rtmp.rtmp.RtmpClient;
import com.pedro.srt.srt.SrtClient;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadLocalRandom;

/** Instance per live session. Only fixed, credential-free status strings cross JNI. */
public final class LiveBridge {
    private final HandlerThread thread = new HandlerThread("RaidRift live control");
    private final Handler control;
    private final PowerManager power;
    private PowerManager.OnThermalStatusChangedListener thermalListener;
    private volatile DirectVideoEncoder video;
    private AudioEncoder audio;
    private volatile AudioMixer mixer;
    private RtmpClient rtmp;
    private SrtClient srt;
    private volatile boolean active = true, connected, retryPending, awaitKeyframe = true;
    private boolean stopped;
    private volatile String state = "connecting";
    private volatile int bitrate, targetFps, thermal, dropped;
    private volatile float sendFps;
    private volatile boolean muted;
    private volatile float gameVolume = 1f;
    private final long origin = TimeUtils.getCurrentTimeMicro();
    private volatile long firstConnected;
    private long attemptStarted = origin, stableSince, lastProgress;
    private long previousSent, previousDropped, lastTick = origin, lastRaise;
    private int retries, healthyTicks;
    private final int desiredFps, minimum, maximum, initial;
    private final boolean adaptive;

    public LiveBridge(Activity activity, String url, String key, int width, int height,
                      int fps, int startKbps, int minKbps, int maxKbps,
                      boolean adaptive, boolean microphone) {
        desiredFps = fps;
        targetFps = fps;
        minimum = minKbps; maximum = maxKbps; initial = startKbps; bitrate = startKbps;
        this.adaptive = adaptive;
        power = (PowerManager)activity.getSystemService(Context.POWER_SERVICE);
        thread.start(); control = new Handler(thread.getLooper());
        // Do not retain the Activity or log exception messages/URLs, even on failure.
        control.post(() -> {
            if (!active) return;
            String endpoint;
            try { endpoint = endpoint(url, key); }
            catch (Exception invalid) { fail("invalid ingest settings"); return; }
            try {
                setup(endpoint, width, height, microphone);
            } catch (IllegalArgumentException invalid) { fail("invalid ingest settings"); }
            catch (Exception unavailable) { fail("encoder or microphone unavailable"); }
        });
    }

    private static String endpoint(String url, String key) throws Exception {
        if (url == null || url.length() > 4096 || key == null || key.length() > 2048)
            throw new IllegalArgumentException();
        URI uri = new URI(url);
        String scheme = uri.getScheme();
        if (!("rtmp".equals(scheme) || "rtmps".equals(scheme) || "srt".equals(scheme))
                || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || uri.getPort() > 65535 || uri.getPort() == 0 || url.chars().anyMatch(Character::isWhitespace)
                || key.chars().anyMatch(c -> c < 33)) throw new IllegalArgumentException();
        if ("srt".equals(scheme)) {
            if (uri.getPort() < 1) throw new IllegalArgumentException();
            Map<String, String> options = new HashMap<>();
            if (uri.getRawQuery() != null) for (String option : uri.getRawQuery().split("&")) {
                String[] pair = option.split("=", 2);
                if (pair.length != 2 || options.put(pair[0], URLDecoder.decode(pair[1], "UTF-8")) != null)
                    throw new IllegalArgumentException();
            }
            for (String name : options.keySet())
                if (!(name.equals("streamid") || name.equals("latency") || name.equals("passphrase")
                        || name.equals("pbkeylen") || name.equals("mode"))) throw new IllegalArgumentException();
            if (options.containsKey("mode") && !options.get("mode").equals("caller"))
                throw new IllegalArgumentException();
            // Exact 2.8.1 semantics: latency is milliseconds, encryption key size is bits.
            if (options.containsKey("latency")) {
                int latency = Integer.parseInt(options.get("latency"));
                if (latency < 20 || latency > 5000) throw new IllegalArgumentException();
            }
            if (options.containsKey("passphrase")) {
                int length = options.get("passphrase").length();
                if (length < 10 || length > 79) throw new IllegalArgumentException();
            }
            if (options.containsKey("pbkeylen") && (!options.containsKey("passphrase")
                    || !java.util.Arrays.asList("128", "192", "256").contains(options.get("pbkeylen"))))
                throw new IllegalArgumentException();
            if (!key.isEmpty()) {
                if (options.containsKey("streamid")) throw new IllegalArgumentException();
                options.put("streamid", key);
            }
            if (options.getOrDefault("streamid", "").isEmpty()
                    && (uri.getRawPath() == null || uri.getRawPath().length() < 2))
                throw new IllegalArgumentException();
            // RootEncoder's UrlParser does not URL-decode option values. Decode
            // exactly once here, then pass its expected raw streamid/passphrase.
            StringBuilder result = new StringBuilder(url.split("\\?", 2)[0]);
            char separator = '?';
            for (Map.Entry<String, String> option : options.entrySet()) {
                if (option.getKey().equals("mode")) continue;
                if (option.getValue().contains("&")
                        || option.getValue().chars().anyMatch(c -> c < 32)) throw new IllegalArgumentException();
                result.append(separator).append(option.getKey()).append('=').append(option.getValue());
                separator = '&';
            }
            return result.toString();
        }
        if (uri.getRawPath() == null || uri.getRawPath().length() < 2) throw new IllegalArgumentException();
        if (!key.isEmpty()) {
            if (uri.getRawQuery() != null || key.contains("/") || key.contains("#")) throw new IllegalArgumentException();
            return url.replaceAll("/+$", "") + "/" + key;
        }
        // Full private publish URLs are also supported; never reflected to UI.
        if (uri.getRawPath().lastIndexOf('/') < 1) throw new IllegalArgumentException();
        return url;
    }

    private void setup(String endpoint, int width, int height, boolean microphone) {
        ConnectChecker checker = new ConnectChecker() {
            public void onConnectionStarted(String ignored) { post(() -> {
                retryPending = false; attemptStarted = now();
            }); }
            public void onConnectionSuccess() { post(() -> {
                connected = true; retryPending = false; awaitKeyframe = true;
                stableSince = now(); lastProgress = now();
                if (firstConnected == 0) firstConnected = now();
                if (video != null) video.requestKeyframe();
            }); }
            public void onConnectionFailed(String reason) { post(() -> {
                if (reason.contains("Endpoint malformed")) fail("invalid ingest settings");
                else if (reason.contains("NetStream.Publish.BadName") || reason.contains("NetStream.Publish.Denied")
                        || reason.contains("NetConnection.Connect.Rejected")) fail("ingest rejected");
                else retry(); // Do not surface server-controlled reason text.
            }); }
            public void onDisconnect() { post(() -> retry()); }
            public void onAuthError() { post(() -> fail("authentication rejected")); }
            public void onAuthSuccess() { }
            public void onNewBitrate(long bits) { /* Transport throughput is sampled through queue progress. */ }
        };
        if (endpoint.startsWith("srt:")) {
            srt = new SrtClient(checker);
            srt.setAudioInfo(AudioMixer.RATE, true); srt.setReTries(Integer.MAX_VALUE);
            srt.setLogs(false); srt.resizeCache(90);
        } else {
            rtmp = new RtmpClient(checker);
            rtmp.setAudioInfo(AudioMixer.RATE, true); rtmp.setReTries(Integer.MAX_VALUE);
            rtmp.setLogs(false); rtmp.resizeCache(90);
            rtmp.setVideoResolution(width, height); rtmp.setFps(desiredFps);
        }
        DirectVideoEncoder encoder = new DirectVideoEncoder(new GetVideoData() {
            public void onVideoInfo(ByteBuffer sps, ByteBuffer pps, ByteBuffer vps) {
                if (!active) return;
                if (rtmp != null) rtmp.setVideoInfo(sps.duplicate(), duplicate(pps), duplicate(vps));
                if (srt != null) srt.setVideoInfo(sps.duplicate(), duplicate(pps), duplicate(vps));
            }
            public void getVideoData(ByteBuffer data, MediaCodec.BufferInfo info) {
                if (!active || !connected || info.size <= 0
                        || (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) return;
                if (awaitKeyframe) {
                    if ((info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) == 0) return;
                    awaitKeyframe = false;
                }
                if (rtmp != null) rtmp.sendVideo(data, info);
                if (srt != null) srt.sendVideo(data, info);
            }
            public void onVideoFormat(MediaFormat ignored) { }
        }, width, height);
        video = encoder;
        encoder.setEncoderErrorCallback(errors("video encoder"));
        encoder.forceBt709Color(true);
        if (!encoder.prepareVideoEncoder(width, height, desiredFps, initial * 1000, 0, 2,
                FormatVideoEncoder.YUV420SEMIPLANAR, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline,
                desiredFps > 30 ? MediaCodecInfo.CodecProfileLevel.AVCLevel32
                        : MediaCodecInfo.CodecProfileLevel.AVCLevel31)) throw new IllegalStateException();
        AudioMixer source = new AudioMixer(microphone, now());
        mixer = source;
        source.muted = muted; source.gameVolume = gameVolume;
        audio = new MixedAudioEncoder(new GetAudioData() {
            public void getAudioData(ByteBuffer data, MediaCodec.BufferInfo info) {
                if (!active || !connected || awaitKeyframe || info.size <= 0
                        || (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) return;
                if (rtmp != null) rtmp.sendAudio(data, info);
                if (srt != null) srt.sendAudio(data, info);
            }
            public void onAudioFormat(MediaFormat ignored) { }
        }, source);
        audio.setEncoderErrorCallback(errors("audio encoder"));
        if (!audio.prepareAudioEncoder(128_000, AudioMixer.RATE, true)) throw new IllegalStateException();
        encoder.start(origin); audio.start(origin);
        if (android.os.Build.VERSION.SDK_INT >= 29 && power != null) {
            thermalListener = status -> post(() -> { thermal = status; applyThermal(); });
            power.addThermalStatusListener(thermalListener);
            thermal = power.getCurrentThermalStatus(); applyThermal();
        }
        if (rtmp != null) rtmp.connect(endpoint);
        if (srt != null) srt.connect(endpoint);
        control.postDelayed(tick, 1000);
    }

    private CodecErrorCallback errors(String component) {
        return new CodecErrorCallback() {
            public void onCodecError(CodecUtil.CodecTypeError type, MediaCodec.CodecException ignored) {
                post(() -> fail(component));
            }
            public boolean onEncodeError(CodecUtil.CodecTypeError type, IllegalStateException ignored) {
                post(() -> fail(component)); return false;
            }
        };
    }
    private static ByteBuffer duplicate(ByteBuffer buffer) { return buffer == null ? null : buffer.duplicate(); }
    private long now() { return TimeUtils.getCurrentTimeMicro(); }
    private void post(Runnable action) { control.post(() -> { if (active) action.run(); }); }

    private void retry() {
        if (!active || retryPending) return;
        connected = false; sendFps = 0; awaitKeyframe = true;
        retryPending = true; retries++; healthyTicks = 0;
        state = "reconnecting (" + retries + ")";
        if (adaptive) setBitrate(Math.max(minimum, bitrate * 3 / 4));
        long delay = Math.min(30_000, 1000L << Math.min(5, retries - 1));
        delay += ThreadLocalRandom.current().nextLong(Math.max(1L, delay / 5));
        if (rtmp != null) rtmp.reConnect(delay);
        if (srt != null) srt.reConnect(delay);
        // Reconnect operates on the transport only. Both encoders keep their origin.
    }

    private int thermalCeiling() {
        return thermal >= PowerManager.THERMAL_STATUS_SEVERE
                ? Math.max(minimum, initial * 3 / 5) : maximum;
    }
    private void applyThermal() {
        targetFps = Math.min(desiredFps, thermal >= PowerManager.THERMAL_STATUS_CRITICAL ? 20
                : thermal >= PowerManager.THERMAL_STATUS_SEVERE ? 24 : desiredFps);
        if (bitrate > thermalCeiling()) setBitrate(thermalCeiling());
        else if (!adaptive && thermal < PowerManager.THERMAL_STATUS_SEVERE) setBitrate(initial);
    }
    private void setBitrate(int kbps) {
        bitrate = Math.max(minimum, Math.min(thermalCeiling(), Math.min(maximum, kbps)));
        if (video != null) video.setVideoBitrateOnFly(bitrate * 1000);
    }

    private final Runnable tick = new Runnable() {
        public void run() {
            if (!active) return;
            try {
                long time = now();
                long sent = rtmp != null ? rtmp.getSentVideoFrames() : srt.getSentVideoFrames();
                long lost = rtmp != null ? rtmp.getDroppedVideoFrames() : srt.getDroppedVideoFrames();
                dropped += (int)(lost >= previousDropped ? lost - previousDropped : lost);
                previousDropped = lost;
                sendFps = connected ? (sent >= previousSent ? sent - previousSent : sent) * 1_000_000f / (time - lastTick) : 0f;
                previousSent = sent; lastTick = time;
                if (sendFps > 0 && connected && !awaitKeyframe) { lastProgress = time; state = "live"; }
                else if (connected && time - lastProgress > 3_000_000) state = "connecting";
                if (connected && time - lastProgress > 10_000_000) retry();
                if (!connected && !retryPending && time - attemptStarted > 25_000_000) retry();
                boolean congested = rtmp != null ? rtmp.hasCongestion(20f) : srt.hasCongestion(20f);
                if (adaptive && connected) {
                    if (congested) { setBitrate(bitrate * 3 / 4); healthyTicks = 0; }
                    else if (++healthyTicks >= 10 && time - lastRaise > 10_000_000) {
                        setBitrate(bitrate + 200); lastRaise = time; healthyTicks = 0;
                    }
                }
                if (connected && time - stableSince > 30_000_000) retries = 0;
                if (video != null) video.requestKeyframe();
            } catch (Exception ignored) { fail("publisher unavailable"); }
            if (active) control.postDelayed(this, 2000);
        }
    };

    public long clockUs() { return now(); }
    public String getState() { return state; }
    public boolean isLive() { return active && connected && "live".equals(state); }
    public int getBitrateKbps() { return bitrate; }
    public int getTargetFps() { return targetFps; }
    public float getSendFps() { return sendFps; }
    public int getDroppedFrames() { return dropped; }
    public float getUptimeSeconds() { return firstConnected == 0 ? 0 : (now() - firstConnected) / 1_000_000f; }
    public void setMicMuted(boolean value) { muted = value; AudioMixer m = mixer; if (m != null) m.muted = value; }
    public void setGameVolume(float value) {
        gameVolume = Math.max(0f, Math.min(1f, value)); AudioMixer m = mixer;
        if (m != null) m.gameVolume = gameVolume;
    }
    public boolean submitVideo(ByteBuffer buffer, long pts, int slot) {
        DirectVideoEncoder v = video;
        return active && v != null && now() - pts < 200_000 && v.submit(buffer, pts, slot);
    }
    public int takeReleasedSlots() { DirectVideoEncoder v = video; return v == null ? 0 : v.takeReleased(); }
    public boolean pushGameAudio(ByteBuffer buffer, int samples) {
        AudioMixer m = mixer; return active && m != null && m.pushGame(buffer, samples);
    }

    private void fail(String fixedReason) {
        state = "error: " + fixedReason; active = false; connected = false;
        cleanup();
    }
    private void cleanup() {
        // This barrier must precede ANY platform operation which could throw.
        // stop() guarantees that Unity can free its direct buffers afterward.
        DirectVideoEncoder v = video;
        if (v != null) v.closeInput();
        control.removeCallbacks(tick);
        if (android.os.Build.VERSION.SDK_INT >= 29 && power != null && thermalListener != null) {
            try { power.removeThermalStatusListener(thermalListener); } catch (Exception ignored) { }
            thermalListener = null;
        }
        AudioMixer m = mixer;
        if (m != null) m.cancel();
        if (audio != null) { try { audio.stop(); } catch (Exception ignored) { } audio = null; }
        if (v != null) { try { v.stop(); } catch (Exception ignored) { } }
        // Retain the closed source until stop returns; slot ownership remains observable.
        if (m != null) { try { m.close(); } catch (Exception ignored) { } }
        mixer = null;
        if (rtmp != null) { try { rtmp.disconnect(); } catch (Exception ignored) { } }
        if (srt != null) { try { srt.disconnect(); } catch (Exception ignored) { } }
        sendFps = 0;
    }
    public synchronized void stop() {
        if (stopped) return;
        stopped = true;
        active = false; connected = false;
        CountDownLatch done = new CountDownLatch(1);
        control.post(() -> { try { cleanup(); state = "idle"; } finally { done.countDown(); } });
        boolean interrupted = false;
        for (;;) try { done.await(); break; } catch (InterruptedException ignored) { interrupted = true; }
        thread.quitSafely();
        if (interrupted) Thread.currentThread().interrupt();
    }
}
