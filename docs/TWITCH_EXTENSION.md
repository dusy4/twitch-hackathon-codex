# Twitch Live mode and Extension owner checklist

Implemented 2026-10-31. See [API.md](API.md) for the phone wire contract and [ADR-011](ADR-011-live-extension.md) for source and identity decisions. No credentials are bundled. No public endpoint, extension registration, account or stream was changed by this work.

## Start with real chat, no app credentials

The integrator must restart the existing tailnet process to load these source changes. Development/testing here left port 3412 running. On the paired phone's backend, use its existing capture bearer token:

```http
POST /v1/live/channel
Authorization: Bearer <paired capture token>
Content-Type: application/json

{"channel":"your_twitch_login"}
```

Read `GET /v1/live/status` until `connected:true`. Have real viewers type `!join`, `!dance`, `!w`, and `!rift go to 3 and dance` while the phone publishes a `spot 3` track. `DELETE /v1/live/channel` stops the reader. Plain recognized intents work for participating viewers; unrelated conversation never calls AI. Explicit free-form `!` commands use the existing planner/provider and its budgets. Without a configured planner, deterministic commands, numbered targets, labelled-object interactions and emotes still work; unsupported free-form requests fail honestly.

The reader uses `justinfan` plus five random digits, the public anonymous password sentinel, one outgoing command per WebSocket frame, tags/commands capability negotiation, channel join, PING/PONG, heartbeat timeout, RECONNECT and capped exponential retry. The sentinel is not a credential. Connection status requires a room acknowledgement; opening the socket alone is insufficient. No Twitch messages are sent. Live selection is process-local and must be repeated after restart. A read-only smoke joined Twitch's own `#twitch` channel (ID 12826), with no error; a real viewer-command/phone/raid rehearsal is still required.

IRC `USERNOTICE msg-id=raid` is the selected Live source and records `test:false`. It contains a count, never a roster. Chat numeric user IDs identify individual heroes. Existing stub heroes are retained when Live starts; clear practice heroes before selecting Live if desired. Native simulator impersonation chat is refused in Live. The debug simulator is still private development tooling; its deliberate debug fixtures remain available to the paired owner and must not be mistaken for real input.

The existing `apps/api/twitch.ts` OAuth/EventSub path remains available in the normal API process when `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and valid stored user authorization exist. The tailnet harness intentionally clears Twitch OAuth credentials. Do not ingest the same channel through IRC and EventSub simultaneously; their raid IDs differ. Channel Points are not implemented by this slice and need separate scopes, event handling and live validation. No optional EventSub/Channel Points success is claimed.

## Current status (November 1, 2026)

Steps 1–6 below were completed in the owner's console on October 31 (~23:58 Kyiv): version 0.0.1 in **Local Test**, Testing Base URI and the four view paths above (panel height 300; config path `config.html`, which the server also serves), identity link on, connect-src `https://raidrift-pc.tail7252b4.ts.net` and `wss://raidrift-pc.tail7252b4.ts.net`, the three `EXT_*` values in the owner's private env file, the owner account on the testing allowlist, and the Extension **installed but not yet activated** on the owner's channel. A JWT signed with the configured secret is accepted by Twitch Helix and by the local EBS (`/v1/ext/state` → 200, re-checked November 1, 03:14). Remaining owner action: activate it as Panel/Overlay/Component in the Extension Manager. Nothing was submitted for review. A mobile Extension needs a privacy-policy URL before review.

`EXT_OWNER_ID` belongs to the login **`dusyaaaaaaaa_`** (with the trailing underscore). Select that exact login as the app's Live channel; a different channel's IRC ID makes the EBS refuse Extension requests with `EXT_CHANNEL_MISMATCH`.

## Developer Console: owner actions

