# Independent official ARCore reference

`renderer-experiments.patch` preserves the paused, unproven application renderer experiments (camera draw order, descendant frame updates and debug mesh diagnostics). It is **not applied** to the default LAN test APK. It is retained for investigation, not a claimed rendering fix.

This is benchmark metadata and a small diagnostic patch, not a replacement product renderer.

Upstream: https://github.com/google-ar/arcore-android-sdk
Pinned commit: `204ddfd1715eb0cb775bf7528c9aee9d93cd4d4a`.
Sample: `samples/hello_ar_java`.

The unmodified Java sample was built and installed first. The local build used AGP 9.4.1 instead of 9.3.0 after a transient Google Maven TLS error. Both versions use ARCore 1.57.0 and compile SDK 37; our installed JDK21/Gradle9.8.1 toolchain built the adjusted project successfully. Camera/feature points were inspected; stable surface placement did not pass on the software-rendered emulator.

`minimal-lighting.patch` is a second, explicitly modified comparison: disables ARCore light estimation, adds one-per-second camera/plane/anchor/timestamp diagnostics, and applies the cached AGP version. It does not inject a trackable, hit result, anchor, camera frame or pose. Apply from the pinned upstream checkout root with `git apply <absolute-path-to-minimal-lighting.patch>`, then build that sample. The patch is not needed by the production application.

Source/sample licensing: Google's repository [LICENSE](https://github.com/google-ar/arcore-android-sdk/blob/204ddfd1715eb0cb775bf7528c9aee9d93cd4d4a/LICENSE) distinguishes Apache-2.0 sample source from separately licensed SDK binaries. Preserve upstream license and notices when copying the sample. No Google sample assets are bundled in the RaidRift APK.

Evidence: `artifacts/android-google-ar-reference.png`, `android-google-ar-two-core.png`, `android-google-ar-no-hdr.png`, `android-google-ar-no-hdr.txt`. The last run reports intermittent tracking, zero horizontal planes and zero anchors during the captured interval. These are failed/open placement gates, not passing character AR proof. The separate `tests/android-arcore-probe` omits camera composition and did detect planes; that difference is intentional and identifies rendering load as an investigation direction.
