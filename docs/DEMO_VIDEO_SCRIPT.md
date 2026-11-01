# RaidRift Devpost video: 2:45 edit

Target **165 seconds**, below the under-three-minute requirement. Submission deadline: **November 2, 2026, 2:00 PM Pacific**. The [official overview](https://twitchcon-codex.devpost.com/) asks for a working Twitch experience and evidence of Codex's contribution; [rules §6](https://twitchcon-codex.devpost.com/rules) names four equally weighted judging criteria. See [research §1](research/2026-10-31-codex-research-hackathon-irl-perception-planner.md#1-devpost-requirements-judging-eligibility-and-presentation).

This is a **recording plan**, not a report of captured footage or a claim that device tests have passed. Record the [street rehearsal](STREET_TEST_RUNBOOK.md) first. Use only capabilities demonstrated by the exact submitted APK; replace failed shots with the truthful alternatives below.

## Shot list and narration

| Time | Picture / action | On-screen caption | Voice-over |
|---|---|---|---|
| **0:00–0:12** | Cold open on received Twitch video: original purple voxel rift, hero entrance, camera parallax. Keep a small Twitch channel/chat frame visible. | **RaidRift — your Twitch community, in your world**. Add **TEST RAID** if synthetic. | “RaidRift turns a Twitch stream into a shared adventure. Tiny viewer heroes step through a rift into the streamer's camera view.” |
| **0:12–0:32** | Two real viewer accounts send `!join`. Show each name above a different hero; one waves. Retain the complete command-to-result sequence. | **Real Twitch chat → each viewer's own hero** | “Each participating viewer controls their own character. These two real viewers join from chat, and their heroes appear separately in the same scene.” |
| **0:32–0:57** | Continuous shot: one viewer sends `!jump`; the other sends `!rift go to 3 and dance` using a current visible marker. Hold long enough to see both commands reach the received video. | **Chat commands · numbered destinations · natural language**. Show exact messages and honest delivery delay. | “Chat can jump, wave, or choose a numbered destination. A request becomes bounded virtual actions for that viewer, with a predictable command path and a planner for more flexible language.” |
| **0:57–1:20** | Brief phone inset shows Mesh/Floor view, then clean Twitch view. Pan around a measured bench/chair; show approach or hop to a genuinely reachable top, if rehearsed. | **Scanned room mesh → live NavMesh → reachable paths** | “The phone measures surfaces, builds a navigation map and finds paths for the party. Object labels connect words such as ‘chair’ to a measured location. If a target is missing, the system can refuse the request.” |
| **1:20–1:40** | Arranged real raid with source/count visible, or clearly labelled owner test raid captured before Live selection. Use a real chat interaction immediately afterward. | **Incoming Twitch raid** or **TEST RAID — simulated owner input** | Real: “An incoming raid opens the rift. Twitch supplies the source and viewer count; named heroes come from viewers who participate.” Test: “This labelled test raid rehearses the entrance. Real chat still controls the individual heroes you see here.” |
| **1:40–1:58** | Stationary selfie flip and return, then normal-pace safe walking with Follow me (0.21.23+ keeps the party ~1.5 m ahead in frame; it turns and waves when the streamer stops). If either fails rehearsal, replace with rear-camera hero close-up and Reduced motion control. | **A party that travels with the streamer**; label any viewport selfie fallback. | Passed selfie: “The party can join a selfie, then return to the room. Following keeps the community near the streamer as the scene changes.” Fallback: “The streamer keeps control of the experience, including following, sound and reduced motion.” |
| **1:58–2:12** | Phone LIVE/bitrate chip inset alongside actual received Twitch A/V; one audible cue and mic line. Optional 3-second Extension fixture shot only if clearly labelled. | **Phone → Twitch: composed video + mic + game audio**. Optional: **Extension — local test; public setup pending**. | “The phone publishes the finished image and audio to Twitch. A separate connection brings chat back from the PC. The optional Extension adds a viewer controller; public installation still needs owner setup and Twitch review.” |
| **2:12–2:35** | Three fast evidence cuts: actual Codex development/research transcript; relevant code/test; branch history and resulting scene. Show readable paths and commit IDs, not decorative terminal scrolling. | **Built with Codex** → **bounded planner + research** → **IRC / Extension tests** → **publisher / detector checks** | “Codex contributed research and implementation work across the bounded planner, Twitch input and Extension backend, and the Android publisher and detector. Here are the actual source files and validation records. We separate local software checks from phone and live-service testing.” |
| **2:35–2:45** | Return to the real received stream: two heroes wave, owner ends. End card with repo, install-guide link and exact demonstrated build version. | **RaidRift — bring chat through the rift**. **Source + setup + known limits in README** | “RaidRift gives viewers a place inside an IRL adventure. Source, setup instructions and honest test status are included with the project.” |

Keep narration conversational; leave action shots breathing room. Do not speed up the continuous chat-to-result proof to imply lower latency. Use game audio at a level that leaves speech clear. Total timeline is exactly **2:45**; credits/links must fit inside it.

## Concrete Codex evidence to capture

Use actual build-thread screenshots/session evidence to support attribution. A commit's title or author alone does not establish which tool wrote every line. The branch commits below prove the feature chronology; pair them with the corresponding Codex session or docs rather than attributing all integration work automatically.

| Evidence | Relevant branch history / source | Show |
|---|---|---|
| Planner, target words and research | `ae02838b25fb` planner synonyms/tailnet; `840000642159` research/docs. `apps/api/compiler.ts`, `world.ts`, `targets.ts`; research report linked above. | One bounded typed plan or missing-target case, plus the recorded research discussion. The October 31 progress entry records a 536 ms server planner example; that is not a phone round-trip latency claim. |
| IRC and Extension | `45a13ae53f0c`; `apps/api/twitch-irc.ts`, `extension.ts`, `apps/twitch-extension`. [ADR-011](ADR-011-live-extension.md). | The real Codex work record and [verification receipt](../artifacts/extension-verification.json): 91 Node passes / one skip, fixture-based browser tests, read-only IRC smoke. |
| Direct publisher | `676b94b82a8c`; live Unity `Scripts/Live/*`, Android plugin; `Tools/live-plugin/VERIFICATION.md`. | NV12/audio architecture and actual standalone checks. Do not label a smoke APK as the tested RaidRift app. |
| Room map and detector | `8f6028bbdbf9`; live Unity `RoomNavigation.cs`, `Perception/ObjectDetector.cs`, `SurfaceLabels.cs`, `Editor/DetectorSelfTest.cs`. | Codex discussion/review evidence, real-image annotation or measured-room result from the exact build. Synthetic annotations must be labelled. |
| Iteration and design | `efb167f619b6` effects/Extension art; `e1c6405d59e0` camera-first HUD/scanning fixes. | Before/after from actual recordings, with version labels; no fixture preview passed off as live AR. |

Record the principal Codex build session ID for the submission form using the owner's actual session. Do not invent an ID or use a research-only session as the entire build history.

## Judging coverage

| Published criterion | Planned proof |
|---|---|
| **Innovation/Idea** | 0:00–0:12 and 1:20–1:40: raids become a portal into measured physical space. |
| **Potential Impact** | 0:12–0:57: two independent viewers cause visible, entertaining actions without taking over the streamer's phone. |
| **Technological implementation** | 0:57–1:20, 1:58–2:35: navigation, received Twitch A/V, bounded control and concrete Codex/testing evidence. |
| **Design** | Throughout: readable actions/names, restrained HUD, coherent portal/audio, accessible streamer controls. |

## Truthful recording and submission gates

- **Must capture:** a real Twitch receiving page, real viewers, one continuous chat → correct hero → received-video result, and concrete Codex contribution evidence. The existing test receipts alone are insufficient video proof.
- **Raid fallback:** if no real raid is available, retain a visible **TEST RAID** caption throughout that shot. The private harness permits debug raid fixtures during Live; use Setup → Server & testing → Server test raid, and keep their synthetic origin explicit. Current `World.raid` can mark those Live-mode fixtures non-test, so an ordinary RAID banner is not evidence of a real raid. Add the caption yourself. Never call seeded heroes real raiders.
- **Perception fallback:** if chair recognition/navigation fails, demonstrate a verified numbered floor target and say “measured destinations”; do not narrate successful chair contact. If selfie is unsupported, use rear-camera action. If received A/V fails, fix/re-record before claiming the phone-to-Twitch loop.
- **Extension fallback:** omit it or show a labelled local-test inset. Console registration is done for private Local Test (installed on the owner's channel, activation pending; see [TWITCH_EXTENSION.md](TWITCH_EXTENSION.md#current-status-november-1-2026)); a public HTTPS EBS, the real iframe identity flow on Twitch and review are still open. Do not promise a public install button. No Channel Points integration claim.
- **Economy:** omit a phone Shards/quest reward shot unless a separate authoritative server test has actually been captured. Local Rift Trail completion pays no Shards.
- **Privacy/rights:** mask stream keys, bearer tokens, env files and private account details. Use consenting participants and original/licensed art/audio; retain required notices. Avoid reference-game footage.
- **Final package:** exact demonstrated APK/source revision, English setup, repository access for judges, source/assets/licenses, known limits, video link and Codex session ID. Upload to YouTube as allowed by the rules/FAQ; verify playback and final duration below 3:00. Check Devpost shows **Submitted**, not just draft, well before **2:00 PM Pacific November 2**. [Official checklist](https://twitchcon-codex.devpost.com/), [FAQ](https://twitchcon-codex.devpost.com/resources).
