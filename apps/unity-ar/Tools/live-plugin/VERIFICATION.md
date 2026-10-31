# Live publisher verification — 2026-10-31

- RootEncoder pinned to 2.8.1, commit cca548ab7942ab50d34dede272d5da90d46c6b67. Tagged source inspected and relevant source hashes retained in upstream-lock.json.
- Roslyn compile using Unity 6000.3.27f1 assemblies: Android player branch and Editor branch, zero errors/warnings in the final run.
- Shared C# self-test core under Unity Mono: PASS (overflow/wrap, 100,000 concurrent stereo frames, 44.1/48 kHz resampling, centred aspect crop).
- Standalone `:live:assembleRelease :smoke:assembleRelease :smoke:testDebugUnitTest`: BUILD SUCCESSFUL; JitPack encoder/common/rtmp/srt 2.8.1 resolved; 3 JVM tests, 0 failures/errors.
- Smoke APK DEX audit: PASS (JNI bridge name retained, Apache license packaged, no references to Android log-writing methods). This includes calls with consumed return values, which require R8 return-value assumptions.
- Smoke APK SHA-256: a931f899952c8d5f86b7be265d23ce1c1c80ec51becc75a18fe9800d8e2ee830.
- Unity batch/GPU test/full RaidRift APK: BLOCKED, no Unity launched by this task. Atomic lock creation at E:\Unity\tmp\unity.lock returned UnauthorizedAccessException. Another builder's existing lock was respected and retried every 60 seconds first. Existing Unity/Gradle project outputs were not used as evidence of a build of this change.
- Phone/Twitch/SRT/thermal/end-to-end A/V tests: unavailable in this environment.

Reproduce Android checks with verify-standalone.ps1. Once the Unity temp directory is writable, run verify-unity.ps1 -Mode All. It acquires/releases the required lock and does not publish the APK. Run `check-apk.py <full-apk> --publisher-only` to repeat the publisher logging/license/JNI audit there; unrelated Unity/platform logs may remain under their own keep rules. The smoke APK passed the stricter whole-DEX audit.

Files added: Assets/RaidRift/Scripts/Live (publisher, audio tap/ring/resampler, NV12 shader, README); Assets/RaidRift/Editor/LiveSelfTest.cs; Android source library, settings/launcher Gradle templates; Tools/live-plugin verification and source-audit files. AndroidManifest.xml permits explicit cleartext RTMP. The only BuildTools.cs change is the marked LIVE block enabling the three custom templates. App/Hud/SceneTracks/StreamOutput/Sfx were not edited.
