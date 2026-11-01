# Three-minute stream: owner checklist (app 0.23.3)

Updated **November 1, 2026**, for the public server `https://raidrift.12industries.com`. No Tailscale and no PC process to start. Keep this on a second device. Details: [MR guide](RAIDRIFT_MR.md). Anything marked *unverified* has not been seen working on the phone yet.

## Before you start

- [ ] Server up: open `https://raidrift.12industries.com/health` on the phone → `{"status":"ok"…}`. Don't restart it during the stream: rooms are in memory, so a restart drops every hero (the app re-pairs by itself).
- [ ] Install **[RaidRift-latest.apk](https://raidrift.12industries.com/apk/RaidRift-latest.apk)** (~128 MB, use Wi-Fi). Setup diagnostics must show **v0.23.3**.
- [ ] Grant **camera and microphone** in Android settings *before* Go live. A denied mic currently fails the whole stream.
- [ ] Charge the battery, clean the lens, turn on Do Not Disturb, keep the phone shaded. Quality: **Mobile data · 2.5 Mbps** outdoors, **HD** on good Wi-Fi.
- [ ] Safe, well-lit, textured ground. No traffic, private screens or unwilling bystanders. Stop walking before you touch controls.
- [ ] Line up a **second Twitch account** for chat (and the Extension, if you show it) and an observer watching `https://www.twitch.tv/dusyaaaaaaaa_` for received video and audio.
- [ ] **Nobody else** may select `dusyaaaaaaaa_` as their channel in their own RaidRift app. The last phone to claim a channel takes over its Extension viewers.
- [ ] Raid plan (pick one, see below): a **real raid** from a second live channel, or skip the portal.

## In the app, standing still

1. Sweep the rear camera slowly over floor and furniture → wait for the landing rune (or tap scanned floor). Diagnostics: `nav ready`, a sensible floor distance.
2. **Setup → Twitch channel** `dusyaaaaaaaa_` (with the underscore; the same account as the stream key and the Extension owner) **+ stream key** (privately, not on camera) → Quality → **Go live**.
3. Go live pairs the app with the public server by itself (`Paired with room phone-…`). Check, as separate items: the **LIVE timer + nonzero bitrate**, `#dusyaaaaaaaa_ chat connected` in Setup, and observer-confirmed picture, voice and game sound on Twitch.
4. When Twitch first receives video, a 3.5 s **RAIDRIFT · type !join** title card appears in the scene.

## Three-minute order

| Time | Do / ask viewers |
|---|---|
| 0:00–0:30 | **Raid.** Real raid: the second account goes live for a minute (Twitch app → Go Live) and types `/raid dusyaaaaaaaa_`. The portal tears open on the landing spot with `RAID · <name> · <count>`. **The second account types `!join` right away**: the portal collapses ~6 s after the tear unless someone is walking out. No raid available? Skip the portal and start at `!join`; joiners poof in with an arrival burst. *The Setup "Server test raid" does not work on the public server (per-phone rooms are refused); don't plan on it.* |
| 0:30–1:05 | The stream caption says "Type !join in chat to drop in a hero", then shows the command menu. Viewers `!join`; one `!wave`, the other `!jump`. Leave ≥0.5 s between messages and allow for Twitch delay. Show the separate name tags. |
| 1:05–1:45 | `!w`, then `!d` (separate messages). `!rift go to 3 and dance` with a number **visible right now**. Natural language: `!rift walk to the chair and sit` / `go to the bench`, but only once Setup diagnostics shows `sees: chair` (or bench). Plain sentences without `!` only work for the keyword list (join, jump, dance, wave, sit, turn, walk left/right, stop; Ukrainian too). |
| 1:45–2:05 | Extension (optional): the second account opens the RaidRift panel → **Join the raid** → hold the d-pad arrows → tap an emote. The deployed build has the touch d-pad, not keyboard WASD. |
| 2:05–2:30 | Stand still. Tap **Selfie** (camera-flip icon). Turn slowly towards where the party stands: the gyro view draws them in the selfie (*unverified on device*). Flip back within ~10 s. Heroes should be where they were. |
| 2:30–2:50 | Optional **Follow me** (party icon): the party walks along ~0.9 m ahead. Walk slowly; it does not run ahead and the portal does not follow. Tap again to leave them. |
| 2:50–3:00 | Goodbye. Red **End**, tapped twice within 3 s. The observer confirms the stream ended. |

## Quick recovery

| Problem | Do this |
|---|---|
| No mesh / no landing | Sweep textured floor, wait a few bakes, try a floor tap. **Reset room** needs two taps once landed. |
| Tracking lost / drift | Stop, reframe the scanned area slowly. Reset and rescan if alignment stays wrong. |
| Stream error / drops / heat | Short signal loss: keep going. The app rebuilds a session stuck reconnecting for 30 s ("rebuilt Nx"). Otherwise check mic permission and the key, End, cool down, restart with **Weak signal**. |
| LIVE but no chat response | Setup must show `#… chat connected`. Check `/health`. Viewer sends `!join`, then `!wave`. The phone's own chat box is refused while paired (it can't impersonate viewers). |
| "Raid failed · Simulated EventSub needs a numeric…" | Expected on the public server: test raids are refused for phone rooms. Use a real raid or skip it. |
| "Server restarted · pairing again" | The app re-pairs to the same room by itself and re-selects the channel. Viewers must `!join` again. |
| Object target refused | Reframe so the object is detected (`sees:` line), or use a visible spot number / `!dance`. |
| Selfie: "Room tracking restarted" | The 20 s safety reset fired (dim light / no tracking): point at the floor to land again; the server's heroes poof back in once the room has landed. |

**Record afterwards:** APK version/hash, phone/OS/network, the received recording; pass/fail/skipped for scan, two viewers, raid source, natural-language target, Extension, mic/SFX, selfie and walking. Keep secrets out. Skipped means **untested**.
