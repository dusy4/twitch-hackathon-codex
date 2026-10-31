# RaidRift direct live publisher

`LivePublisher` provides the requested API in namespace `RaidRift`. App/HUD/scene integration is left to the engineer editing those files. Stop the existing WebRTC sender first; simultaneous camera capture is rejected. Bind the backdrop whenever state changes (including the notification when `View` becomes available):

```csharp
var live = gameObject.AddComponent<LivePublisher>();
live.arCamera = arCamera;
live.StateChanged += _ => hud.SetBackdrop(live.View);
live.StartLive(new LiveSettings {
    url = "rtmps://live.twitch.tv:443/app", key = privateStreamKey
});
// live.MicMuted = true; live.GameVolume = 0.5f; live.StopLive();
```

The camera renders once into a screen-sized clean `View`; overlay HUD is excluded. Output is 1280×720 or 720×1280, selected from screen dimensions at start (`landscape` is the fallback hint). Encoder dimensions stay fixed during that session. Screen changes resize the same `View` object; the shader centre-crops without stretching. Restart to change broadcast orientation.

Video uses a GPU BT.709 limited-range NV12 packing shader, then three asynchronous readback slots. Persistent NativeArrays have persistent `AndroidJNI.NewDirectByteBuffer` wrappers. A custom RootEncoder source copies directly into MediaCodec input memory and acknowledges ownership before a slot can be reused. There is no managed frame array, Java frame array, synchronous per-frame readback, or CPU RGB conversion. Teardown waits for outstanding readbacks and crosses a Java copy barrier before releasing memory. This bounded fallback avoids an unverified Unity/shared-EGL/encoder-Surface integration. It still costs GPU readback bandwidth and one codec-input copy.

H.264 requires a hardware encoder advertising NV12 colour format 21; Baseline Level 3.1 (3.2 above 30 fps), two-second GOP plus periodic keyframe requests. Unsupported hardware fails explicitly. GLES buffer row zero samples the top of the picture; X is never mirrored. `flipVideoY` is a diagnostic override, normally false. AR camera display transforms still require a phone check.

Audio attaches a tap to the active AudioListener. Its audio-thread callback resamples 44.1/48 kHz input to stereo 48 kHz through a lock-free bounded ring; the main thread transfers PCM through a reusable direct buffer. Java mixes game PCM with a mono 48 kHz microphone, duplicates the mic into stereo, clips to PCM16, and encodes AAC-LC at 128 kbps. Game audio comes from the listener, not speaker recording. Mic permission is requested at go-live only when `mic=true`; denied permission produces an error. Mic mute and stream game gain are independent. Voice-communication capture enables available echo cancellation; a headset should be used for the first A/V test.

Both encoders use RootEncoder's `TimeUtils` monotonic elapsed-realtime clock and one session origin. Video retains capture timestamps across asynchronous completion; the custom source undoes RootEncoder's independent video rebasing. Audio uses sample-paced timestamps on that clock and skips stale data after stalls.

RTMP, RTMPS and SRT caller mode are supported. Reconnect uses 1/2/4/8/16/30-second backoff plus jitter, retaining encoders and timestamp origin. Congestion reduces bitrate by 25%; healthy periods add 200 kbps up to the configured ceiling. SEVERE thermal status caps capture at 24 fps and lowers bitrate; CRITICAL caps at 20 fps. Statistics sample transport send counters; dropped frames include local capture/readback rejection and transport queue drops, not network retransmissions. Uptime starts at first connection and includes reconnect time. There is no SRTLA/bonding.

For SRT, pass a complete URL or put the stream ID in `key`. Version 2.8.1 uses **latency in milliseconds** (`latency=1000`) and **pbkeylen in bits** (128/192/256). URL-encoded stream IDs/passphrases are decoded once before RootEncoder's raw-query parser. Listener/rendezvous mode and ambiguous/unknown options are rejected. RTMP cleartext is permitted in the manifest for explicitly selected RTMP destinations.

The screen stays awake during capture. App pause releases microphone, encoders, buffers and camera target; resume starts a fresh foreground session. Explicit stop cancels automatic resume. Credentials are held only in session memory; states/errors contain fixed reasons. RootEncoder's `setLogs(false)` does not suppress every server reply, so the custom launcher enables R8 in both build types and consumer rules remove log-writing calls, including calls whose return values are used. Class/member names are preserved for Unity/Niantic JNI and reflection. Keep these templates enabled.

RootEncoder **2.8.1**, commit `cca548ab7942ab50d34dede272d5da90d46c6b67`, matches the existing Kotlin app. Exact tagged source was downloaded and inspected; audited source copies/hashes are under `Tools/live-plugin/upstream-api` and `upstream-lock.json`. Modules: encoder, common, rtmp, srt; **Apache-2.0, Copyright (C) 2024 pedroSG94 / Pedro Sánchez**. Kotlin, kotlinx.coroutines, Ktor and AndroidX transitive components also use Apache-2.0. License and notice are packaged under Android assets/licenses. [Upstream source/license](https://github.com/pedroSG94/RootEncoder/tree/2.8.1).

Verified on 2026-10-31: Android and Editor C# compilation against installed Unity assemblies; ring wrap/overflow/100,000-frame concurrent ordering; mono/stereo resampling across uneven callbacks; crop aspect/centering; standalone AGP 9.1.1/Gradle 9.3.1 plugin and smoke APK build with JitPack dependency resolution; three ingest-validation JVM tests; packaged license/JNI retention and absence of Android log-writing references in smoke APK DEX. Run `Tools/live-plugin/verify-standalone.ps1` to repeat the Android checks.

**Unity batch compile, the GPU portion of `RaidRift.EditorTools.LiveSelfTest.Run`, and the full RaidRift APK were not run:** creating the required `E:\Unity\tmp\unity.lock` was denied by this session's filesystem permissions after waiting for the other build. `Tools/live-plugin/verify-unity.ps1 -Mode All` implements atomic locking, 60-second retries, the requested compile, self-test and non-publishing APK build.

Device testing remains required: Samsung hardware format/stride support; GLES top/bottom and colour bars; real AR background/portal/occlusion with HUD excluded; received H.264/AAC sync and mix levels; permission denial, pause/resume and repeated start/stop; Twitch RTMPS authentication, SRT relay reception, mobile handoffs/outages and adaptive recovery; sustained thermal and readback performance. The standalone smoke APK is a packaging check, not the RaidRift app or evidence of an on-device broadcast.
