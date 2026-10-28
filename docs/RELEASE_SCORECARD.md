# Release scorecard

Recorded 2026-10-28. **Not release-ready.** This scorecard records actual evidence, not overall completion of the handoff.

| Gate | Status | Evidence and reproduction |
| --- | --- | --- |
| TypeScript and production web build | Local pass | `npm run build` compiles Vite and strict TypeScript. Main bundle remains above Vite's 500 kB warning threshold. |
| Authoritative actions and persistence | Local pass | `npm test`: distinct verified identities, 25 parallel actors, bounded props, target loss, scene reset, save/recovery and cross-world transfer. |
| Equipment persistence | Local integration/browser pass | Independent owned skin/hat/pet, concurrent equips, remove without spending, legacy migration and canonical world recovery. `tests/equipment.test.ts`; browser quest-funded skin/crown purchase/reload/remove/re-equip. |
| Immutable economy | Local pass | Duplicate awards, rollback, wallet concurrency, daily caps, reversals, faction-at-award history and privacy guards. `node scripts/test-postgres.mjs` also passes on native PostgreSQL with independent connections. |
| Browser website/controller/creator | Website flows pass; camera gates fail | Latest full matrix: 18 passed, 2 failed, 24 intentional once-only skips across Chromium/Firefox/WebKit/mobile. Both failures are camera target loss before sit. All website/controller/creator/commerce/duel/clip/media checks pass. |
| Accessibility | Automated subset pass | Axe checks WCAG A/AA rules on seven public routes plus controller, creator and capture forms. `artifacts/accessibility.json`. Does not establish full manual screen-reader/keyboard conformance. |
| Consented social play | Local pass | Two-session invitation → accept → charge → shield → cast → leave; authority/idempotency/expiry tests. See `SOCIAL.md`. No duel Shards. |
| Consented profile cards/factions | Local pass | Signed/revocable SVG endpoint and owner UI; consent/privacy/signature tests; actual card rendering/revocation and faction join/leave browser checks. No external publishing. |
| Twitch OAuth/EventSub | Mock contracts pass; live blocked | Signed real HTTP fixtures, challenge/replay/inbox, numeric chatter identity, refresh and revoke lifecycle tested. Requires owned app credentials, public HTTPS callback and two actual accounts for live raid/chat smoke. See `SETUP.md`. |
| OpenAI choreography/Decisions | Mock contracts pass; live blocked | Strict schema, paid-call gate, model timeout, temporal/hash evidence and server-only payouts tested. Requires owner-authorized key/spending and actual model calibration. No paid requests made. |
| Dog video grounding | Intermittent; not a release pass | Focused licensed-video bbox sprint/sit passes, but the full run reproduces target loss before sit in both basic and silhouette cases. Trace records dog/horse label flips and an empty-track interval; the server safely stops rather than continuing unseen. Delayed-silhouette fault injection passes. No calibrated placement claim. |
| Wider perception corpus | Incomplete | Close dog objects 13/15 samples; rainy dog 6/15 with class confusion; early chair clip 0/15. Red-hat referring expressions, moving camera, full occlusion/multiple-object alignment and broad source calibration remain unvalidated. |
| Camera reward integrity | Disabled | Uncalibrated model probabilities and missing trusted capture provenance. Keep camera payouts disabled. |
| Native mobile AR | Source only; blocked | Unity/AR Foundation/WebRTC source and editor tooling exist. No installed licensed Unity/Android SDK/handset; compilation, anchoring, depth, thermal behavior, audio and actual phone→OBS output untested. `MOBILE.md`. |
| Browser media relay | Local pass | Actual WebRTC transport of synthetic composed frames through authenticated signaling. LAN ICE only; not native AR or internet TURN proof. |
| Local consented clip export | Chromium local pass | Actual licensed-source + avatar composite recorded, downloaded, decoded and inspected; permission/discard lifecycle tested. Video only; other encoders, source audio and live capture validation remain open. `CLIPS.md`. |
| Spectator load | Local limited pass | 1000 spectator sockets, 0 connection errors, event-loop p95 ~26.9 ms, ~426 MiB RSS. Zero active avatars in this test; separate 25-actor command test. `artifacts/load.json`. |
| Dependency audit/licenses | Local pass with model exception | `npm audit` zero known vulnerabilities at last run; generated dependency license inventory. Runtime/code licenses reviewed; detector weight redistribution not cleared, local model assets excluded from Docker/Git. `ASSETS.md`. |
| Deployment/operations | Descriptors only; incomplete | Docker/Compose/CI provided but not deployed or container-built here. One world-owner process only. Native PostgreSQL tested. A small isolated native PostgreSQL dump/restore drill passes (`artifacts/restore-drill.json`). Production-size/managed recovery, fleet observability, TLS/TURN, secret rotation and scale-out ownership remain gates. |
| Extended phase 6 scope | Incomplete | Advanced persistent collaborative construction/physics, chess/formations, faction alliances/raid defense, richer clip/audio sharing and deeper progression remain open. |

External credentials/device blockers do not imply that remaining software scope is complete. No passing live Twitch, paid inference, native phone, OBS application recording, cloud deployment or multi-replica result is claimed.
