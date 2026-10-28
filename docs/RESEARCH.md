# Primary-source research and implementation caveats (checked 2026-10-27)

Use URLs as source pointers and check current versions when implementing, because API details change. This is product design research, not a claim that any live integration is currently running.

| Topic | Official or authoritative source | Confirmed implications |
| --- | --- | --- |
| Twitch raid event | https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ | `channel.raid` notification contains from/to broadcaster and `viewers`; no list of viewer identities. |
| Twitch raid event shape | https://dev.twitch.tv/docs/eventsub/eventsub-reference/ | Exact broadcaster IDs, source logins and count. |
| Twitch chat | https://dev.twitch.tv/docs/chat/send-receive-messages/ | Use EventSub `channel.chat.message`, with account-auth patterns and chatter identifiers. |
| Chat authorization | https://dev.twitch.tv/docs/chat/authenticating/ | Cloud bot vs installed bot OAuth models differ; check minimal scopes. |
| Twitch auth | https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ and https://dev.twitch.tv/docs/authentication/scopes/ | Authorization code, refresh, validation, least privilege. |
| Twitch webhooks | https://dev.twitch.tv/docs/eventsub/handling-webhook-events/ | Verify HMAC SHA256 over ID + timestamp + raw body, ACK fast, handle duplicate delivery and revocations. |
| Twitch subscription limits | https://dev.twitch.tv/docs/eventsub/manage-subscriptions/ | WebSocket connection/subscribe limits; consider webhooks or Conduits for broad creators. |
| Twitch Extension identities | https://dev.twitch.tv/docs/extensions/reference/ | Opaque user ID may be stable/anonymous; Twitch numeric user ID requires permission. |
| Twitch Channel Points | https://help.twitch.tv/s/article/channel-points-guide and https://legal.twitch.com/en/legal/channel-points-acceptable-use-policy/ | Native points are channel-specific; don't promise cross-stream crediting or conversion. |
| Twitch Extension Bits | https://dev.twitch.tv/docs/extensions/guidelines-and-policies/ | Bits rules for approved experiences, not equivalent to our Shards. |
| OpenAI Decisions | https://developers.openai.com/api/docs/guides/decisions | Generally available 2026-10-22, model `gpt-6-luna`; input images/text/JSON, predicate/choice/score, max 400 questions. |
| OpenAI Decisions API ref | https://developers.openai.com/api/reference/typescript/resources/decisions | SDK shape `client.decisions.create`; image base64/HTTPS; do not invent file-id support. |
| OpenAI structured actions | https://developers.openai.com/api/docs/guides/structured-outputs | Responses `text.format` strict JSON schema or function calling; avoid arbitrary executable model-generated code. |
| Camera vision (browser) | https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector/web_js | Object detection in camera stream at edge, device dependent. Check runtime/model licenses. |
| Video masks | https://ai.meta.com/research/sam2/ and https://github.com/facebookresearch/sam2 | SAM 2 tracks object masks across video; repository says model/checkpoint/code Apache 2.0, but check specific distributed weight terms. |
| Licensing | https://www.ultralytics.com/license | Ultralytics YOLO code/models AGPL-3.0 / Enterprise, potentially incompatible with proprietary deployment without license. Prefer suitable licensed alternatives if closed-source. |
| AR Foundation + occlusion | https://developers.google.com/ar/develop/unity-arf/features | Plane/anchors/raycasting/AR occlusion when hardware supports; capability-gated. |
| Three.js physics | https://threejs.org/docs/pages/RapierPhysics.html | Useful for virtual rigid bodies, not magical real-world scene reconstruction. |
| OBS browser source | https://obsproject.com/kb/browser-source | Overlay compositing (rendering), not an API that exposes other OBS sources' camera frames. |
| LiveKit | https://docs.livekit.io/intro/about/ | Optional realtime media transport/relay, not mandatory for directly composited mobile video. |

## Technical risks that must not be hand-waved
1. **Real-time target grounding:** OpenAI image understanding and semantic decisions can be slower than render frames. Use dedicated local detector/tracker and occasional vision model calls; don't claim real-time visual grounding is provided by Decisions alone.
2. **Actual AR vs screen effects:** on arbitrary captured Twitch video, pure overlay creates a 2.5D illusion; genuine moving-camera world-anchored AR needs pose/planes/depth from mobile capture or SLAM pipeline. Keep modes distinct.
3. **Twitch latency:** chat is generated in viewer-time but runs against current broadcaster source-time; UX should show queued actions and avoid sensitive fast reaction timing.
4. **Camera consent:** video capture, retention and model processing need creator opt-in, transparent data flow, deletion and local-first where practical.
5. **Viewer identity and rewards:** no join roster from raid event. Cannot award 247 distinct viewers from count 247. Credential-backed chat or OAuth participation is necessary.
6. **Latency/concurrency/cost:** 1000 chat prompts/min must not translate into unlimited LLM API calls; enforce quotas, visual density budgets and perceptual fallbacks.
7. **Licensing:** original graphics/audio; careful with pretrained model weights, animation repositories, streamer video clips and external game assets.
