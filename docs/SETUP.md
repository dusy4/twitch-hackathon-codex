# Run and operate RaidRift

## Local workstation

Node 24 or newer is required. From the extracted `raidrift-codex-handoff` directory:

```sh
npm ci
npm run setup:vision
npm run build
npm start
```

Open **http://127.0.0.1:3400**. This address avoids an existing unrelated IPv6 localhost:3000 application on the development machine. The default host binds to loopback. Do not change only the hostname in your browser: the configured `PUBLIC_URL` is the allowed request origin.

The app starts a clearly labelled simulator without credentials. Enter the world to use a persistent simulator viewer; Creator Studio offers a separate simulator creator. These identities are not represented as real Twitch users. PostgreSQL-compatible local data lives in `.data/postgres`. The local encryption key is generated in `.data/app-secret`. Back up both together. Neither belongs in Git. The original prototype in `prototype/` is separate and is not the implemented app.

To configure integrations, copy `.env.example` to `.env` and use:

```sh
node --env-file=.env --import tsx apps/api/main.ts
```

`npm start` does not implicitly read `.env`. Keep `ALLOW_PAID_AI=false` until inference spending is explicitly authorized. `EXPERIMENTAL_CAMERA_REWARDS` should remain false until calibration and capture provenance gates pass.

## Twitch owner setup

1. Register an app in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Use the exact callback `${PUBLIC_URL}/auth/twitch/callback`. Local callback: `http://127.0.0.1:3400/auth/twitch/callback` where accepted by Twitch; production requires your owned HTTPS origin.
2. Set client ID, secret and a random 10–100 ASCII character EventSub secret in the server environment. Never place them in browser JavaScript or OBS URLs.
3. Connect as creator through Creator Studio. The server authorization-code flow binds state to a separate HttpOnly browser cookie. Creator scopes are `user:read:chat user:bot channel:bot`; ordinary viewer identity needs no extra sensitive scopes. Validate the selected installed-bot/channel-owned chat model against the live app before launch.
4. On your authorized public HTTPS instance, use **Reconcile Twitch subscriptions**. The app creates incoming `channel.raid`, channel-owned `channel.chat.message` and `user.authorization.revoke` subscriptions using app credentials. Confirm their status in Twitch. A local-only callback cannot receive live EventSub webhooks.
5. Use two actual accounts. Send a real raid, then have each account type `!join`, `!right`, `!dance`, and a grounded command while the selected camera sees the target. Verify distinct account IDs and exactly one raid row despite delivery retries. Change a display name and reconnect to verify stable identity.
6. Revoke access at Twitch and confirm sessions and broadcaster connectivity are removed. Disconnect from the dashboard also revokes access and rotates source tokens. Viewer and creator connections are encrypted and revalidated on a five-minute scheduler once validation is 50 minutes old. Invalid grants revoke sessions and capture rights. Fleet-scale reconciliation and actual provider revocation still require live validation.

