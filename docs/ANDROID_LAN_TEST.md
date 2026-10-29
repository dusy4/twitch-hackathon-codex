# Test Android with a laptop on the same Wi-Fi

This test uses your laptop as the world server and your Android phone as the camera/3D renderer. No cloud server, USB connection, Twitch account, OpenAI key or paid service is required. All identities and actions in this setup are labelled **SIMULATOR**. Two characters are created automatically; the database resets when the test server stops.

**Current limitation:** camera-off 3D rendering and native relay output have lab evidence. Surfaces and anchors have been detected in the Android emulator, but the captured AR frames have not yet demonstrated a clearly visible character mesh in the room. Test the phone's actual image, not just the “anchor placed” message. This build is for finding that behavior on real hardware, not a release-readiness claim.

## 1. Start the laptop server

Install [Node.js](https://nodejs.org/en/download) **24 or newer** and Git. Connect the laptop and phone to the same trusted private Wi-Fi; avoid an isolated guest network.

In PowerShell or a terminal:

```sh
git clone https://github.com/dusy4/twitch-hackathon-codex.git
cd twitch-hackathon-codex
npm ci
npm run lan:test
```

The command builds the website, chooses a private Wi-Fi/Ethernet IPv4 address and starts the server on port **3400**. Keep this terminal open. It prints URLs like:

```text
Creator/pairing: http://192.168.1.20:3400/dashboard
Viewer controls: http://192.168.1.20:3400/controller?room=demo-world
Phone health check: http://192.168.1.20:3400/health
```

**Use the address actually printed on your laptop**, not the example above. To choose an adapter or another port explicitly:

```sh
npm run lan:test -- --host 192.168.1.20 --port 3400
```

Public addresses and wildcard listeners are refused by this launcher. Do not use `localhost`, `127.0.0.1` or the emulator-only `10.0.2.2` as the laptop address on a physical phone.

On the phone, open the printed **health-check URL in Chrome**. It must display JSON containing `"status":"ok"` before you try pairing.

If Windows Firewall blocks the connection, allow Node.js on **Private networks**. Alternatively, from an elevated PowerShell on a trusted Private-profile network:

```powershell
New-NetFirewallRule -DisplayName "RaidRift LAN test 3400" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3400 -Profile Private -RemoteAddress LocalSubnet
```

To remove that rule after testing:

```powershell
Remove-NetFirewallRule -DisplayName "RaidRift LAN test 3400"
```

## 2. Install the APK

Download **raidrift-android-lan-test.apk** from the [GitHub prerelease](https://github.com/dusy4/twitch-hackathon-codex/releases/tag/android-lan-test-2026-10-29) on your phone and install it. This repository is private, so sign into your GitHub account on the phone to download the asset. Android may ask you to allow installation from that browser/file manager. Version: **0.3.0-lan-test**, application ID `world.raidrift.capture.android`.

The APK contains the 3D models. Camera-off preview works without the laptop. Room AR requires an ARCore-supported Android device and Google Play Services for AR. The build targets 64-bit ARM phones, Android 7/API24 or newer; hardware support still varies.

This is a locally signed **debug build**. Its HTTP exception is limited by application validation to private IPv4/loopback server addresses; production server connections require HTTPS. HTTP pairing on this build is intended for trusted private Wi-Fi. Do not enter real Twitch or relay-provider credentials into the LAN simulator.

## 3. Pair on the phone

1. In **phone Chrome**, open the printed creator URL, for example `http://192.168.1.20:3400/dashboard`.
2. Choose **Try creator simulator**, then **Pair native AR + share composed video**.
3. Press **Copy pairing token**. The token is masked on the page and lasts one hour.
4. Switch to the RaidRift Android app and choose **Pair room**.
5. Replace the default server address with the laptop URL, for example `http://192.168.1.20:3400`, and paste the token. Choose **Connect**.

The app should report a connected simulator and show the two named characters in **3D PREVIEW · CAMERA OFF**. If you restart the laptop test server, its signing key changes: create a new pairing token and reconnect. Stop/revocation/expired pairing deliberately hide paired content and stop output.

## 4. Control a character from the laptop

Open the printed **viewer controls URL** on the laptop. Choose **Try viewer simulator** if prompted. This controls **Mossling**, one of the two seeded characters; **Emberfox** is a second independent character.

Try **Sit**, **Wave**, and movement controls. First confirm that the phone's camera-off 3D preview changes with the commands. This isolates connectivity from AR tracking.

Then, on the phone:

1. Choose **Start room AR**, grant camera permission and point at a well-lit, textured desk or floor.
2. Move the phone slowly while surfaces are detected, then tap a detected surface.
3. Check whether the actual 3D character appears. Move sideways and around it: perspective should change while its feet remain at the placement.
4. Repeat a laptop action and inspect the actual phone image. Movement beyond observed support can freeze; unknown floor geometry is not replaced with an invented floor.
5. Try **Record 20s**, then **Review**. Local clips are silent. Capture stops on lost tracking/backgrounding and may end early. A connected label or successful anchor alone is not a visible-character pass.

Useful test notes: phone model/Android version, whether preview models appear, whether room surfaces are found, whether the mesh appears after placement, whether it stays coherent through camera movement, whether laptop commands arrive, and a short reviewed capture if available. Dynamic object/dog interaction and hand occlusion remain incomplete.

## 5. Optional: receive video in laptop OBS

The world server on port 3400 carries **world state and commands**. Camera video uses the phone's separate **Broadcast** output:

```text
Laptop world server :3400 → phone characters/actions
Phone camera + characters + optional mic → media relay → laptop OBS
```

You can use an existing private SRT/RTMPS relay. For a local rehearsal, download the Windows binary from the [official MediaMTX 1.21.3 release](https://github.com/bluenviron/mediamtx/releases/tag/v1.21.3), extract it and run:

```powershell
.\mediamtx.exe C:\path\to\twitch-hackathon-codex\infra\lan-relay.yml
```

Allow inbound **TCP 1935 on the Private network/LocalSubnet** if your firewall blocks the phone. RTSP receiving is bound to laptop loopback. The checked-in configuration is a trusted-LAN test setup, with anonymous private-network publishing to one fixed path and a loopback-only reader; use your normal authenticated provider setup for an actual broadcast.

On the phone, **Broadcast** to:

```text
rtmp://YOUR-LAPTOP-IP:1935/live/raidrift
```

Enable microphone and output consent only if desired. In OBS add a **Media Source**, clear **Local File**, and use:

```text
rtsp://lan-preview:lan-test-only@127.0.0.1:8554/live/raidrift
```

Start with camera-off preview to test transport; then test AR separately. Compose controls/tokens should not appear in the video. Camera-off broadcasting works for setup; AR broadcasting requires a tracked anchor and stops when tracking is lost. This local RTMP/RTSP recipe is unencrypted. Measure the delay and review a private OBS recording before considering a real stream. The separate lab WHEP receiver measurements do not establish latency for your phone or this RTSP path.

## Troubleshooting and stopping

- **Phone Chrome cannot open `/health`:** wrong laptop IP, different/guest Wi-Fi, VPN routing, firewall or server not running. Fix this before pairing. On Windows, `ipconfig` shows the active Wi-Fi IPv4 address.
- **Address already in use:** stop the other server with Ctrl+C, or use `--port 3404` and include that port everywhere.
- **401/403 or expired pairing:** create a fresh creator pairing after restarting the server. Use its camera token, not an OBS overlay token.
- **3D preview works; AR mesh missing:** that is an open rendering/tracking test, not proof of a LAN problem. Record the exact on-screen behavior.
- **Clipboard unavailable:** copy the token manually from the pairing field; the site includes a fallback for plain HTTP LAN pages.
- **Stopping:** stop Broadcast in the app, close room AR, then Ctrl+C in the laptop server and optional MediaMTX terminals. The LAN simulator keeps no persistent accounts or scores.

Development checks: `npm run build`, `npm run lint`, `node --import tsx --test --test-concurrency=2 tests/*.test.ts`, and `npx playwright test --config playwright.lan.config.ts`. The LAN browser test uses a real private HTTP origin when available and checks pairing copy, UUID fallback, viewer action and the native snapshot. These checks do not replace a physical Android test.
