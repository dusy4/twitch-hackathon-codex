# RaidRift × RealityQuest — interactive technical prototype

A runnable front-end demo of a dimensional Twitch raid with original blocky portal artwork, procedural sound effects, persistent avatar interaction *within the current page*, RealityQuest camera mode, mock quests, and world shards.

## Run

```bash
cd raidrift-demo
python -m http.server 8080
```

Visit `http://localhost:8080`. Click **Summon Dimensional Raid** to trigger an in-browser simulated raid. The page has no backend or external dependencies. Audio unlocks after a user click due to browser autoplay policy.

- In OBS Studio, add a **Browser Source** pointing to `http://localhost:8080/?overlay=1&demo=1` at 1920×1080. This URL automatically triggers a demo raid. `?overlay=1` hides controls. The scene background is transparent in overlay mode so the portal can be composited over an actual game or camera feed.
- To test camera: press **Camera** while visiting localhost or HTTPS, allow camera access. Camera images stay local to the browser in this prototype.
- Commands in the control panel: `!join`, `!left`, `!right`, `!jump`, `!wave`, `!dance`, `!follow`. They all control one mock user named `DemoViewer`; replace this with the Twitch `chatter_user_id` from EventSub to route commands to their authenticated identity.
- **Complete Quest** mocks verification deliberately; it does not run an OpenAI model. Quest reward balances are page-memory only, not persistent DB balances.

## Live Twitch raid/chat bridge (optional)

The demo is a single-file UI. For **real Twitch raids and chat**, there is also a minimal Node EventSub WebSocket bridge:

```bash
npm install
# Put your Twitch application's credentials into environment variables (see .env.example)
node --env-file=.env.example bridge.mjs
# Once you fill .env.example; or use a separate .env with actual secrets.
```

Better: copy `.env.example` to `.env`, fill `TWITCH_CLIENT_ID`, `TWITCH_USER_TOKEN`, and `TWITCH_BROADCASTER_ID`, then run `node --env-file=.env bridge.mjs`. The Twitch user token must be authorized for `user:read:chat` and belong to the broadcaster or have permission to read its chat. The bridge subscribes to `channel.raid` and `channel.chat.message` over EventSub WebSockets, broadcasting relevant events to its own browser overlay at `http://127.0.0.1:8080/?overlay=1`. Stream overlays use the transparent canvas, and the API token remains only on the server.

**Security:** the server listens only on `127.0.0.1` by default; do not put this dev bridge directly on the public internet. Implement TLS, token management, reconnect handling tests, rate limits, and trusted-host checks before deployment. Node can recover from ordinary disconnects and supports Twitch's reconnect URL, but this is a hackathon scaffold, not tested against a real Twitch account.

**Actual quest AI:** run `OPENAI_API_KEY=... node ai-verify.mjs image.jpg`. This calls the official OpenAI Decisions API `POST /v1/decisions` with model `gpt-6-luna` and checks two independent image predicates. It does not yet connect to the live game state, intentionally, because currency awards require server-side verification and audit logic.

## Prototype vs production

- ✅ Canvas portal with animation, particles, original Web Audio effects
- ✅ Large-raid visual population (capped at 32 generated characters), avatars and parsed movement commands
- ✅ Desktop environment and optional live device camera
- ✅ RealityQuest overlays, quest cards, simulated rewards
- ⚙️ Twitch chat and raid EventSub bridge source included but requires a registered application, OAuth token and a live test
- ❌ Shared multi-channel, multi-viewer realtime server and user database
- ⚙️ Standalone OpenAI Decisions image verifier included; not yet automated. No AR world-locking, object detector, or viewer Twitch Extension
- ❌ Streaming/OBS compositing pipeline for mobile broadcasts

## Production architecture

1. Twitch webhook `channel.raid` and `channel.chat.message` -> backend event bus -> authoritative world server.
2. Twitch IDs are known from chat events or explicit login, **not** from `channel.raid` alone. A raid `viewers` count should be rendered as an anonymous abstract crowd until claimed.
3. WebSocket world protocol broadcasts `{type:'raid', from, to, count, event_id}` and `{type:'input', user_id, action}`; the service caps per-user input rate, deduplicates Twitch messages, normalizes collisions.
4. React/PixiJS or Three.js rendering for production video/overlay; OBS Browser Source as output for desktop. Mobile RealityQuest: ARCore/ARKit or Unity AR Foundation + camera compositing; WebRTC (e.g. LiveKit) only if there is actual remote video exchange.
5. Vision: local detector/tracker for visual anchors, and OpenAI Responses API with sampled stills and strict structured JSON for quest evidence. Reward via server-side validated finite-state transitions, not direct LLM money commands.
6. PostgreSQL for identities, missions, evidence references and token ledger; Redis for live transient positioning/rooms.

## Source accuracy and safety

This demo uses no copyrighted Minecraft sounds or textures. Minecraft's original assets are not included. You may replace sound and art **only when you have distribution rights**. The demonstration neither tracks bystanders nor exposes the user's location. Production quests should be designed around objects, places or consenting participants, not tracking or following an unsuspecting real person.

## Useful documentation

- https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
- https://dev.twitch.tv/docs/chat/send-receive-messages/
- https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
- https://obsproject.com/kb/browser-source
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js
- https://developers.google.com/ar/develop/geospatial
- https://docs.livekit.io/intro/about/