Official references: [OAuth](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [token validation](https://dev.twitch.tv/docs/authentication/validate-tokens/), [EventSub HMAC/challenges](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/), [raid contract](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelraid), [chat authentication](https://dev.twitch.tv/docs/chat/authenticating/).

## OBS overlay

1. In Creator Studio generate a source URL. Treat the fragment token as a room-scoped secret. Links expire after 24 hours; rotating a link invalidates old sockets within two seconds.
2. Add a Browser Source matching your OBS canvas, usually 1920×1080; paste the complete URL including `#token=...`; place it above your camera/game source. Its background is transparent.
3. Use a **labelled test raid** to verify compositing. Reported viewer count is distinct from claimed player count. Anonymous figures have no invented names, accounts or wallets.
4. To enable sound, use OBS Interact to arm audio. Enable “Control audio via OBS,” then set output/monitoring in OBS Advanced Audio Properties. Start quiet. Browser autoplay restrictions can block audio until armed.
5. Reduce crowd density, enable reduced motion or mute audio from Creator Studio. Emergency stop pauses actions and camera processing; it does not delete accounting history.

[Official OBS Browser Source documentation](https://obsproject.com/kb/browser-source).

## Desktop RealityQuest

Open `/capture` as the creator after enabling camera processing. Choose a camera or an OBS **source projector**, not the finished OBS composite. The browser cannot secretly inspect other OBS sources. Detection and short-lived image patch matching run locally; the server receives class, confidence, ephemeral track ID and normalized bounding box. File input is for permitted local QA videos and is not accepted as live quest proof.

The companion also supports explicit, local-only video clip export. Confirm source/participant permission, record up to 20 seconds, finish and download. No audio or avatar name labels are recorded; source content itself is preserved. Recordings are never uploaded. See [clip behavior and actual validation](CLIPS.md).

Calibrate source dimensions, normalized crop, mirror, rotation and output viewport in Creator Studio. Viewport is `[left,top,width,height]` in normalized OBS output coordinates; use `[0,0,1,1]` for full-frame source. Bounding-box mode uses top center. Optional experimental MagicTouch segmentation supplies a body-relative upper silhouette for animals/furniture; this remains image-space estimation, not physical contact. Moving camera/occlusion can lose tracking. Wrong/absent/ambiguous targets are rejected.

The bundled adapter uses MediaPipe EfficientDet-Lite0 at 320×320. Runtime license is Apache-2.0; exact model weight redistribution terms remain unresolved. `setup:vision` downloads the official model for local evaluation and records its hash. Production Docker builds exclude these local vision assets until redistribution is cleared. The real video evaluation documents misses and a dog/cat confusion. This detector is not reliable enough for automatic economic rewards.

## OpenAI

After owner authorization set `OPENAI_API_KEY` server-side and `ALLOW_PAID_AI=true`; enable creator AI as desired. Deterministic commands continue to work without it. Responses Structured Outputs compiles bounded plans, then the server revalidates operations, targets, duration and entity budget. Decisions `gpt-6-luna` evaluates supported camera predicates only. No response can directly mutate balances. Budget: two in-flight and ten calls per world per minute, ten-second request timeout.

[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Decisions](https://developers.openai.com/api/docs/guides/decisions). Mocked contract tests pass; no paid/live request was made during this implementation.

## Production topology

`compose.yaml` describes a **single durable app process** plus external PostgreSQL. Set `POSTGRES_PASSWORD`, `APP_SECRET` and `REWARD_IDENTITY_SECRET` (each random ≥43 characters) and an owned HTTPS `PUBLIC_URL`, then run `docker compose up --build` on an authorized host. A TLS reverse proxy must forward WebSocket upgrade headers and omit/redact token-bearing request query strings from access logs. Do not cache authenticated API responses. Demo identities must be disabled in production.

No Docker engine exists on the current workstation; container build and Compose deployment remain untested. Native external PostgreSQL was downloaded from the official EDB distributor and passed isolated concurrency/rollback tests through independent pg connections. CI descriptors are written but not run on a hosted provider. Redis room sharding and multi-replica ownership are not implemented: **do not scale app replicas**. The local 1000-spectator test is not a production throughput guarantee. Media relay supports one publisher and one receiver per room in LAN direct ICE mode; internet TURN, native codec support and native audio are not complete.

## Database and recovery

Startup applies `migrations/001_core.sql`, `002_equipment.sql` and `003_construction.sql` in explicit order. These are idempotent; the equipment backfill changes only null loadouts so an intentionally empty loadout stays empty on restart. This is still an explicit bootstrap/upgrade list, not a general schema-version migration runner. Never downgrade by dropping ledger rows. Back up PostgreSQL with `pg_dump` and the encryption secret through your secrets manager. Restore into a separate database, run the ledger audit, then verify tokens and snapshots before switching traffic. Local PGlite backups require a stopped app and a copy of `.data`.

Wallets are append-only-ledger derived. `scripts/audit-ledger.ts` checks wallet reconciliation and nonnegative balances. Operator reversal appends a compensating transaction and corrects the original scoring period; insufficient unspent balance requires manual review. Operator access uses the exact configured Twitch IDs in `ADMIN_TWITCH_IDS`. A failed ledger invariant is an incident: pause rewards and investigate original logical keys; never directly edit historical ledger entries.

World position saves occur every five seconds and on graceful shutdown. Recovery resets temporary animations, camera tracks and raid cinematics while preserving avatar identity/equipment. An abrupt crash may lose up to five seconds of movement. Ledger and inventory changes commit immediately.

## Tests and evidence

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
node --import tsx scripts/load.ts 1000
node scripts/download-fixtures.mjs
node scripts/evaluate-videos.mjs
npm run licenses
npm audit
```

Playwright automatically starts a separate in-memory PostgreSQL QA app on port 3401. The QA server snapshots the built web files into its own temporary directory before listening; subsequent local builds cannot invalidate an active test run. Graceful shutdown removes that snapshot after checking its resolved path. A forced process kill may leave a project-prefixed temporary build for later cleanup. The standalone video evaluation script uses the durable development app on port 3400 and requires it to be running. Vision tests require `setup:vision` and licensed fixture downloads. Tests share a clearly marked simulator database; do not run the browser suite against a live production account. Artifacts are under `artifacts/`; file attributions are in `tests/fixtures/ATTRIBUTION.json`. Browser tests exercise actual HTTP, WebSocket and WebRTC paths. Provider tests use labelled mocked responses, not live services.

`node scripts/download-postgres.mjs` retrieves the official EDB Windows archive. Extract it to `.tools/postgres`, then `node scripts/test-postgres.mjs` initializes an isolated SCRAM-protected loopback database, runs native concurrency/equipment tests plus the isolated dump/restore drill, then shuts it down. See `OPERATIONS.md` for recovery scope and evidence. This does not install a Windows service.

Implemented route inventory and shared schemas: `/v1/openapi.json`. Some uncommon request/response schemas are generic objects and explicitly documented as such. Rankings refresh every five seconds while the page is visible; camera reward probabilities remain uncalibrated and payouts disabled.

Community construction is disabled by default. Its creator controls, 24-hour lease, support rules, moderation and limits are documented in `CONSTRUCTION.md`. The workshop route is linked from the viewer controller.

Before upgrading an existing ledger, preserve its reward-identity HMAC key as described in `OPERATIONS.md`. The stable reward key must not follow encryption/signing key rotations. Existing ciphertext still needs a controlled re-encryption procedure before changing `APP_SECRET`.

## Character arrival and official CLI smoke

See `CHARACTERS.md` for the local viewer/creator flow and actual recordings. Browser characters do not require vision weights. The explicit `!join` chat command claims/enters the corresponding numeric chatter identity; anonymous reported raid counts do not produce accounts.

For the separate protocol smoke, manually install the official [Twitch CLI release](https://github.com/twitchdev/twitch-cli/releases/tag/v1.1.24), verify the official `checksums.txt`, and preserve its Apache-2.0 notices. Current Windows binary location is `.tools/twitch-cli/twitch-cli_1.1.24_Windows_x86_64/twitch.exe`; another platform can set `TWITCH_CLI_PATH`. Run `node --import tsx scripts/twitch-cli-smoke.ts`. It uses a disposable database and loopback port 3402, disables provider credentials in its own process, and closes its app/browser afterward. It does not modify the durable app database. Fixture video, if installed, is served only for the local composite screenshot.

The CLI generates a synthetic signed raid. Chat events are our separately signed fixtures because this CLI version lacks that generator. This proves the local protocol-to-character/rendering path; actual Twitch users, OAuth, public webhook delivery and OBS still need their live integration checks. Official reference: [testing webhook events](https://dev.twitch.tv/docs/cli/event-command/).
