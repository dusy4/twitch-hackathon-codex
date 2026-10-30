# an independent reviewer review resolutions

Consulted owner-requested an independent reviewer`, read-only, no delegation. Full design and code reviews are retained beside this file. Some fixes landed during the review, so its line numbers describe intermediate source.

1. Depth/pickup fragility: leaky dwell, radius hysteresis, bounded 500 ms unknown-depth grace following actual clear evidence, immediate collection block for obstacles, two-of-three visual hide consensus. Placement still requires current depth on capable devices.
2. Exploration spacing: movement baseline moved to **pickup**, requiring 1.5 m newly counted travel and 1.25 m net displacement; recent sites at least 1.2 m apart. Chosen for room-scale practice rather than the review's longer outdoor route.
3. Creator controlling paired live viewers: source inspection establishes `/v1/native/chat` already rejects non-SIMULATOR rooms with `VIEWER_CONTROLLER_REQUIRED` (server.ts). No new impersonation endpoint added. The native finale is described as two fresh **character** emotes, not a server-attested proof of two viewer messages. Simulator controls remain explicitly test inputs. Native practice never pays currency. Full viewer-origin attestation remains future server integration.
4. Old cheers: baseline refreshed during tracking loss and settling; pause/resume requires a new baseline; serials must increase and never lower the stored high-water mark. Missing/paused paired world suspends trail observation.
5. Phone PCM attack/clock: independently remembered reader start offsets, written-frame clock, forward-only underrun recovery. Phone buffering cannot consume a relay effect or rewind queued intervals.
6. Audio duck/limiting: 10 ms attack / 250 ms release with per-block gain ramps; soft knee above 28000 rather than integer wrap or hard clipping at 30000. Clean microphone input is copied and game mute remains independent.
7. No-raid trail/title overlap: intro headline hidden whenever a trail is active. Quest sheet opens expanded, with a pinned start/restart action.
8. Camera orbit: reset on trail stop/camera-mode transitions including AR failure recovery.
9. Surface headroom: measured upper-plane rejection extended to 1.05 m, matching landing checks.
10. Shrine anchor loss: party progress retained while the shrine is remeasured; restore step is not repeated. Completed state remains complete even if its decorative anchor is subsequently lost.
11. Relay PCM timing: rational sample-count timestamps using RootEncoder's own elapsedRealtime clock, not accumulating truncated 21333 µs blocks or using System.nanoTime.
12. Failed anchor creation: suppress the discovery and its corresponding lost-toast event; no audible false discovery or repeated lost-event spam.
13. Stub finale: explain that a test raid and tracked stage are needed; viewer-specific reactions remain incoming predefined chat messages, with paused feed clocks. Ending/restarting a trail cancels pending reactions; resuming a party-stage practice trail schedules fresh input messages.
14. Background behavior documented accurately: preserve ephemeral session anchor during pause, release on session/mode reset or explicit stop. No location, frames or quest telemetry is uploaded by the trail.

Hardware drift, physical listening, depth noise/comfort and AR-camera relay A/V sync still require the owner's handset. Emulator results are not substituted for those gates.
