# RaidRift Devpost video: 2:45 shot list (record November 1, 2026)

Target **2:45**, under the 3:00 limit. Deadline **November 2, 2026, 2:00 PM Pacific**. Devpost asks for the project **working on Twitch** and **how Codex contributed** ([overview](https://twitchcon-codex.devpost.com/), [rules](https://twitchcon-codex.devpost.com/rules)).

This is a recording plan, not captured footage. Show only what the 0.23.3 APK actually does on camera. If a shot fails, use its fallback; never fake it.

## Capture setup (two recordings, synced later)

| Source | What | Settings |
|---|---|---|
| **A: phone screen recording** | The RaidRift app while live (Android screen recorder, *no* mic, so you don't double the audio). Shows the HUD: LIVE timer, bitrate, chat state. | Start it before Go live. Mask the stream-key entry (enter the key before you start recording). |
| **B: PC screen recording** | `https://www.twitch.tv/dusyaaaaaaaa_` in a browser, **logged in as the second viewer account**, with the theatre/chat layout and the RaidRift Extension panel visible. This is the "working on Twitch" proof: received video + real chat + Extension. | OBS window capture or Xbox Game Bar, 1080p, desktop audio on (it carries the received stream audio). |
| C: PC screen recording (separate, any time) | Codex evidence: transcripts/session ids, code, commits. | Readable zoom, no secrets, no env files. |

Prep: install `RaidRift-latest.apk` (v0.23.3), grant camera + mic, land in a well-lit room with a **chair or bench** in view, set channel `dusyaaaaaaaa_` + key, Go live. Second account: on the Extension Testing Account Allowlist, Extension activated as **Panel**, and "Use my Twitch identity" pressed once so the hero gets the real name. Raid: the second account (or a third) goes live briefly to send `/raid dusyaaaaaaaa_`. **The public server refuses "Server test raid" for phone rooms**, so plan a real raid or use the cold-open fallback.

## Shot list

| Time | Picture (source) | On-screen caption | Voice-over |
|---|---|---|---|
| **0:00–0:15** Cold open: portal raid | B full frame: Twitch channel page, the phone's stream shows the floor; chat shows the raid notice. Cut to A as the voxel portal tears open on the floor with `RAID · <name> · <n>`; the first raider's hero walks out. | **RaidRift: your Twitch raid, in the streamer's real world** | "This is a live Twitch stream from my phone. When a raid comes in, a portal tears open on my actual floor." |
| *fallback* | No raid available: open on a hero poofing in after `!join`. No portal claim. | **Viewer joins from Twitch chat** | "When a viewer joins, their hero drops into my actual room." |
| **0:15–0:40** Viewer `!join` + names | Split: B (chat: second account types `!join`; you also have one more viewer type `!join` if possible) \| A (heroes appear, name tags match the chat names). The stream caption "Type !join in chat…" is visible in the broadcast. | **Real Twitch chat → each viewer gets their own named hero** | "Every viewer who types !join gets their own hero, named after their Twitch account. They walk on the surfaces the phone scanned." |
| **0:40–1:15** Commands + natural language + object target | Continuous, uncut: B chat `!jump` → A hero jumps. `!rift go to 3 and dance` (a number visible on screen) → walks to spot 3, dances. Then natural language with an object: `!rift go to the chair and sit` (or `walk to the bench`) → the hero walks to the detected chair. Optional: a Ukrainian phrase `танцюй`. | **Keywords: instant · Natural language: LLM → bounded, typed plan · Targets: on-device YOLOX-S detections + numbered spots** | "Simple commands are instant. Free-form requests go to a small language model that can only output a short, validated plan: walk, sit, emote, on targets the phone has actually detected. Here it finds the chair." |
| *fallback* | The chair isn't detected (no `sees: chair` in diagnostics): use `!rift go over there and wave` or a second spot number. | **Measured destinations** | Don't narrate object recognition. |
| **1:15–1:35** Extension d-pad | B: the second account opens the RaidRift **panel** under the video → hero card shows their name → **holds the d-pad arrows** → the hero walks on stream (A inset) → taps **dance**. | **Twitch Extension (Local Test): hold-to-walk controls** | "Viewers can also drive their hero from a Twitch Extension: hold to walk, tap to emote. It runs in Twitch's Local Test today; public install needs Twitch review." |
| **1:35–1:55** Selfie gyro | A: streamer stands still, taps **Selfie**, turns slowly; the party is drawn where it stands in the front camera; flip back and the heroes are where they were. | **Selfie flip: heroes stay in place** *(label "test footage" if not live)* | "Flip to selfie and they're still there. The phone's gyro keeps them where they stand in the room." |
| *fallback* | Selfie misbehaves: rear-camera close-up of the party waving at the lens. | — | Skip the selfie claim. |
| **1:55–2:10** Live HUD | A: the HUD close-up: `● LIVE 02:01`, bitrate/fps, `#dusyaaaaaaaa_ chat connected`, mic on. B small inset: the same moment received on Twitch with sound. | **Phone → Twitch RTMPS: AR video + mic + game audio. No OBS.** | "There's no PC in the video path. The phone composites the AR, mixes my mic with the game sound and streams straight to Twitch." |
| **2:10–2:35** Codex evidence | C: three quick cuts with readable text: (1) a Codex session transcript (research or extension build) with its session id; (2) `apps/api/compiler.ts` / `world.ts` planner validation or `twitch-irc.ts`; (3) `git log` on `fix/android-ar-recovery` + the matching scene. | **Built with Codex: research · planner · Twitch IRC + Extension · Android publisher · detector** | "Codex did the research and most of the implementation: the bounded planner, the Twitch chat reader and Extension backend, the Android streaming bridge and the object detector, plus code reviews along the way." |
| **2:35–2:45** End card | B: two heroes wave on stream; streamer double-taps End. Card: repo link, `raidrift.12industries.com/apk/RaidRift-latest.apk`, "v0.23.3". | **RaidRift: bring chat through the rift** | "RaidRift. Source, install link and honest limits are in the README." |

Rules for the edit: don't speed up the chat → hero sequence (Twitch delay is real). Keep game audio below the voice. No Follow-me or auto-follow shots: Follow is a manual extra, not part of this story. If a raid was a test fixture, it must say **TEST RAID** on screen (not possible on the public server today anyway).

## Codex evidence

Codex CLI session ids recorded in the run logs (`E:\Unity\tmp\codex-*.log`, first line `session id:`). Pick 1–2 to show on screen:

| Work | Codex session id |
|---|---|
| Hackathon/IRL perception/planner research | `01a19151-0d6f-7703-8dfd-f6251bc18725` |
| Twitch Extension + EBS build | `01a1929a-43d3-7052-ad5b-d3d56cf05460` |
| Extension design pass | `01a192d1-3598-72a1-8bf0-538de85d805b` |
| Direct RTMPS live publisher | `01a1928d-6c87-7371-a012-ccd9c12fa904` |
| YOLOX detector integration | `01a191e6-837e-70b3-82e4-1738a39515b6` |
| Effects (VFX) pass | `01a1928d-dfa0-7293-b7d0-66a5fbd1a8fd` |
| Selfie mode | `01a1938b-00e0-7661-99cc-d8d8083629b0` |
| API / live / diff reviews | `01a193c8-fc71-7101-bf3c-b4d4df6859d8`, `01a193c5-2dc8-7e71-aead-98de509e8535`, `01a19471-c4d5-7261-87f6-de17ae441323` |

The **principal Codex build thread** (the Codex app thread this repo was handed off in) is not in the repo. Get its id with `/status` in that thread and put it on the Devpost form. Don't invent one.

Code to show: `apps/api/compiler.ts` (typed plan validation), `apps/api/world.ts` (LLM-first + budget), `apps/api/chat-intent.ts` (keyword + Ukrainian intents), `apps/api/twitch-irc.ts`, `apps/api/extension.ts`, Unity `Scripts/Live/LivePublisher.cs`, `Scripts/Perception/ObjectDetector.cs`.

## Judging coverage

| Criterion | Where |
|---|---|
| Innovation | 0:00–0:15 raid → portal in physical space; 0:40–1:15 chat words grounded to real objects. |
| Impact | 0:15–1:35: several viewers act at once from chat and the Extension without taking over the phone. |
| Technical | 0:40–1:15 bounded planner + on-device detection; 1:55–2:10 phone-native RTMPS; 2:10–2:35 Codex evidence. |
| Design | Name tags, caption, portal, hearts, readable HUD throughout. |

## Submission gates

- Must capture: real Twitch page (B), real chat from a second account, one continuous chat → hero → received-video result, the Extension on Twitch, and Codex evidence.
- Mask stream keys, tokens, env files and account emails.
- Final package: repo access for judges (the repo is **private** right now; make it public or invite them), English README, video link (YouTube, check that it is under 3:00), Codex session id, and the APK version shown (0.23.3). Check that Devpost shows **Submitted** well before 2:00 PM Pacific on November 2.
