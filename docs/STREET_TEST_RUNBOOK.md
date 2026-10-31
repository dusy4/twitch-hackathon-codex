# Three-minute street stream: owner checklist

**November 1, 2026, noon local time.** Setup first, then time the stream. This is a test, not an existing device pass. Details: [MR guide](RAIDRIFT_MR.md). Print or keep on a second device.

## Before leaving

- [ ] PC plugged in, awake, online. From the repo root, keep this server running; do not launch a duplicate:

  ```powershell
  node node_modules/tsx/dist/cli.mjs scripts/tailnet-test.ts --origin https://raidrift-pc.tail7252b4.ts.net --port 3412 --env-file E:/Hermes/.env
  ```

- [ ] Existing Tailscale Serve forwards HTTPS to **127.0.0.1:3412**. If dependencies/assets need setup: `npm ci`, `npm run build` first. Restart loses private test data; phones on 0.20.1+ re-pair and re-select the channel by themselves.
- [ ] Phone **Tailscale on** in the authorized tailnet. On **mobile data**, open [health](https://raidrift-pc.tail7252b4.ts.net/health), then [APK share](https://raidrift-pc.tail7252b4.ts.net/apk/). Install the newest `RaidRift-MR-<version>.apk` there (0.21.15 was published Nov 1 00:37; check the [overnight summary](https://dashboard.12industries.com/previews/raidrift-ui/) for a later known-good build); confirm the version in Setup diagnostics. No build has a device pass yet; this test is that pass.
- [ ] Charge battery, clean lens, free recording space, Do Not Disturb. Shade phone; avoid charging while hot. Start **Mobile data · 2.5 Mbps**; allow roughly 60 MB for three minutes plus overhead/setup. Headset reduces echo.
- [ ] Safe textured pedestrian ground, good light; no traffic, private screens or unwilling bystanders. Stop before using controls. Arrange **two real viewers** and an observer checking received Twitch video/audio. Share `https://www.twitch.tv/YOUR_LOGIN/chat` with the real login. Extension is optional.

## In the app, while stationary

- [ ] Rear camera: sweep floor/furniture slowly → wait for landing or tap measured open floor. Setup diagnostics: NavMesh ready, sensible floor distance.
- [ ] **Setup → Server & testing → Pair with server** at default URL. Re-pair if rejected; blank token does not erase a saved token.
- [ ] Setup → **Twitch channel login + stream key** privately → Quality → **Go live** → allow mic. Do not record key entry; it is saved locally. Leave **Stream to PC off**.
- [ ] Check **LIVE timer + nonzero bitrate**, **chat connected**, and observer-confirmed Twitch picture, voice and game sound. These are separate checks.

## Three-minute order

| Time | Show / ask viewers |
|---|---|
| 0:00–0:35 | Rift and arrivals: arranged **real raid**, or **Setup → Server & testing → Server test raid** on the private harness. Label fixtures **TEST RAID**; their names are simulated. |
| 0:35–1:10 | The stream itself shows "Type !join in chat to drop in a hero", then the command menu (0.21.6+, Setup → Go live → `"!join" hint on stream`). Both viewers `!join`; one `!wave`, other `!jump`. Leave ≥0.5 s between messages and allow Twitch delay. Show separate named heroes. |
| 1:10–1:40 | `!w`, then `!d` separately; `!rift go to 3 and dance` using a **current visible number**. No numbers? Use `!dance`. Try `!rift sit on the chair` only with a measured labelled top. |
| 1:40–2:05 | Stand still. Flip **Selfie** (camera-flip icon on the right rail), then return rear; wait for room tracking. If the toast says the room moved, point at the floor to land again (heroes return with arrival bursts). Unsupported? Show a rear-camera wave instead. |
| 2:05–2:45 | **Follow me** (party icon on the rail); walk slowly on scanned safe ground. Rift relocation needs over **8 m** and valid floor ahead; do not force it or promise it within this test. |
| 2:45–3:00 | Stop, goodbye, red **End**. Observer confirms stream ends. Then **Offline test room** stops polling/frame uploads. |

## Quick recovery

| Problem | Do this |
|---|---|
| No mesh/landing | Sweep textured floor, wait several bakes, try floor tap; read diagnostics. Reset only if scan is wrong. |
| Tracking lost/drift | Stop; reframe scanned area slowly. End/rescan if alignment stays wrong. |
| Stream error/drops/heat | Short signal loss: keep going; if the stream is stuck reconnecting for 30 s the app rebuilds the session itself (diagnostics: "rebuilt Nx"). Otherwise check mic permission, uplink/key privately; End, cool, restart with **Weak signal**. Confirm actual Twitch receipt. |
| LIVE, no chat response | Check Tailscale/health, PC/Serve **3412**, login and pairing; viewer `!join` then `!wave`. Phone chat is simulator-only. Switching Wi-Fi ↔ mobile data is fine: the chat reader runs on the PC and keeps going; the phone resumes polling when the tailnet is back. |
| Missing number/object | Reframe/rescan; use current number or `!dance`, not an old Twitch frame. |
| Selfie stalls | Stay still, point at the room. It recovers by itself within ~12 s; if the camera pose jumped or tracking does not return, the room resets (rescan, point at the floor). Tapping Selfie again also works. |

**Record afterward:** APK version/hash, phone/OS/network, received recording; pass/fail/skipped for scan, two viewers, raid source, mic/SFX, selfie and walking. Keep secrets out. Skipped means **untested**.

**Test-label caveat:** a debug raid during Live can show an ordinary RAID banner. Say “test raid” aloud and caption the recording; it is still synthetic.
