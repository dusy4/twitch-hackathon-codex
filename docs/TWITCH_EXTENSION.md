# Twitch Live mode and Extension owner checklist

Implemented 2026-10-31; status updated November 1 for the public server. See [API.md](API.md) for the phone wire contract and [ADR-011](ADR-011-live-extension.md) for source and identity decisions. No credentials are bundled.

## Start with real chat, no app credentials

The phone app does this for you when you tap Go live with a channel filled in. By hand, with the phone room's capture token from `POST /v1/native/pair`:

```http
POST /v1/live/channel
Authorization: Bearer <paired capture token>
Content-Type: application/json

{"channel":"your_twitch_login"}
```

Read `GET /v1/live/status` until `connected:true`. Have real viewers type `!join`, `!dance`, `!w`, and `!rift go to 3 and dance` while the phone publishes a `spot 3` track. A fresh phone room starts in LIVE mode, so the phone's own simulator chat and the debug test raid are refused there. `DELETE /v1/live/channel` stops the reader. Plain recognized intents work for participating viewers; unrelated conversation never calls AI. Explicit free-form `!` commands use the existing planner/provider and its budgets. Without a configured planner, deterministic commands, numbered targets, labelled-object interactions and emotes still work; unsupported free-form requests fail honestly.

The reader uses `justinfan` plus five random digits, the public anonymous password sentinel, one outgoing command per WebSocket frame, tags/commands capability negotiation, channel join, PING/PONG, heartbeat timeout, RECONNECT and capped exponential retry. The sentinel is not a credential. Connection status requires a room acknowledgement; opening the socket alone is insufficient. No Twitch messages are sent. Live selection is process-local and must be repeated after restart. A read-only smoke joined Twitch's own `#twitch` channel (ID 12826), with no error; a real viewer-command/phone/raid rehearsal is still required.

IRC `USERNOTICE msg-id=raid` is the selected Live source and records `test:false`. It contains a count, never a roster. Chat numeric user IDs identify individual heroes. Existing stub heroes are retained when Live starts; clear practice heroes before selecting Live if desired. Native simulator impersonation chat is refused in Live. The debug simulator is still private development tooling; its deliberate debug fixtures remain available to the paired owner and must not be mistaken for real input.

The existing `apps/api/twitch.ts` OAuth/EventSub path remains available in the normal API process when `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and valid stored user authorization exist. The tailnet harness intentionally clears Twitch OAuth credentials. Do not ingest the same channel through IRC and EventSub simultaneously; their raid IDs differ. Channel Points are not implemented by this slice and need separate scopes, event handling and live validation. No optional EventSub/Channel Points success is claimed.

## Current status (November 1, 2026, app 0.23.3)

| Item | State |
|---|---|
| Console | Version 0.0.1 in **Local Test**. Identity link on. Owner account `dusyaaaaaaaa_` on the testing allowlist. Installed on the owner's channel; **activate it as Panel (and optionally Overlay) in the Extension Manager** if that isn't done yet. Nothing submitted for review. |
| Testing Base URI | **`https://raidrift.12industries.com/ext/`** (public VPS behind Caddy). View paths: `index.html` (overlay), `component.html`, `mobile.html`, `panel.html` (height 300). |
| Allowlisted connect-src | `https://raidrift.12industries.com`, `wss://raidrift.12industries.com` (set Nov 1, ~13:50). The `wss://` entry isn't used (the panel uses fetch + SSE) and can be removed. |
| EBS | The same public server: `/v1/ext/*`. CORS accepts `https://<EXT_CLIENT_ID>.ext-twitch.tv` and `https://raidrift.12industries.com`. Other origins get 403 (checked Nov 1). JWTs are verified with the console secret (HS256). |
| Which world a viewer controls | The EBS sends the viewer to **whichever phone is live on that Twitch channel**: the phone room whose IRC reader learned the channel's numeric id. Every installed app pairs its own room (`phone-<hash>`). If no phone is live on the owner channel, the owner channel falls back to the server's debug room (two seeded demo heroes), so open the panel **after** the phone goes live. If two phones select the same channel, the last one to claim it wins. |
| Deployed bundle | **Review build** (`npm run build:extension`): touch/hold d-pad, emotes, targets, idea box. **No keyboard WASD.** For keyboard WASD in Local Test, deploy `npm run build:extension:local`. |
| Config view | `config.html` is set in the console but **not built**: `GET /ext/config.html` returns 404, so the broadcaster Configuration tab is blank. Add a minimal page before any Hosted Test. |
| Who can see it | Only accounts on the **Testing Account Allowlist** (numeric IDs). Judges and ordinary viewers can't load it until Hosted Test + Twitch review (5–14 days). Show it in the video. |
| Identity | Unlinked viewers appear as `viewer-xxxx`. After "Use my Twitch identity" (from a **non-owner** account; `requestIdShare` does nothing on your own channel) the Extension controls the same hero as that viewer's chat. |
| Not verified | Panel actions end-to-end on the live Twitch page with the 0.23.3 phone (join → d-pad → hero moves on stream) are **unverified on device** until today's recording. |