1. Create an Extension at the [Twitch Developer Console](https://dev.twitch.tv/console/extensions). Enable video overlay, video component, mobile and panel displays. Set an accurate name/description, original icon and actual screenshots; provide privacy/support information. The owner must confirm the current console supports the requested combination of displays for this Extension version.
2. Choose **Local Test**. Set Testing Base URI to `https://raidrift-pc.tail7252b4.ts.net/ext/`. Viewer paths are `index.html` for overlay, `component.html`, `mobile.html`, and `panel.html`. Mobile/component/panel occupy their frames; the overlay starts as a small bottom-left launcher and opens on hover/tap. Components rely on Twitch's own surrounding close/minimize UI.
3. Copy the Client ID, generated Extension Secret and the broadcasting owner's numeric Twitch user ID into the owner's private environment as `EXT_CLIENT_ID`, `EXT_SECRET`, `EXT_OWNER_ID`. `EXT_SECRET` is the Console's base64 text; the EBS decodes it before HS256 verification. Do not paste secrets into chat, source, frontend variables or command output. The owner manages `.env`; this task did not create one. `EXT_OWNER_ID` maps that channel to the tailnet harness's synthetic room `900000001`. Normal connected API worlds use the token's numeric `channel_id` directly. Once IRC learns the selected channel's real ID, a mismatched Extension channel is refused.
4. Launch the integrator's usual private harness with `--env-file <owner-private-env-path>`; its allowlist now reads those three Extension settings in addition to its existing planner keys. Normal API startup can use Node's `--env-file=<owner-private-env-path>` before `--import tsx apps/api/main.ts`. Restarting is an integrator action; do not restart the active process during development.
5. Add the exact HTTPS EBS origin to the Extension version's **Allowlisted Domains / connect-src** settings. For private Local Test this is `https://raidrift-pc.tail7252b4.ts.net`. CORS accepts `https://<EXT_CLIENT_ID>.ext-twitch.tv` and the configured same-origin Local Test host, never arbitrary origins. Requests use bearer JWTs and omit cookies. All HTML files load Twitch's helper first; every other script/font/style/asset is bundled locally. No inline scripts/eval/remote fonts. Readable JS is intentional for review.
6. Add owner/test viewer accounts in the version's access allowlist. Install/activate the version on the owner's test channel. Test real `onAuthorized` refresh, identity sharing, actual username after that viewer chats, stream delay, reconnect, touch hold/release, target disappearance, and three real viewers at once. A shared numeric ID uses the same chat hero. Before sharing, the name is `viewer-xxxx`; no arbitrary name is trusted from the browser. Opaque hero linkage preserves the hero when possible, or retires it in favour of an existing chat hero. Anonymous Extension accounts receive no join/quest Shards until linked. Revoking identity sharing returns to a separate opaque identity; it cannot keep accessing the known chat account.
7. Build with `npm run build:extension:local` for requested focused WASD/arrows in **private Local Test**. Twitch [policy 2.3](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/) prohibits keyboard shortcuts. The normal `npm run build:extension` review build disables this feature; focusable d-pad buttons still support ordinary Enter/Space activation. Do not submit the Local Test keyboard build as policy-compliant. The backend steering API is identical in both builds.
8. For Hosted Test, set **build-time** `VITE_EBS_ORIGIN` to the owner-approved public HTTPS EBS origin and run `npm run build:extension`. Zip the **contents** of `dist/twitch-extension`, with the four HTML files at the ZIP root. Upload that bundle, advance to Hosted Test, retain allowlisted testers, and recheck the actual Twitch frames/CSP. The complete first-load JS/CSS/fonts are under 1 MB uncompressed in the tested build; exact receipts are in `artifacts/extension-verification.json`. No source maps, credentials or unused source files are included in that directory. Reviewers receive readable JS and license notices.
9. Hosted Test and public release require working backend availability and an owner-operated test stream/environment during review. The [hackathon FAQ](https://twitchcon-codex.devpost.com/resources) says Extension review takes **5–14 days** and judges cannot install an unreviewed Extension. Demonstrate it in the submission video and via authorized allowlisted testers; do not promise public installation before review.

## Public EBS: two choices requiring owner approval

**Tailnet-only HTTPS is inaccessible to ordinary viewers.** Local allowlisted testers must also be members of the tailnet while using this URL. Serving static assets from Twitch does not make the EBS reachable.

Do not turn on a tunnel to the existing debug simulator: it exposes unprotected simulator pairing and other debug capabilities. First prepare a separate normal API deployment with `DEBUG_TOOLS=false`, durable database, owned HTTPS `PUBLIC_URL`, stable server/reward secrets and authorized broadcaster provisioning. The private phone and public Extension must ultimately address the same authoritative world/database; two unrelated in-memory harnesses are not a deployment. A narrowly scoped reverse proxy for only `/v1/ext/*` can be used for a private rehearsal, but is not blanket authorization to expose the rest of the harness.

- **Tailscale Funnel on the existing host:** the owner approves a separate listener/proxy serving only the intended public EBS and obtains the tailnet administrator's Funnel policy authorization. They configure Funnel to that listener, verify it from a device off the tailnet, and update `VITE_EBS_ORIGIN` plus Console connect-src. [Official Funnel documentation](https://tailscale.com/kb/1223/funnel). Preserve existing Serve/port 3412 phone access.
- **Cloudflare Tunnel hostname:** the owner approves/provisions an owned hostname and tunnel, points it to the separate EBS listener, verifies external HTTPS/CORS/SSE streaming without buffering, and updates the same frontend/Console settings. [Official Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). No tunnel/account/DNS changes were made here.

## Integration and QA commands

```text
npm ci
npm run build
npx tsc --noEmit -p .
npx tsx --test tests/*.test.ts
npm run lint
npm run build:extension:local
npx playwright test --config playwright.extension.config.ts
npx playwright test tests/e2e/product.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/character-arrivals.spec.ts
npm run build:extension
npx tsx scripts/twitch-irc-smoke.ts <channel-login>
```

The Extension browser test mocks only Twitch authorization/helper and synthetic simultaneous pointer capture; three independent signed viewers drive the real local EBS/world/SSE on port 3499. The separate main product fixture is on 3401. They do not touch 3412. Tests use public fixture signing keys, never owner secrets.

Sandbox runtime note: here tsx needed an ignored `.tools/sandbox-user.cjs` preloader to fall back only when Windows `os.userInfo()` fails; Node itself, actual database/world/compiler and assertions were unchanged. Playwright's automatic Windows process-tree termination also hung, so fixtures were started separately and tests used `RAIDRIFT_E2E_EXTERNAL_SERVER=true` (both configs support this opt-in). These environment workarounds do not indicate a passing real Twitch Extension installation. The design skill static gate and Playwright accessibility/visual checks were run; its standalone CDP inspector failed with `Page.enable` timeout in both installed Chrome and bundled Chromium. Final QA receipts distinguish those results.

## Assets and design

Owner-directed dark glass, violet `#c79bff`, mint `#92ffe0`; original CSS voxel/portal artwork; Space Grotesk 400/600 Latin (SIL OFL 1.1) bundled by Fontsource. beUI base Button is adapted from installed local MIT source to native CSS press feedback; this avoids shipping Motion/Tailwind just for a button. React Bits ClickSpark is locally installed, MIT + Commons Clause, used within this free application and never offered as a component kit. Notices are in `apps/twitch-extension/public/notices/` and the build. Reduced motion uses the source component's reduced-motion handling and disables CSS travel. No Minecraft assets, third-party images, sounds, paid assets or remote fonts were added.

Visual critique: the compact target chips and server-status hero make viewer agency clear; touch and focus are visible, surfaces are quiet, and no video-center decoration is rendered. Actual Twitch iframe sizing, performance at 500 Kb/s, iOS/Android Twitch app behavior and review acceptance remain owner validation gates. Automated screenshots use fixtures and do not establish Unity AR motion, grounding or broadcast synchronization.
