# ACCEPTANCE & QA — objective quality gates

## Twitch/raid identity
- Given 2 Twitch accounts with joined channels, a real `channel.raid` causes exactly one correct portal event in receiving stream, even with duplicate/retried webhook. Raider name and reported viewer count match event, no invented usernames.
- Actual chat messages from 2 real Twitch user IDs produce 2 different avatars. Rename a Twitch account: same avatar inventory and wallet remain. Users can unlink/relink correctly. No Twitch tokens reach a web client. Revoking broadcaster access removes subscriptions and overlay management rights.
- Synthetic `viewer_count=10000` runs within configured performance budget without 10000 expensive independently simulated anonymous players; real claimed users persist. Rejoin after world-service restart recovers identity/state.

## Avatar actions and scene grounding
- `!rift sprint towards a dog and sit on it` with dog visible makes the **correct user's avatar** sprint toward the detected dog bbox, bounce onto visually correct silhouette, remain attached while dog moves, and safely stop on target loss. No real-world commands and no real dog control.
- `!rift climb the table and dance`, `!rift follow the person in the red hat`, `!rift summon a small dragon and ride`, `!rift build next to the chair` each have visually distinct and satisfying behavior with graceful unsupported cases.
- Incorrect/ambiguous/off-screen targets do not fabricate successful actions. Chat injection cannot execute code, create unbounded entities, bypass wallet or change another user's avatar without permission. Scene change cannot send avatar to stale coordinate.
- Proper target mapping in mirrored webcam, cropped OBS source, changed canvas aspect and moving mobile camera. 30fps fallback is smooth. Original SFX controlled by streamer and no unwanted blast.

## Quest and Shards
- Virtual quests are verified deterministically; real camera quests use licensed/approved sampling and Decisions probabilities with calibrated threshold and temporal checks; hybrid requires both.
- Repeating the same event, model callback, API request, quest completion or award job 100 times results in **one** logical award. Database transaction rollback leaves no half-created wallet credit. Spending cannot cause negative balance. No ghost accounts minted from viewer count.
- Leaderboard scores are reproducible from ledger or dedicated score events, window boundaries are stable, weekly rankings are not affected by spending, ranks update with documented lag, older seasons can be viewed, tie ordering is deterministic, user can opt out.

## Website and creator experience
- Desktop/mobile accessible website, public leaderboard, Twitch sign-in, profile, avatar preview, controller, streamer onboarding, OBS install URL, demo/test switch, privacy settings, analytics and emergency stop all function.
- Creator grants/revokes opt-in camera processing and sees which sources are used; vision stops on disconnect and evidence retention TTL is honored. No camera or secret data goes into public leaderboard.
- Real streamer can install in OBS with docs and get a live effect without local terminal tooling; admin can investigate fraudulent awards and reverse with audit history.

## Mobile AR
- On supported ARCore/ARKit hardware, portal holds position on a real wall/ground across a camera pan; chars correctly scale and occlude behind surfaces where depth is supported; composited video and SFX can be sent to a stream, not only displayed privately. On unsupported hardware, UI truthfully shows capability-limited fallback.

## Test matrix and automation
- Unit: schema parser, auth roles, ledger, season boundaries, geometry transforms, world command executor, action expiry and status transitions.
- Integration: synthetic signed Twitch callback with challenge and replay, OAuth token refresh, Postgres transactions under concurrency, queues, websocket snapshots/recovery, mocked OpenAI Decisions responses and failing model timeout, object tracking fixtures.
- E2E: Playwright Chromium/Firefox/WebKit for website and viewer controller; real browser-source snapshots and OBS setup smoke; android device/Unity integration tests; simulated video fixtures with red hats, animals, tables and mirrored scenes; performance tests 1000 simultaneous viewers (realtime active players distinct from reported raid viewers).
- Security: XSS from Twitch username, CSRF, webhook forged signature/replay, rate-limited action queue, high-cost prompt flood, prompt-injection in signage/images, horizontal privilege escalation, unauthenticated leaderboard admin actions.
- Real-world recording: archive short permitted demos and evidence of live Twitch and Decisions API calls; label synthetic mock tests when credentials absent. Provide scorecard: pass, fail, blocked with reproduction instructions.

## Not done if
A pretty standalone mock page without Twitch OAuth/real EventSub, fake name assignment from viewer count, a quest "complete" button standing in for verification, frontend localStorage balance, a screenshot pretending to be AR/world locked, arbitrary model text driving JS, an inaccessible mobile-only demo, or invented test results.