`EXT_OWNER_ID` belongs to the login **`dusyaaaaaaaa_`** (with the trailing underscore). The phone must select that exact login as its Live channel for the owner's Extension viewers to reach it.

## Developer Console: owner actions

1. Create an Extension at the [Twitch Developer Console](https://dev.twitch.tv/console/extensions). Enable video overlay, video component, mobile and panel displays. Set an accurate name/description, original icon and actual screenshots; provide privacy/support information. The owner must confirm the current console supports the requested combination of displays for this Extension version.
2. Choose **Local Test**. Set Testing Base URI to `https://raidrift.12industries.com/ext/` (was the private `raidrift-pc…ts.net` host until November 1). Viewer paths are `index.html` for overlay, `component.html`, `mobile.html`, and `panel.html`. Mobile/component/panel occupy their frames; the overlay starts as a small bottom-left launcher and opens on hover/tap. Components rely on Twitch's own surrounding close/minimize UI.
3. Copy the Client ID, generated Extension Secret and the broadcasting owner's numeric Twitch user ID into the owner's private environment as `EXT_CLIENT_ID`, `EXT_SECRET`, `EXT_OWNER_ID`. `EXT_SECRET` is the Console's base64 text; the EBS decodes it before HS256 verification. Do not paste secrets into chat, source, frontend variables or command output. The owner manages `.env`; this task did not create one. A phone live on a channel owns that channel's Extension viewers. Only when no phone is live does `EXT_OWNER_ID` map the owner channel to the harness's debug room `900000001`. Normal connected API worlds use the token's numeric `channel_id` directly. Once IRC learns the selected channel's real ID, a mismatched Extension channel is refused.
4. Launch the integrator's usual private harness with `--env-file <owner-private-env-path>`; its allowlist now reads those three Extension settings in addition to its existing planner keys. Normal API startup can use Node's `--env-file=<owner-private-env-path>` before `--import tsx apps/api/main.ts`. Restarting is an integrator action; do not restart the active process during development.
5. Add the exact HTTPS EBS origin to the Extension version's **Allowlisted Domains / connect-src** settings. Now this is `https://raidrift.12industries.com`. CORS accepts `https://<EXT_CLIENT_ID>.ext-twitch.tv` and the configured same-origin Local Test host, never arbitrary origins. Requests use bearer JWTs and omit cookies. All HTML files load Twitch's helper first; every other script/font/style/asset is bundled locally. No inline scripts/eval/remote fonts. Readable JS is intentional for review.
6. Add owner/test viewer accounts in the version's access allowlist. Install/activate the version on the owner's test channel. Test real `onAuthorized` refresh, identity sharing, actual username after that viewer chats, stream delay, reconnect, touch hold/release, target disappearance, and three real viewers at once. A shared numeric ID uses the same chat hero. Before sharing, the name is `viewer-xxxx`; no arbitrary name is trusted from the browser. Opaque hero linkage preserves the hero when possible, or retires it in favour of an existing chat hero. Anonymous Extension accounts receive no join/quest Shards until linked. Revoking identity sharing returns to a separate opaque identity; it cannot keep accessing the known chat account.
7. Build with `npm run build:extension:local` for requested focused WASD/arrows in **private Local Test**. Twitch [policy 2.3](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/) prohibits keyboard shortcuts. The normal `npm run build:extension` review build disables this feature; focusable d-pad buttons still support ordinary Enter/Space activation. Do not submit the Local Test keyboard build as policy-compliant. The backend steering API is identical in both builds.
8. For Hosted Test, set **build-time** `VITE_EBS_ORIGIN` to the owner-approved public HTTPS EBS origin and run `npm run build:extension`. Zip the **contents** of `dist/twitch-extension`, with the four HTML files at the ZIP root. Upload that bundle, advance to Hosted Test, retain allowlisted testers, and recheck the actual Twitch frames/CSP. The complete first-load JS/CSS/fonts are under 1 MB uncompressed in the tested build; exact receipts are in `artifacts/extension-verification.json`. No source maps, credentials or unused source files are included in that directory. Reviewers receive readable JS and license notices.
9. Hosted Test and public release require working backend availability and an owner-operated test stream/environment during review. The [hackathon FAQ](https://twitchcon-codex.devpost.com/resources) says Extension review takes **5–14 days** and judges cannot install an unreviewed Extension. Demonstrate it in the submission video and via authorized allowlisted testers; do not promise public installation before review.

## Public EBS (done November 1)

The EBS, the phone API and the APK download now share one public host: a VPS running the in-memory rehearsal server (`scripts/tailnet-test.ts`) on its Tailscale address, behind Caddy at **`https://raidrift.12industries.com`**. Caddy forwards only `/ext/*`, `/v1/ext/*`, `/v1/native/*`, `/v1/live/*`, `/apk/*` and `/health`; everything else (including `/v1/debug/pair`) returns 404. The phone and the Extension address the same in-memory world, so a restart clears all rooms (phones re-pair by themselves).

Known gaps on this host: debug tools are still on inside the process, so `/v1/native/debug/*` is reachable by any paired app, but only for its own room. Pairing is open: anyone with the APK gets a room. There's no durable database. For anything beyond the hackathon, run the normal API with `DEBUG_TOOLS=false`, a database and stable secrets.

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
