# Boat Android QA

The owner explicitly requested Boat on 2026-10-29 and specified **their Chrome with Google sign-in** for account access. Do not use an isolated/in-app browser for this login.

## Verified documentation and local preparation

Boat's official [virtualization guide](https://docs.boat.dev/machines/virtualization) says every sandbox exposes `/dev/kvm` and documents an accelerated Android emulator. This can address this workstation's disabled firmware virtualization and crashing unsupported Windows software emulator. It is still an emulator, not evidence of a physical phone's tracking/depth accuracy.

Official sources read: [documentation index](https://docs.boat.dev/llms.txt), [virtualization](https://docs.boat.dev/machines/virtualization), [CLI](https://docs.boat.dev/cli-reference) and the supplied [Windows installer](https://boat.dev/install.ps1). The installer was inspected first. CLI **1.0.85** was downloaded from the installer's official endpoint into ignored `.tools/boat/boat.exe`, without changing the PowerShell profile, system PATH, Defender exclusions or existing Boat processes. Its local SHA256 is `02ebb405804f1bf353f5e3b651d3b3c51d3411858d33641e5b3847435d357fdc`; this is a locally recorded hash, not an independently published signature.

At preparation time, the CLI's API health check passes but it reports **signed out**. A Google device connection was generated and opened in installed Chrome; connection URLs/codes/tokens stay in ignored local files, not this document or Git. The automatic Chrome and Node computer-control helpers fail at kernel asset initialization. One combined refresh/open action was rejected by automatic approval review with only “blocked by policy”; generating a fresh manual Chrome connection link through the CLI is available. The account sign-in itself requires the owner's browser interaction. No VM, subscription, payment, public host or account API key has been created by this workflow.

Boat's [trial documentation](https://docs.boat.dev/free-trial) says a card is required for its trial. The [pricing page](https://docs.boat.dev/pricing) documents the monthly minimum and per-VM compute. Do not activate a new subscription or enter payment details automatically. After login, read actual account limits before using already-authorized VM allowance.

## Prepared execution plan

Use one `default` VM (4 vCPU/8 GB), a one-hour TTL, no account environment/secrets, no provider snapshots or command monitoring, and no publicly hosted ports. The emulator needs roughly 3 GB; do not select `small`. Stop/delete the disposable VM after downloading evidence so it cannot run indefinitely.

```powershell
./.tools/boat/boat.exe --no-update --json limits
./.tools/boat/boat.exe --no-update --json new --type default --ttl 3600 --no-env --no-snapshots --no-monitoring --name RaidRift-Android-QA
./.tools/boat/boat.exe scp artifacts/raidrift-capture-debug.apk <id>:/home/user/raidrift-capture-debug.apk
./.tools/boat/boat.exe scp scripts/boat-android-setup.sh <id>:/home/user/boat-android-setup.sh
./.tools/boat/boat.exe exec <id> --detach -- bash -lc 'RAIDRIFT_APK=/home/user/raidrift-capture-debug.apk bash /home/user/boat-android-setup.sh'
```

The setup script verifies KVM access and official Android command-line archive metadata, installs a Google APIs Android 14 emulator and checksum-verified Google Play Services for AR 1.57.0, installs the APK, starts the actual Activity and collects an initial screenshot/accessibility XML. It does not automatically turn screenshots into passing assertions. Inspect the actual frames, Activity process and crash logs.

For independent named-character commands, `node --import tsx scripts/boat-android-world.ts` creates a disposable loopback server on port **3403**. It uses an in-memory database, random signing key, two explicitly synthetic actors and no Twitch/OpenAI credentials or paid inference. Pairing is saved in ignored `.data/boat-android-pairing.json`. Its action endpoint was checked locally: only Juniper changes to sit, while Moss remains idle. This fixture does not change the durable app on port 3400.

`boat forward <id> --reverse --local 3403 --remote 3403` makes only that loopback QA API available inside the VM through SSH. Then `adb reverse tcp:3403 tcp:3403` lets the emulator use `http://127.0.0.1:3403`. Do not expose port 3403 publicly or upload `.env`, the durable database, user camera footage or personal browser profiles. The temporary pairing token stays out of command history/public evidence.

Remaining runtime checks: inspect genuinely 3D model appearance; independent authored actions; camera permission and ARCore availability; actual hit/anchor placement and moving emulated-camera parallax; tracking loss/reset; capability reporting; record a real composited MP4, pull/decode/inspect it, review and discard; pause/revocation/background cleanup. Emulator measurements and video do not establish physical drift, true environmental depth, thermal behavior or native phone→OBS transport. LAN WebRTC inside a NAT-based emulator needs its own connectivity validation.

## Current result

**Prepared, not executed in Boat yet: account authentication is pending.** Android compilation/JVM tests, local native-world/signaling contracts and browser synthetic media are separate evidence. Local Windows emulator failure is recorded in `artifacts/android-emulator-attempt.json`. Do not report a Boat VM or Android runtime pass until actual evidence exists.
