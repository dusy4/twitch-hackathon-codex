# RaidRift research report — October 31, 2026

## Executive summary: ten actions ranked for the deadline

**Recommendation: prioritize a convincing, recorded live loop—Twitch chat → the correct viewer’s character → interaction with measured room geometry → composited video and sound visible on Twitch.** Treat additional transports, models, and Extensions as supporting work.

The rankings below are my assessment of deadline impact, based on the published judging criteria and the inspected implementation. They are recommendations, not organizer promises. [Judging criteria](https://twitchcon-codex.devpost.com/)

| Rank | Action | Concrete result to obtain |
|---:|---|---|
| **1** | **Record a real Twitch demonstration.** | Two real viewers join, control different characters, and see their actions in the broadcast. Include a real incoming raid if feasible. Clearly distinguish any test event. |
| **2** | **Validate the Unity build on the physical phone immediately.** | Confirm camera background, room mesh, navigation, portal rendering, output frames, audio, and tracking recovery together. The checked-in README still records a packaged build awaiting device testing. [Local README][unity-readme] |
| **3** | **Connect Unity’s perception and 3D target handling to the existing backend.** | Upload timestamped frames, receive detections, resolve a chair into a reachable seat, and execute “sit, then dance.” Detection tracks are explicitly listed as not ported in the Unity README. [Local README][unity-readme] |
| **4** | **Add outgoing game audio and microphone handling.** | The inspected Unity sender adds a video track only. Add an audio track and verify the decoded broadcast, including mute and synchronization. [Local sender][unity-stream] |
| **5** | **Harden the existing planner rather than replace it.** | Use its deterministic parser first, restrict the model to Unity-supported actions, preserve ownership, and reject stale or unreachable targets. [Compiler][compiler], [world service][world] |
| **6** | **Polish one original portal sequence.** | A readable opening, spatial sound, staggered arrivals, contact shadows, and an obvious transition from voxel world into the room. Demonstrate it while moving the camera. |
| **7** | **Show one cooperative, authoritative reward loop.** | Two viewers complete a virtual objective; the server awards once; the leaderboard changes. Keep physical exploration rewards separate unless their evidence path is implemented. [Acceptance contract][acceptance] |
| **8** | **Make failures visibly controlled.** | Tracking loss pauses movement; missing objects produce an explanation; stream failure shows a receiving-side fallback; streamer mute and stop work. |
| **9** | **Add one small Twitch-native extra.** | Prefer an app-created Channel Points reward or a poll, if the broadcaster has the necessary access. Avoid making Extension approval part of the submission’s critical path. [Channel Points API](https://dev.twitch.tv/docs/api/reference/#create-custom-rewards), [polls](https://dev.twitch.tv/docs/api/polls), [hackathon FAQ](https://twitchcon-codex.devpost.com/resources) |
| **10** | **Finish submission evidence early.** | A video under three minutes, reproducible repository, English instructions, asset notices, build provenance, and the principal Codex session ID. [Submission requirements](https://twitchcon-codex.devpost.com/) |

**Research scope:** read-only repository inspection and extensive web research. No files were modified, paid generations initiated, devices benchmarked, or live Twitch tests performed. Local links below identify the inspected working copy; external links support vendor and competition claims.

---

## 1. Devpost: requirements, judging, eligibility, and presentation

### Verified competition requirements

I can reproduce short exact excerpts; the longer requirements below are paraphrased and linked rather than reproduced wholesale.

The key creation requirement is:

> “Projects must be newly created during the Submission Period.”

The rules additionally permit ordinary frameworks, libraries, templates, and AI coding assistants, while requiring the submitted work to have been built within that period. The period runs **October 23, 2026, 10:00 AM Pacific through November 2, 2026, 2:00 PM Pacific**. [Official rules, §1 and §4](https://twitchcon-codex.devpost.com/rules)

| Deliverable | Verified requirement |
|---|---|
| Working project | An interactive experience connected to Twitch and built with Codex. It must install, run consistently, and behave as represented. |
| Repository | GitHub, GitLab, or Bitbucket; include source, assets, and operating instructions. Private repositories are allowed on GitHub/GitLab with judge access. |
| Video | Show the project operating on Twitch **and** how Codex contributed. Upload to YouTube and provide the link. |
| Description | Explain features, functionality, and Codex’s contribution. |
| Codex session | Submit the principal build thread’s session ID; the overview instructs participants to use `/status`. |
| Length | Overview: maximum three minutes. Rules/FAQ: under three minutes; judges need not watch beyond three. **Target 2:45–2:55.** |

Sources: [overview and submission checklist](https://twitchcon-codex.devpost.com/), [official rules, §4](https://twitchcon-codex.devpost.com/rules), [FAQ](https://twitchcon-codex.devpost.com/resources).

The FAQ permits **unlisted YouTube videos**, despite the broader public-visibility wording. It requires English materials or translations, warns that saving a draft is insufficient, and advises freezing linked submission materials after the deadline. **A public YouTube upload avoids the visibility ambiguity.** The private-repository sharing email was obscured by Devpost’s email-protection mechanism in the retrieved page; I could not verify its literal address. [FAQ](https://twitchcon-codex.devpost.com/resources)

**Deadline inconsistency:** the FAQ’s UTC conversion conflicts with its stated Pacific time. The overview labels the deadline PST; **14:00 PST implies 22:00 UTC**, whereas the FAQ says 21:00 UTC. Use the official **2:00 PM Pacific** deadline and submit well ahead of it. [Overview](https://twitchcon-codex.devpost.com/), [FAQ](https://twitchcon-codex.devpost.com/resources)

### Judging stages and every criterion

Stage one is a viability/theme/tools **pass/fail** gate. Stage two scores qualifying entries on four equally weighted criteria; the five highest become finalists. Equal weighting means **25% each**, a mathematical interpretation of the rules. Ties are compared in criterion order, followed by a judges’ vote if necessary. [Official rules, §6](https://twitchcon-codex.devpost.com/rules)

| Exact criterion name | Weight | Meaning, paraphrased | RaidRift evidence I recommend |
|---|---:|---|---|
| **Innovation/Idea** | 25% | Originality and distinction from existing concepts | Raid arrivals become persistent characters that cross into measured physical space. |
| **Potential Impact** | 25% | Usefulness or entertainment for creators and communities | Two viewers independently cause entertaining, legible events without interrupting the streamer. |
| **Technological implementation** | 25% | Build quality and effective Codex use | Real integration, graceful failure, reproducible setup, and a concrete Codex-assisted engineering example. |
| **Design** | 25% | Usability and watchability | Fast onboarding, readable characters, coherent audiovisual feedback, uncluttered broadcast. |

Criterion names and their meanings: [published judging criteria](https://twitchcon-codex.devpost.com/).

There is no published bonus weighting for using many Twitch APIs. My recommendation is to make each demonstrated integration strengthen the same experience.

### Prizes

| Category | Award |
|---|---:|
| First | $10,000 |
| Second | $6,000 |
| Third | $4,000 |
| Two runners-up | $2,500 each |

All five receive TwitchCon stage time; the published total is **$25,000**. No separate AR, AI, Extension, or mobile prize category is listed. [Prize listing](https://twitchcon-codex.devpost.com/)

### Eligibility and third-party material

Eligible entrants are individuals aged at least 18 or their local age of majority, whichever is higher, and teams of eligible individuals. Organizations cannot enter. Geographic exclusions explicitly include Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea, and other prohibited/sanctioned jurisdictions. Promotion-entity personnel, relevant relatives/households, judges, and other conflicting participants are excluded. Eligibility is residence-based; the FAQ sets no maximum team size and says physical TwitchCon attendance is unnecessary. [Eligibility FAQ](https://twitchcon-codex.devpost.com/resources), [complete exclusions](https://twitchcon-codex.devpost.com/rules)

Third-party SDKs, APIs, and data require authorization under their terms. Open-source components are permitted with license compliance and original enhancements. Submission/video material must respect copyright, trademark, and privacy rights. Testing access must remain free and available through judging, ending November 15. [Official rules, §4](https://twitchcon-codex.devpost.com/rules)

**RaidRift recommendation:** provide an asset/dependency manifest covering Niantic, Unity packages, KayKit, detector weights, ElevenLabs outputs, fonts, and any sample footage. Describe the art as an original voxel rift; avoid distributing recognizable Minecraft or Nintendo assets without rights.

For creation-period evidence, include a short build chronology and commits/session evidence covering October 23–November 2. Do not infer eligibility merely from the handoff directory’s date.

### What “working on Twitch” should look like

The rules accept several connection types, including chat, overlays, API, EventSub, and Extensions. They do not prescribe a particular screenshot layout. [Project requirements](https://twitchcon-codex.devpost.com/rules)

**Recommended video storyboard—approximately 170 seconds:**

| Time | Demonstration |
|---|---|
| 0–12 s | Lead with the result: a portal opens in a real room and tiny named heroes emerge. |
| 12–35 s | Show the receiving Twitch channel and real chat. Alice joins; Bob joins; their characters are visibly different. |
| 35–75 s | Alice commands her hero to approach a chair and sit. Bob dances elsewhere. Move the phone to demonstrate parallax, grounding, and occlusion. |
| 75–105 s | Show a real incoming raid triggering the portal. If this cannot be obtained, label a replay/test event explicitly and retain real chat interaction elsewhere. |
| 105–130 s | Complete one cooperative virtual quest and show its server-recorded reward/leaderboard update. |
| 130–150 s | Briefly demonstrate object loss or tracking loss and recovery, plus streamer mute/stop. |
| 150–170 s | Show Codex building or fixing a specific feature, its resulting code/test, and the finished installation flow. |

Keep at least one command-to-broadcast sequence continuous. Show both the originating chat and the resulting Twitch video, allowing for delivery delay.

A raid notification contains broadcaster information and viewer count, **not a roster of arriving viewers**. Named avatars should come from actual participating identities; represent unclaimed arrivals anonymously. [Raid event payload](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channel-raid)

### Gallery and resources assessment

**The hackathon gallery is not published.** I therefore cannot identify or rank strong entries from this competition. [Project gallery](https://twitchcon-codex.devpost.com/project-gallery)

The resources instead point to Twitch’s developer showcase, which includes Crowd Control, Sound Alerts, Blerp, interactive overlays, and viewer-driven experiences. These are established examples, not verified hackathon submissions. [Resources](https://twitchcon-codex.devpost.com/resources), [Twitch showcase](https://dev.twitch.tv/showcase/)

**My inference:** compelling entries make viewer agency immediately understandable, produce a visible consequence, and fit the creator’s existing workflow. RaidRift should demonstrate that causal chain before explaining its architecture.

---

## 2. IRL Pro and publishing Unity’s composited output

### What the streamer needs

The documented IRL workflow is an encoder feeding a relay/home or cloud production system, which continues broadcasting independently of field connectivity. IRLToolkit documents IRL Pro configuration and cloud OBS; IRLServer documents SRTLA ingest followed by OBS and automatic fallback scenes. [IRLToolkit setup](https://kb.irltoolkit.com/cloudobs/0-QuickStart), [IRLServer Android setup](https://irlserver.com/guides/connect-irl-pro)

For RaidRift, I recommend this operational contract:

- The AR app owns tracking and produces the **finished camera-plus-characters image**.
- Output includes game audio and an independently controlled microphone.
- The creator can reuse their relay destination, receiving OBS scene, and broadcast account.
- Status distinguishes “connected,” “encoded frames arriving,” and “broadcast healthy.”
- Bitrate, reconnect, thermal behavior, tracking loss, stop, and privacy controls are accessible.
- Pairing fields, stream keys, diagnostics, and setup UI stay outside the encoded image.

### Can IRL Pro ingest another app?

**I could not verify a supported public IRL Pro interface for ingesting a Unity RenderTexture, another app’s video Surface, or a network video source.** Its official site confirms RTMP/SRT publishing, SRTLA bonding, adaptive bitrate, and web overlays; its Play listing provides no external-source API documentation. [IRL Pro](https://irlpro.app/), [official Play listing](https://play.google.com/store/apps/details?id=app.irlpro.android)

| Proposed input | Verification | Recommendation |
|---|---|---|
| Another app’s screen | Android provides consent-based `MediaProjection`; **IRL Pro support was not verified**. | Do not make this the planned integration without a device test. |
| RTMP/SRT input | No receiver/source documentation found in official IRL Pro material. | Its ability to **publish** these protocols does not establish ingest capability. |
| UVC | Public primary sources inspected did not establish current supported devices/workflow. | Even a UVC input would not directly expose an arbitrary app’s RenderTexture. |
| NDI input | Unverified. | Do not advertise compatibility. |
| Browser overlay | Web overlays and their audio are documented. | Suitable for alerts/UI; insufficient evidence of a calibrated phone AR pipeline. |
| Shared GL texture/Surface/plugin | No public integration contract verified. | Requires direct developer cooperation or another documented mechanism. |

Sources: [IRL Pro feature page](https://irlpro.app/), [Play listing](https://play.google.com/store/apps/details?id=app.irlpro.android), [Android MediaProjection](https://developer.android.com/media/grow/media-projection).

A separate open-source app, **LifeStreamer**, explicitly lists screen capture, RTMP, SRT, and UVC inputs. This makes it a possible compatibility experiment, but it does not establish those capabilities in IRL Pro; decoding and re-encoding also creates another integration to validate. [LifeStreamer source documentation](https://github.com/dimadesu/LifeStreamer)

### Recommended architecture

**Deadline:** retain the existing Unity WebRTC → PC/OBS path if it works on the phone; add audio and demonstrate it on Twitch.

**Field product:** publish directly from Unity to a compatible SRT or RTMPS relay, reusing the Kotlin RootEncoder implementation. Add bonding as a separate, explicitly tested transport feature.

```text
Unity camera + room mesh + characters + portal
                     ↓
             clean RenderTexture
                     ↓
       GPU copy into encoder input Surface
                     ↓
          hardware H.264 + mixed AAC
                     ↓
           SRT / RTMPS publisher
                     ↓
        relay → home/cloud OBS → Twitch
```

The inspected Kotlin implementation already has Surface-input encoding, codec configuration forwarding, H.264/AAC publishing, keyframe requests, bitrate changes, and lifecycle cleanup. Unity’s current sender instead creates `VideoStreamTrack(_stream)` and adds no audio track. [Kotlin publisher][native-relay], [Unity sender][unity-stream]

### Library comparison

**Effort labels are engineering estimates for this repository. Latency descriptions are architectural expectations, not measured RaidRift results.**

| Option | License/status | RenderTexture path and remaining work | Latency / bonding | Recommendation |
|---|---|---|---|---|
| **RootEncoder** | Apache-2.0; MediaCodec encoding, SRT/RTMP clients, custom sources. [Source](https://github.com/pedroSG94/RootEncoder), [source API](https://github.com/pedroSG94/RootEncoder/wiki/StreamBase) | Native Android plugin feeds the encoder Surface. Reuse existing `VideoEncoder`, `AudioEncoder`, `SrtClient`, and `RtmpClient` integration. **Medium** effort. | Avoids CPU image copies. Plain SRT; no documented built-in SRTLA in the inspected interface. | **Best direct-publishing choice.** |
| **srtdroid** | Apache-2.0 wrapper around native SRT; upstream SRT uses MPL-2.0. [srtdroid](https://github.com/ThibaultBee/srtdroid), [SRT](https://github.com/Haivision/srt) | Supplies transport, not video capture, encoding, AAC mixing, or MPEG-TS muxing. **High** integration effort. | Configurable SRT recovery buffer; no automatic SRTLA layer. | Useful if native libsrt features are specifically required. |
| **FFmpegKitNext** | Official source-only successor; LGPL-3.0 by default, GPL-3.0 with GPL components. [Project](https://github.com/arthenica/ffmpeg-kit-next), [Android build](https://github.com/arthenica/ffmpeg-kit-next/blob/main/android/README.md) | Must build AAR/native libraries and establish a hardware input/muxing path. A CLI invocation does not solve Unity texture sharing. **High** effort. | Can support SRT when built appropriately; SRTLA remains separate. | Avoid as a new dependency for this deadline. |
| **Community FFmpegKit forks** | Maintenance and build configuration vary. [Example fork](https://github.com/ffmpegkit-maintained/ffmpeg) | Audit provenance, enabled codecs, ABIs, page alignment, and license obligations. | No automatic bonding guarantee. | Prefer the official successor when FFmpeg is necessary. |
| **Unity WebRTC / Render Streaming** | Unity WebRTC uses Unity Companion License. Android ARM64 is supported, but the repository now marks the package deprecated. [License](https://github.com/Unity-Technologies/com.unity.webrtc/blob/main/LICENSE.md), [requirements](https://docs.unity3d.com/Packages/com.unity.webrtc@3.0/manual/requirements.html), [status](https://github.com/Unity-Technologies/com.unity.webrtc) | Direct `VideoStreamTrack(RenderTexture)` and audio tracks; PC receiver already exists. **Low incremental** effort. | Interactive media path; needs ICE/TURN planning for general internet use. No SRT/SRTLA publisher. | **Best immediate demonstration path.** |
| **NDI SDK** | Proprietary SDK terms; standard SDK is royalty-free subject to conditions. Compressed H.264/H.265/AAC integration belongs to Advanced SDK capabilities. [Licensing](https://docs.ndi.video/all/developing-with-ndi/sdk/licensing), [compressed codecs](https://docs.ndi.video/all/developing-with-ndi/advanced-sdk/using-h.264-h.265-and-aac-codecs) | Native texture/color conversion, audio, discovery, receiver integration, and exact Android SDK entitlement require verification. **High** effort. | Potential local production option; no verified SRTLA relay compatibility. | Defer. |
| **Custom MediaCodec + libsrt** | Android APIs plus MPL-2.0 libsrt; muxer and other components have their own licenses. [MediaCodec](https://developer.android.com/reference/android/media/MediaCodec), [libsrt](https://github.com/Haivision/srt) | Build Surface rendering, codec draining, SPS/PPS handling, AAC, TS muxing, transport, stats, and recovery. **Very high** effort. | Maximum control; bonding still additional work. | A product investment only if RootEncoder becomes limiting. |

**Version caveat:** older Render Streaming documentation says Android is unsupported; version 3.1 documentation lists Android support. Do not apply old platform limitations to the currently pinned stack. [Render Streaming 3.1 FAQ](https://docs.unity3d.com/Packages/com.unity.renderstreaming@3.1/manual/faq.html)

### Relay compatibility and bonding

| Relay | Verified documentation | RaidRift implication |
|---|---|---|
| **IRLToolkit** | Documents multiple ingest configurations and IRL Pro SRTLA setup. [Guide](https://kb.irltoolkit.com/cloudobs/0-QuickStart) | Use the creator’s exact ingest settings and existing receiving scene. |
| **IRLServer** | Separates ordinary SRT and SRTLA setup. [Mobile guide](https://irlserver.com/guides/mobile-streaming) | Select the protocol-specific endpoint; do not merely replace the URI scheme. |
| **BELABOX cloud** | The upstream SRTLA project directs production relay users to BELABOX cloud and labels its old receiver unsupported. [SRTLA project](https://github.com/BELABOX/srtla) | Verify account-provided endpoints and current sender compatibility. A public generic Unity setup was not verified. |

**SRT reliability is not connection bonding.** SRTLA adds a transport aggregation layer. BELABOX’s reference implementation is AGPL-3.0, expects multiple links and source routing, and documents Linux support; an Android port requires additional work. [SRTLA architecture and license](https://github.com/BELABOX/srtla)

Recommended later bonding design:

1. Keep one encoded/muxed media stream.
2. Pass SRT traffic through an SRTLA sender layer.
3. Obtain independent Android networks and bind each transport socket to its intended network.
4. Handle interface appearance/disappearance and changing capacity.
5. Validate receiver protocol version, authentication, stream ID, and recovery.
6. Resolve distribution obligations for incorporated SRTLA code.

Do not claim bonding from simultaneous Wi-Fi/mobile availability alone. Demonstrate packets using independent paths and survival when either path fails.

### Step-by-step Unity integration plan

The following is a proposed implementation, grounded in the existing Kotlin publisher and Android/Unity APIs.

1. **Freeze the output contract.** Start with 720p30 H.264 and 48 kHz AAC. Select landscape or portrait intentionally; the present Unity sender is 720×1280 portrait. Verify crop, camera background, portal camera, occlusion, and color in the decoded output. [Current sender][unity-stream]

2. **Package the Android publisher.** Expose `start`, `stop`, `setBitrate`, `muteMicrophone`, health callbacks, and an input Surface. Retain the existing Kotlin codec callbacks and transport clients rather than rebuilding them. [Existing publisher][native-relay]

3. **Create the Surface encoder.** With raw MediaCodec, configure H.264 with Surface input, call `createInputSurface()` after configuration and before starting, then drain output asynchronously. RootEncoder already provides a corresponding Surface encoder path. [Android Surface input](https://developer.android.com/reference/android/media/MediaCodec#createInputSurface()), [RootEncoder](https://github.com/pedroSG94/RootEncoder)

4. **Access Unity’s texture on its render thread.** Obtain `GetNativeTexturePtr()` when the RenderTexture is created/recreated, then schedule native work using `GL.IssuePluginEvent` or a command-buffer plugin event after composition. A texture identifier is not safe to consume from an arbitrary Java thread. [Unity native rendering interface](https://docs.unity3d.com/cn/2021.3/Manual/NativePluginInterface.html)

5. **Establish EGL sharing carefully.** For the current GLES build, obtain the active Unity EGL context in the render callback. Create a compatible recordable encoder EGLSurface and, if using another render thread, a shared context. Create context-local framebuffer/VAO state in the context that uses it. Synchronize producer/consumer access and restore Unity state. **The precise plugin implementation remains untested.** [Unity context rules](https://docs.unity3d.com/cn/2021.3/Manual/NativePluginInterface.html)

6. **Copy on GPU.** Draw the clean composite texture into the encoder Surface with correct vertical orientation, crop, aspect ratio, and transfer/color handling. Set presentation timestamps from one monotonic clock. Avoid a `ReadPixels → byte[] → encoder` production path.

7. **Forward encoded data and configuration.** Send SPS/PPS and video/audio buffers through the existing clients. Preserve presentation times and request keyframes after connection/recovery. [Existing callbacks][native-relay]

8. **Mix audio once.** Capture Unity’s game mix into a bounded PCM ring buffer, combine with the permissioned microphone at one sample rate, limit it, and feed AAC. Do not capture speaker output acoustically. Keep microphone mute independent from game SFX. The current Kotlin implementation provides a useful lifecycle/mixing reference. [Publisher][native-relay]

9. **For the immediate WebRTC route**, add `AudioStreamTrack` from an `AudioListener`/`AudioSource`, or feed PCM using `SetData`. Confirm the receiver actually attaches and plays the audio track. [Unity audio track API](https://docs.unity3d.com/Packages/com.unity.webrtc@3.0/api/Unity.WebRTC.AudioStreamTrack.html)

10. **Verify the complete receiver chain.** Record a flash/clap synchronization test, stream reconnect, orientation behavior, tracking loss, denied microphone permission, receiver departure, and sustained thermal performance.

**Latency recommendation:** measure camera-to-OBS and chat-to-Twitch separately. Encoder, transport buffering, relay/transcoding, OBS, and Twitch delivery contribute different delays. I cannot substantiate a current Unity-phone latency figure from this research.

---

## 3. Object recognition and placing characters in 3D

### Critical Niantic version distinction

**Do not plan NSDK 4.1 object recognition from the ARDK 3.17 documentation.**

The old documentation describes **206 categories**, including object detection through:

```csharp
Niantic.Lightship.AR.ObjectDetection.ARObjectDetectionManager
```

with `MetadataInitialized`, `ObjectDetectionsUpdated`, `CategoryNames`, `TryGetDetectedObjects`, and detection categorization/bounding-box methods. Those APIs are documented as experimental. [ARDK 3.17 detection guide](https://www.nianticspatial.com/docs/nsdk/3.17.0/how-to/ar/object_detection/index.html), [old manager reference](https://www.nianticspatial.com/docs/nsdk/3.17.0/apiref/Niantic/Lightship/AR/ObjectDetection/ARObjectDetectionManager/)

The **installed NSDK 4.1 package** instead contains:

```csharp
NianticSpatial.NSDK.AR.SceneSegmentation.ARSceneSegmentationManager
```

I found no corresponding object-detection manager in its C# runtime. Its segmentation API includes `Channels`, `MetadataInitialized`, `FrameReceived`, `GetSceneSegmentationChannelTexture`, and `TryAcquireSceneSegmentationChannelCpuImage`. [Pinned 4.1 source](https://github.com/nianticspatial/nsdk-library-upm/blob/4.1.0-26051913/Runtime/ARFoundation/Overrides/SceneSegmentation/ARSceneSegmentationManager.cs)

The current semantic channels are **sky, ground, natural ground, artificial ground, and grass**—not dog/chair/bottle/person/bed instance labels. Query the actual package metadata rather than hardcoding numeric channel values; public documentation and installed enum details are not fully consistent. [Current segmentation documentation](https://nianticspatial.com/docs/nsdk/features/semantics/), [current channel reference](https://www.nianticspatial.com/docs/api/unity/NianticSpatial.NSDK.AR.Subsystems.SceneSegmentation.SceneSegmentationChannel/index.html)

NSDK uses Niantic’s **Business and Developer Terms**, not a permissive open-source license. Those terms grant application-development/distribution rights subject to conditions; exact account entitlements and service charges were not verified. [SDK license](https://github.com/nianticspatial/nsdk-library-upm/blob/4.1.0-26051913/LICENSE), [developer terms](https://www.nianticspatial.com/terms-business)

### Options comparison

| Option | Recognition capability | Unity/Android integration | License and practical assessment |
|---|---|---|---|
| **NSDK 4.1 segmentation** | Ground/sky environmental categories; not the requested object instances. | Existing package; `ARSceneSegmentationManager`. | Proprietary developer terms. Keep for environment understanding; **not the object detector**. [Docs](https://nianticspatial.com/docs/nsdk/features/semantics/) |
| **Legacy Niantic detection** | Old 206-category detector. | Old namespace/API; no verified drop-in path for installed 4.1. | Niantic terms and experimental API. **Do not downgrade the AR stack for the deadline.** [Old API](https://www.nianticspatial.com/docs/nsdk/3.17.0/apiref/Niantic/Lightship/AR/ObjectDetection/ARObjectDetectionManager/) |
| **ML Kit default detector** | Up to five detected objects, tracking IDs, but only broad classification: home goods, fashion, food, plants, places. | Android plugin using `ObjectDetection.getClient`, `ObjectDetectorOptions`, `STREAM_MODE`. | Google API/ML Kit terms; on-device processing. **Default labels do not meet the five-class requirement.** [Capabilities](https://developers.google.com/ml-kit/vision/object-detection), [Android API](https://developers.google.com/ml-kit/vision/object-detection/android), [terms](https://developers.google.com/ml-kit/terms) |
| **ML Kit custom classification** | Classifies detected crops using a custom classifier. | `CustomObjectDetectorOptions` and `LocalModel`. | Additional model selection/testing; not equivalent to installing an arbitrary full detection graph. [Custom model guide](https://developers.google.com/ml-kit/vision/object-detection/custom-models/android) |
| **MediaPipe Tasks + EfficientDet-Lite** | COCO detector appropriate for common objects; Lite0 favors speed, Lite2 accuracy. | Native Android Tasks bridge, or homuler’s Unity plugin. | MediaPipe Apache-2.0; homuler MIT with third-party notices; verify exact weight license. **Best local deadline candidate.** [Models](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector), [Unity plugin](https://github.com/homuler/MediaPipeUnityPlugin) |
| **YOLOv8 / YOLO11 / YOLO26** | Common-object detection, with segmentation variants available. | Export ONNX, import into `com.unity.ai.inference`, implement preprocessing and version-correct output decoding. | Ultralytics AGPL-3.0/Enterprise terms apply to its code/models; ONNX conversion does not remove obligations. [Export](https://docs.ultralytics.com/modes/export), [license](https://www.ultralytics.com/license) |
| **Existing OmDet-Turbo sidecar** | Open-vocabulary noun detection already integrated server-side. | Port Unity frame upload and detection-to-anchor handling. | Published model is Apache-2.0. **Lowest architectural disruption for unusual targets.** [Model card](https://huggingface.co/omlab/omdet-turbo-swin-tiny-hf), [local service][ov-readme] |
| **OpenAI cloud vision** | Useful for descriptive attributes, ambiguity, and semantic interpretation; spatial localization has documented limitations. | Server-side image input, bounded structured result. | Network/cost/privacy considerations; not a frame-rate tracker. [Vision guide](https://developers.openai.com/api/docs/guides/images-vision) |
| **Gemini cloud vision** | Official documentation covers boxes and segmentation output. | Server adapter; explicitly convert its `[ymin,xmin,ymax,xmax]` 0–1000 coordinates. | Another provider integration and data path. No need to add it merely for variety. [Image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) |

The homuler plugin currently lists Android object detection among its supported Tasks APIs. It is a community Unity wrapper, not Google’s official Unity SDK. [Plugin support matrix](https://github.com/homuler/MediaPipeUnityPlugin)

The TensorFlow EfficientDet-Lite2 model variation inspected is explicitly **Apache-2.0**. Preserve the exact model/version/license when reusing it. [Weight distribution](https://www.kaggle.com/models/tensorflow/efficientdet/tfLite/lite2-detection-metadata/1?tfhub-redirect=true)

### YOLO and Snapdragon 8 Elite performance

**I found no defensible end-to-end Unity Sentis FPS figure for this exact workload.**

Qualcomm publishes relevant Galaxy S25/Snapdragon 8 Elite profiles:

| Published profile | Inference result | Correct interpretation |
|---|---:|---|
| YOLO11 segmentation, 640×640 | **3.52 ms** | NPU execution through ONNX Runtime/QNN in the published configuration. |
| YOLO26 segmentation, 640×640 | **3.89 ms** | NPU profile with its own runtime/model configuration. |

Sources: [YOLO11 profile](https://aihub.qualcomm.com/jobs/jpxl3628p), [YOLO26 profile](https://aihub.qualcomm.com/jobs/jpv26q2mg).

These correspond arithmetically to roughly 284 and 257 isolated inferences/second, **not camera-to-anchor FPS**. They exclude RaidRift’s preprocessing, readbacks, tracking, meshing, rendering, encoding, and thermal contention. They also do not establish the same performance through Unity’s GPU backend.

YOLO26 is a real current option and documents an optional NMS-free deployment path. Older YOLO exports and newer exports need different output handling; inspect the exported graph instead of reusing assumptions. [YOLO26](https://docs.ultralytics.com/models/yolo26), [export documentation](https://docs.ultralytics.com/modes/export)

**Recommendation:** defer YOLO selection until after the deadline unless an appropriately licensed, already-working integration exists. Unity’s inference package supports local model execution, but that alone establishes neither model compatibility nor NPU acceleration. [Unity inference package](https://docs.unity3d.com/ja/current/Manual/com.unity.ai.inference.html)

### Turning a 2D box into a trustworthy 3D target

The following is the recommended grounding algorithm.

1. **Preserve capture provenance.** Keep `frameId`, capture timestamp, image dimensions, orientation/crop transform, camera intrinsics, camera pose, and scene epoch together. Retain a short pose/depth history so delayed server boxes refer to the correct observation.

2. **Undo detector preprocessing.** Reverse rotation, mirroring, crop, and letterboxing before applying screen/depth coordinates.

3. **Select points by affordance.**
   - Approach person/dog: estimate a nearby supported floor destination.
   - Sit on chair: find a horizontal seat surface inside the detected region.
   - Stand on bed: find an elevated supported surface.
   - Bottle: approach an adjacent support surface; do not assume it supports a character.

4. **Prefer measured geometry.** Use `Camera.ScreenPointToRay` with physics raycasts against mesh colliders, AR plane raycasts where appropriate, or depth unprojection. AR depth acquisition is exposed through `AROcclusionManager.TryAcquireEnvironmentDepthCpuImage`. [Depth guide](https://developers.google.com/ar/develop/unity-arf/depth/developer-guide)

5. **Unproject depth correctly.** For optical-axis depth \(z\):

   ```text
   Xcamera = (u − cx) × z / fx
   Ycamera = (v − cy) × z / fy
   Zcamera = z
   Pworld  = cameraToWorldAtCapture × Pcamera
   ```

   Reconcile image-axis conventions with Unity coordinates. ARCore explicitly distinguishes depth along the optical axis from distance along a ray. [Depth interpretation](https://developers.google.com/ar/develop/unity-arf/depth/developer-guide)

6. **Validate a patch, not one pixel.** Use several samples, reject discontinuities/background leakage, and require appropriate surface normal, support area, and reachable NavMesh path.

7. **Anchor static content only after confirmation.** `ARAnchorManager.TryAddAnchorAsync(Pose)` is the broadly supported creation method; check its result. [AR Foundation anchors](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.4/manual/features/anchors/aranchormanager.html)

8. **Handle moving objects differently.** A world anchor does not track a dog. Maintain a short-lived dynamic target estimate; stop attachment on loss or excessive uncertainty. A static room mesh cannot establish a moving animal’s back surface.

**Deadline hybrid recommendation:**

- Keep NSDK meshing and local navigation.
- Port Unity’s missing frame/detection bridge.
- Reuse OmDet for requested unusual nouns.
- Add the already-familiar MediaPipe/EfficientDet path for common objects if integration is straightforward.
- Run detection at a bounded cadence, initially **3–5 Hz as a tuning target**, with local updates between detections.
- Demonstrate a stationary chair/bed interaction first; treat moving-dog attachment as a separate acceptance gate.
- Use cloud language vision only for occasional disambiguation.

**Required evaluation set:** dog, chair, bottle, person, bed; two same-class objects; red-hat ambiguity; camera pan; occlusion; object leaving view; low light; reflective furniture; and target reacquisition. Record wrong-target rate, anchor error, command completion, detector latency, render frame time, and temperature.

---

## 4. Safe natural-language action planning

### What the existing code already does

The inspected implementation is substantially beyond a prompt-to-animation mock.

| Existing behavior | Observation |
|---|---|
| Deterministic parser | English/Ukrainian intent normalization, aliases, sequences, pronoun handling, target ambiguity, catalog actions. |
| Runtime validation | Strict Zod objects, 1–8 steps, bounded coordinates and durations, total ≤15 seconds. |
| Model output | OpenAI Responses API with strict `text.format` JSON schema and `store:false`. |
| Paid-use gate | `ALLOW_PAID_AI=true`, provider credentials, configurable model. |
| Target binding | Exact tracks, noun binding, optional open-vocabulary lookup, ambiguity rejection. |
| Ownership/context | World service resolves the actor from the authenticated account. |
| Existing budgets | 500 ms viewer cooldown; two in-flight AI requests and ten AI requests/minute per world. |
| Race protection | Revalidates against current tracks after planning and checks world/actor/planning state before execution. |
| Audit/interrupt | Action log, request key lookup, cancellation/interruption handling. |

Sources: [compiler][compiler], [shared contracts][contracts], [world service][world].

The OpenCode path uses JSON mode, extraction, and local validation; it does **not** have the same provider-enforced schema guarantee as the OpenAI path. The OpenAI instructions are also less detailed than `planInstructions`, which enumerates animation names and operational examples. [Compiler][compiler]

### Recommended planner design

```text
verified Twitch event / authenticated controller
 → deduplicate and resolve viewer
 → input and spending budgets
 → deterministic parser
 → optional model plan
 → schema validation
 → ownership/capability/target validation
 → navigation and affordance validation
 → authoritative action queue
 → Unity rendering
 → completion/failure telemetry
```

**Use Structured Outputs for a proposed plan.** Function calling is appropriate if the planner must request bounded information, but it does not justify directly invoking movement or rewards. Both interfaces still require application validation. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [function calling](https://developers.openai.com/api/docs/guides/function-calling)

### Current OpenAI model choices and illustrative cost

The official pages currently list GPT-6 Luna and GPT-6.1 Terra with Structured Outputs/function calling support. Luna supports `reasoning.effort: "none"` in Responses, useful to evaluate for this constrained task. [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)

**Standard short-context text prices; USD.** Example cost assumes **1,000 uncached input tokens plus 200 billable output tokens**.

| Model | Input / 1M | Output / 1M | Illustrative message | Recommendation |
|---|---:|---:|---:|---|
| `gpt-6-luna` | $0.10 | $0.50 | **$0.00020** | Default constrained planner candidate; already the code default. |
| `gpt-6.1-terra` | $1.00 | $5.00 | **$0.00200** | Escalation candidate for difficult phrasing after evaluation. |
| `gpt-6.1-sol` | $2.00 | $10.00 | **$0.00400** | Evaluate only if it materially improves completion. |
| `gpt-6-astra` | $10.00 | $50.00 | **$0.02000** | Poor default economics for ordinary avatar commands. |

Prices: [official pricing](https://developers.openai.com/api/docs/pricing). Costs are arithmetic examples, excluding additional reasoning tokens, images, retries, caching effects, and other services.

**Latency is unverified for RaidRift.** Benchmark the complete path using actual schema/context sizes. Smaller outputs, fewer calls, and deterministic shortcuts are documented latency strategies. [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)

### Concrete improvements, in priority order

| Priority | Change | Why it matters |
|---|---|---|
| **P0** | Build a **Unity capability manifest** and derive allowed operations/animations from it. | The shared schema includes operations that the validator rejects; Unity also lacks the full target bridge. |
| **P0** | Add explicit target spaces: `screen`, `stage`, `ar_world`, with `frameId` and `sceneEpoch`. | Normalized server coordinates are not automatically measured phone-world destinations. |
| **P0** | Move scene attributes out of privileged prompt text. | OpenCode’s `planInstructions` embeds track attributes in the system message. Keep policy static and pass observations as untrusted data. |
| **P0** | Validate navigation and affordances before execution. | A fresh target ID alone does not prove a reachable chair seat or safe jump landing. |
| **P0** | Budget open-vocabulary lookup separately. | World-side missing-object resolution can happen before the AI concurrency/minute gate. |
| **P0** | Normalize OpenAI timeout/refusal/incomplete/invalid-output errors. | OpenCode has more explicit error mapping; the OpenAI path should handle these consistently. |
| **P1** | Tighten the wire schema. | Add step count/message bounds and action-specific enums where supported, while retaining Zod’s final semantic checks. |
| **P1** | Use identical policy/catalog content across providers. | Prevent provider-dependent action behavior. |
| **P1** | Replace free model-written display text with validated templates where practical. | Keep chat injection or inappropriate text from appearing in avatar bubbles/status. |
| **P1** | Add fair scheduling and a bounded pending queue. | Existing quotas reject excess work; they are not a fair multi-viewer queue. |
| **P1** | Cache symbolic intent, never stale target IDs. | Bind to current scene evidence after cache retrieval. |

Repository basis: [compiler][compiler], [world][world], [Unity connection][unity-connection]. Prompt-boundary guidance: [OpenAI agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety).

For “Bob go sit on the chair then dance,” identity should be resolved **before the model call**. If the speaker owns Bob, plan for that actor. If Bob belongs to another viewer, require explicit party consent or reject the cross-owner request.

Recommended server checks:

- Actor is derived from verified identity, never a model-selected Twitch ID.
- Each target belongs to the current room/scene epoch and remains observable.
- Each action is supported by the receiving renderer.
- Seat, floor, jump, and attachment requirements are checked independently.
- Spawn limits apply across active entities, not only one plan.
- `stop` interrupts immediately.
- Rewards are computed independently of model output.

These are proposed application controls. OpenAI’s guidance specifically warns against inserting untrusted variables into developer messages and recommends constrained structured data flow. [Safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)

**Suggested deadline defaults:** retain two AI calls in flight per room; allow one pending semantic request per viewer; coalesce superseded requests; expire old queue entries; enforce an independent vision budget; keep movement/emotes available during AI failure. Tune these limits from the rehearsal rather than presenting them as established capacity.

---

## 5. Twitch extras worth shipping

### Extensions: possible, but approval is the blocker

A component Extension can contain character controls: it is a sandboxed web UI that can call an Extension Backend Service. Twitch distinguishes a panel below the video, an overlay across the video, and a smaller hideable component within the video area. [Extension types](https://dev.twitch.tv/docs/extensions/)

| Surface | RaidRift use | Deadline recommendation |
|---|---|---|
| Video component | Join, movement, target selector, emotes | Good future product surface. |
| Video overlay | Select on-screen objects or characters | Requires careful video-coordinate/delay handling. |
| Panel/mobile view | Inventory, profile, quests, persistent controls | Useful complementary interface; design mobile separately. |
| Existing external controller | Same controls without Extension distribution | **Best immediate route.** |

The hackathon FAQ states **5–14 days for review** and says judges cannot install an unreviewed Extension. Unless RaidRift already has a suitable approved Extension, do not depend on one for judging. [Hackathon FAQ](https://twitchcon-codex.devpost.com/resources)

### Exact Extension mechanisms

Use:

```text
https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js
window.Twitch.ext.onAuthorized(...)
window.Twitch.ext.actions.requestIdShare()
window.Twitch.ext.listen("broadcast", ...)
```

Pass the received JWT to the backend and verify its signature, expiry, channel, and identity claims. Opaque Extension IDs are not automatically Twitch numerical account IDs; request identity sharing before linking to persistent avatars. [Extension Helper/JWT reference](https://dev.twitch.tv/docs/extensions/reference/)

For server broadcasts:

```http
POST https://api.twitch.tv/helix/extensions/pubsub
```

This uses an EBS-signed JWT with appropriate `role`, `channel_id`, and `pubsub_perms`. The documented limit is **100 messages/minute per Extension-client/broadcaster combination**, with messages up to **5 KB**. Use it for coarse state, not avatar transforms every frame. [Extension broadcast API](https://dev.twitch.tv/docs/api/reference/#send-extension-pubsub-message)

**Correction to the “PubSub replacement” premise:** legacy Twitch PubSub was shut down, but Extension broadcasting was explicitly unaffected. Extension PubSub remains the documented Extension mechanism. [Migration clarification](https://dev.twitch.tv/docs/pubsub)

### Recommended integrations and exact APIs/scopes

| Feature | API / EventSub | Authorization | Recommendation |
|---|---|---|---|
| Receive chat | `POST /helix/eventsub/subscriptions`, type `channel.chat.message`, version `1` | `user:read:chat`; cloud-bot grants depend on auth pattern | **Essential.** |
| Send bot reply | `POST /helix/chat/messages` | `user:write:chat`; app-token use additionally requires relevant bot grants/status | Send occasional useful acknowledgments. |
| Receive raid | `channel.raid`, version `1`, condition `to_broadcaster_user_id` | No raid-specific user scope required | **Essential signature event.** |
| Start an outgoing raid | `POST /helix/raids` | `channel:manage:raids` | Useful for controlled rehearsal, not required for receiving raids. |
| Create reward | `POST /helix/channel_points/custom_rewards` | `channel:manage:redemptions` | “Summon rift creature” or “community confetti.” |
| Receive redemption | `channel.channel_points_custom_reward_redemption.add` | `channel:read:redemptions` or `channel:manage:redemptions` | Route once through the authoritative queue. |
| Fulfill/refund | `PATCH /helix/channel_points/custom_rewards/redemptions` | `channel:manage:redemptions` | Mark fulfilled after success; cancel on failure where permitted. |
| Create/end poll | `POST` / `PATCH /helix/polls` | `channel:manage:polls` | Vote for portal theme or next quest. |
| Observe poll | `channel.poll.begin`, `.progress`, `.end` | `channel:read:polls` or manage equivalent | Reflect result in the world. |
| Create/resolve prediction | `POST` / `PATCH /helix/predictions` | `channel:manage:predictions` | Defer until the outcome is deterministically measured. |
| Observe prediction | `channel.prediction.begin`, `.progress`, `.lock`, `.end` | `channel:read:predictions` or manage equivalent | Optional later integration. |

Sources: [chat authentication](https://dev.twitch.tv/docs/chat/authenticating), [chat API workflow](https://dev.twitch.tv/docs/chat/send-receive-messages), [EventSub types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types), [scope reference](https://dev.twitch.tv/docs/authentication/scopes/), [Channel Points endpoints](https://dev.twitch.tv/docs/api/reference/#create-custom-rewards), [polls](https://dev.twitch.tv/docs/api/polls), [predictions](https://dev.twitch.tv/docs/api/predictions).

Channel Points management, polls, and predictions require an eligible Affiliate/Partner broadcaster. Redemption management is constrained by the app that created the reward. Verify access before making any of these the demonstration’s only interaction. [Reward API restrictions](https://dev.twitch.tv/docs/api/reference/#update-redemption-status), [poll eligibility](https://dev.twitch.tv/docs/api/polls), [prediction eligibility](https://dev.twitch.tv/docs/api/predictions)

For a cloud bot, distinguish the **app access token used for the API/transport** from user-granted authorization: the bot authorizes `user:read:chat`, `user:write:chat`, and `user:bot`; the broadcaster generally grants `channel:bot`, subject to documented alternatives. A local installed-bot test can use a simpler user-token pattern. [Authentication patterns](https://dev.twitch.tv/docs/chat/authenticating)

### Bot behavior and rewards

Twitch recommends EventSub and the Twitch API for modern chat integration. Respect both API headers and chat backend limits; a regular account’s documented baseline includes 20 messages/30 seconds and, without elevated channel status, one message/second/channel. [Chat guidance and limits](https://dev.twitch.tv/docs/chat)

Recommended behavior:

- Deduplicate by Twitch message/event ID.
- Use numerical chatter IDs for ownership.
- Acknowledge in the controller/overlay; avoid replying to every movement in chat.
- Honor bans, creator pause, and opt-out.
- Verify webhook HMAC over message ID, timestamp, and raw body; acknowledge promptly and process idempotently. [Webhook security](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/)

For “Drops-like” rewards, ship **RaidRift-owned cosmetic achievements or Shards**, clearly named as such. Actual Twitch Drops involve campaigns, Twitch-tracked eligibility/claims, account linking, and external in-game fulfillment; they are not simply another arbitrary Channel Points reward. [Drops overview](https://dev.twitch.tv/docs/drops)

**Deadline recommendation:** real raid/chat first; one Channel Points redemption second; one poll third. Defer predictions, monetized Extension features, and actual Drops.

---

## 6. ElevenLabs cinematic sound-effects production

### Current API and discrepancies

The current endpoint is:

```http
POST https://api.elevenlabs.io/v1/sound-generation
xi-api-key: ...
Content-Type: application/json
```

| Parameter | Verified behavior |
|---|---|
| `text` | Required sound description. |
| `model_id` | Default `eleven_text_to_sound_v2`; current reference also lists `eleven_text_to_sound_v3`. |
| `duration_seconds` | API reference: **0.5–30 seconds**, nullable for automatic duration. |
| `prompt_influence` | 0–1; default 0.3. Higher follows the prompt more closely and reduces variation. |
| `loop` | Boolean, default false; requests seamless looping. |
| `output_format` | Query parameter controlling returned audio format. |

Source: [Sound Effects API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).

The capability guide describes **SFX v3 as limited access**, with improved multipart prompt following and some audio-quality improvements; unavailable accounts can receive `Unknown model`. It also lists a 0.1-second lower duration bound, conflicting with the endpoint reference. **Use v2 and ≥0.5 seconds for the reliable baseline; try v3 only when access is confirmed.** [Capabilities and v3 availability](https://elevenlabs.io/docs/overview/capabilities/sound-effects)

### Pricing: what is and is not verified

The retrieved API pricing page advertises **$0.12/minute** for Sound Effects, equivalent arithmetically to **$0.002/second**. However:

- The same page says Music and Sound Effects are billed **per generation**.
- The capability guide still says **40 credits/second** when duration is specified.
- These statements do not establish one consistent invoice formula.

Therefore **$0.002/second is an advertised-rate conversion, not a verified account billing guarantee**. Check the account dashboard’s quote/usage record before a generation batch. [API pricing and metering](https://elevenlabs.io/pricing/api), [credit-based capability guide](https://elevenlabs.io/docs/overview/capabilities/sound-effects)

Paid-plan commercial rights are supported by the terms/billing documentation. Preserve generation-time plan evidence, prompts, model IDs, and asset hashes; marketing pages contain inconsistent free-tier commercial-use statements. [Terms](https://elevenlabs.io/terms-of-use), [billing and commercial rights](https://elevenlabs.io/docs/overview/administration/billing)

### Recommended sound-design method

The following is an original production brief, informed by ElevenLabs’ recommendation to describe the action, setting, atmosphere, and performance precisely. [Prompt guidance](https://elevenlabs.io/docs/overview/capabilities/sound-effects)

**Prompt structure:**

```text
physical event + material + scale
+ motion/timing
+ acoustic perspective
+ emotional character
+ explicit exclusions
```

Examples:

- **Portal opening:** “A massive fictional stone rift tears open in a quiet room: one brittle mineral crack, a rising violet-energy rush, then a deep resonant bloom with sparkling fragments. Powerful but playful. Isolated effect, no voice, no music.”
- **Tiny landing:** “A palm-sized wooden fantasy creature lands on a chair cushion: a soft fabric thump, a short wooden tick, and a delicate magical dust flick. Close and dry, one event, no ambience.”
- **Persistent portal:** “A restrained, continuous dimensional shimmer with fine crystalline motion and a warm unstable resonance. Seamless steady loop, no impacts, no melody, no voices.”

**Generate layers separately:**

| Layer | Purpose | RaidRift treatment |
|---|---|---|
| Transient | Immediate event recognition | Stone crack, click, claw contact, crystal tick. |
| Body | Material and perceived size | Wood/fabric/stone resonance; portal energy mass. |
| Tail | Space and magic | Short filtered decay, sparkles, controlled reverberation. |
| Sub | Weight | Brief low-frequency layer, with audible harmonics for small speakers. |

Do not rely on one long generated file for repeated exact timings. Trim and place layers in the DAW, then trigger them from actual animation/game events.

**Variation recommendation:** 4–6 variants for frequent footsteps/landings; 2–3 for rare portal events; avoid immediate repeats; apply small pitch/gain variation. Unity supports spatial attenuation, priority, pitch, and one-shot playback. [AudioSource API](https://docs.unity3d.com/cn/6000.0/ScriptReference/AudioSource.html)

### Loudness and spatialization

**Proposed mix targets—not Twitch or mobile certification requirements:**

| Material | Starting target |
|---|---|
| Finished demo video | Approximately **−16 to −14 LUFS integrated**, ceiling **−1 dBTP** |
| Representative game-only mix | Approximately **−20 to −16 LUFS integrated**, preserving voice headroom |
| Short effects | Balance by perceptual level, momentary behavior, and peak; do not normalize every click to identical integrated LUFS |
| Streamer speech | Foreground priority; duck game bus approximately 3–6 dB during speech |
| Phone speakers | Check mono compatibility and audible mid-frequency body; do not depend on sub-bass |

LUFS and true peak should be measured with appropriate loudness tools. EBU broadcast guidance uses **−23 LUFS** and a **−1 dBTP** production ceiling; that is a different delivery context, not a universal Twitch target. [EBU production guidance](https://tech.ebu.ch/files/live/sites/tech/files/shared/tech/tech3343v3_0.pdf)

For Unity, use mono positional assets with `spatialBlend=1` for creatures/contact events; keep UI at 2D and ambience restrained. `AudioSource.rolloffMode`, distance parameters, priority, and reverb mixing provide the basic controls. [Unity AudioSource](https://docs.unity3d.com/cn/6000.0/ScriptReference/AudioSource.html)

Recommended implementation:

- One listener at the physical AR camera.
- Pool sources and cap simultaneous voices.
- Give raid/quest cues priority over incidental footsteps.
- Apply low-pass attenuation for mesh-obstructed sources.
- Export the final game mix to the stream once.
- Disable speaker monitoring while microphone publishing if it causes feedback.
- Trigger landing/footsteps from motion contact, not repeated world polling.

### Proposed 25-sound inventory

This is an original asset list for RaidRift, not a claim about existing assets.

| # | Sound | Suggested form |
|---:|---|---|
| 1 | Portal anticipation | Short rising tension |
| 2 | Portal stone fracture | Sharp mineral transient |
| 3 | Portal energy opening | Layered cinematic body |
| 4 | Portal sustained hum | Seamless restrained loop |
| 5 | Portal closing | Reverse-energy collapse |
| 6 | Hero arrival | Tiny whoosh and contact |
| 7 | Footsteps: hard floor | Multiple dry variants |
| 8 | Footsteps: soft surface | Fabric/grass variants |
| 9 | Run acceleration | Brief movement accent |
| 10 | Jump takeoff | Light spring/contact |
| 11 | Air movement | Quiet directional whoosh |
| 12 | Landing | Height-scaled impact |
| 13 | Climb/grab | Small grip/scrape |
| 14 | Chair sit | Fabric/wood contact |
| 15 | Stand/detach | Soft release |
| 16 | Wave/acknowledgment | Tiny tonal gesture |
| 17 | Dance accent | Short original flourish |
| 18 | Creature curiosity | Nonverbal chirrup |
| 19 | Creature celebration | Nonverbal happy response |
| 20 | Crystal discovery | Directional shimmer |
| 21 | Crystal pickup | Crisp rewarding chime |
| 22 | Cooperative progress | Escalating shared cue |
| 23 | Quest completion | Original short fanfare |
| 24 | Action unavailable | Gentle explanatory cue |
| 25 | Tracking lost/recovered | Distinct subdued pair |

**Deadline recommendation:** verify the five existing major cues in the outgoing stream first, then add movement/contact variation. Generating 25 categories is less valuable than ensuring the best cues are audible, synchronized, and controllable.

---

## 7. Exceptional immersion in Unity Built-in RP

### Highest-impact options

These are prioritized implementation recommendations. Package APIs are verified where linked; performance budgets must be measured on the target phone.

| Priority | Technique/package | Specific implementation | Recommendation |
|---|---|---|---|
| **P0** | AR Foundation light estimation | `ARCameraManager.frameReceived`, main-light direction/color/intensity, ambient spherical harmonics | Extend existing `LightMatch.cs` with temporal smoothing and stable fallbacks. [ARCore lighting](https://developers.google.com/ar/develop/unity-arf/lighting-estimation/developer-guide) |
| **P0** | Depth occlusion | `AROcclusionManager`, environment depth and support checks | Combine current room-mesh occlusion with fresh depth where supported; inspect thin edges and moving foreground objects. [Depth integration](https://developers.google.com/ar/develop/unity-arf/depth/developer-guide) |
| **P0** | Contact grounding | Surface-normal-aligned contact shadows, correct foot/seat height, animation contact timing | Prioritize this over expensive full-screen effects. |
| **P0** | Portal camera and clipping | Stencil mask, bounded secondary render target, correct perspective | Verify the window from oblique angles and near furniture. Stencil provides per-pixel masking. [ShaderLab stencil](https://docs.unity3d.com/es/530/Manual/SL-Stencil.html) |
| **P1** | Environment probes | `AREnvironmentProbeManager`, capability checks | Use real environment lighting/reflections where available; do not assume identical support across providers. [ARCore HDR setup](https://developers.google.com/ar/develop/unity-arf/lighting-estimation/developer-guide) |
| **P1** | Built-in post-processing | `com.unity.postprocessing`; version 3.5.1 is listed for Unity 6 | Use restrained bloom/color treatment. Validate exact project compatibility before adding. [Package](https://docs.unity3d.com/kr/current/Manual/com.unity.postprocessing.html), [pipeline compatibility](https://docs.unity3d.com/es/2020.1/Manual/PostProcessingOverview.html) |
| **P1** | Thermal adaptation | `com.unity.adaptiveperformance` plus a supported provider | Reduce optional effects/detection/portal resolution under thermal pressure. [Package](https://docs.unity3d.com/ja/current/Manual/com.unity.adaptiveperformance.html) |
| **P1** | Haptics | Android `VibrationEffect.createPredefined`, capability-checked compositions | Small landing/confirmation feedback; separate intensity/mute setting. [Android guidance](https://developer.android.com/develop/ui/views/haptics/haptic-feedback) |
| **P2** | Foot/hand IK | `com.unity.animation.rigging`, `TwoBoneIKConstraint` | Useful after confirming rig compatibility; the current legacy-animation setup needs validation first. [Constraint API](https://docs.unity3d.com/ja/Packages/com.unity.animation.rigging@1.2/api/UnityEngine.Animations.Rigging.TwoBoneIKConstraint.html) |
| **P2** | Richer spatial audio | Existing Unity audio system and pooled positional sources | Add material/contact variety and occlusion before introducing a new audio middleware stack. [AudioSource](https://docs.unity3d.com/cn/6000.0/ScriptReference/AudioSource.html) |

### Rendering recommendations

**Keep the physical camera pose authoritative.** Do not use cinematic camera motion to hide unstable anchoring. Put cinematic motion inside the portal world and in character animation.

For the portal:

- Render the distant voxel world at a bounded resolution.
- Cull its camera to the portal-world layers.
- Disable its rendering when the window is not visible.
- Match its viewpoint to the real camera through the portal transform.
- Clip near geometry so the room does not appear accidentally overwritten.
- Use sparse emissive geometry and particles for perceived glow.

For room paint:

- Paint measured mesh in world space so it remains stable across camera motion.
- Fade newly measured areas in.
- Separate navigable/support surfaces from decorative paint.
- Keep the invisible occlusion pass available when scan visualization is disabled.

For performance:

- Budget against sustained frame time, not an initial FPS burst.
- Profile meshing, NavMesh rebakes, detection, portal rendering, and encoding together.
- Reduce transparent overdraw and full-screen passes first.
- Avoid assuming URP renderer features work in Built-in RP; Unity documents distinct post-processing paths. [Pipeline distinction](https://docs.unity3d.com/es/2020.1/Manual/PostProcessingOverview.html)
- Treat SSAO as optional: Unity documents substantial mobile/tile-GPU costs for screen-space effects and extra passes. [Mobile XR rendering guidance](https://docs.unity3d.com/ja/current/Manual/xr-untethered-device-optimization.html)

**Suggested degradation order:** reduce portal render resolution → particle density → detection cadence → mesh update cadence → optional post-processing → rendered crowd density. Preserve basic tracking, input feedback, and understandable stream status.

### Two-day execution order

**October 31**

1. Run the exact Unity APK on the physical phone.
2. Prove composited camera/characters/portal output in OBS.
3. Add and verify outgoing SFX/microphone audio.
4. Port frame upload and one static-object 3D target.
5. Rehearse two real Twitch viewers controlling separate characters.

**November 1**

1. Complete chair approach/sit/dance and missing-target behavior.
2. Verify one raid and one cooperative virtual quest.
3. Add a Channel Points reward only if access is already available.
4. Tune light matching, contact, portal audio, and streamer controls.
5. Record a sustained run and capture clean demonstration footage.

**November 2, before submission**

1. Freeze the demonstrated build.
2. Reproduce setup from the submitted repository.
3. Finish the short video and Codex evidence.
4. Verify repository access, English instructions, asset notices, and session ID.
5. Confirm Devpost shows **Submitted**, well ahead of 2:00 PM Pacific.

This is a recommended execution sequence, not a claim that these steps have passed.

### Items still unverified

- Physical Unity AR performance, thermal stability, and full outgoing A/V.
- IRL Pro external video/screen/texture ingest.
- Unity Sentis YOLO FPS on the target Snapdragon phone.
- Current account-specific Niantic entitlements.
- Android NDI Advanced SDK access and exact supported workflow.
- Commercial relay credentials and end-to-end provider compatibility.
- ElevenLabs’ account-specific SFX metering and v3 availability.
- The protected private-repository sharing email.
- Any hackathon gallery entry quality—the gallery is unpublished.

---

### Inspected local sources

[compiler]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/api/compiler.ts>
[world]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/api/world.ts>
[contracts]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/packages/shared/contracts.ts>
[unity-readme]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/unity-ar/README.md>
[unity-stream]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/unity-ar/Assets/RaidRift/Scripts/StreamOutput.cs>
[unity-connection]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/unity-ar/Assets/RaidRift/Scripts/ServerConnection.cs>
[native-relay]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/apps/android/app/src/main/java/world/raidrift/capture/RelayOutput.kt>
[ov-readme]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/services/ov-detector/README.md>
[acceptance]: <C:/Users/Andrii PC/Documents/Codex/2026-10-27/extract-the-attached-zip-then-read/raidrift-handoff/raidrift-codex-handoff/docs/ACCEPTANCE.md>

- [Action compiler][compiler], [world service][world], [shared contracts][contracts]
- [Unity README][unity-readme], [video sender][unity-stream], [server connection][unity-connection]
- [Existing Kotlin publisher][native-relay], [open-vocabulary detector][ov-readme]
- [Project acceptance contract][acceptance]