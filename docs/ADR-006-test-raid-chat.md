# ADR-006 — streamer-operated raid/chat input stub

2026-10-30. The owner tested 0.7.0 on an S25 and reported that placement works and remains anchored. This is owner feedback, not an instrumented drift measurement. They asked to experience a stream as its broadcaster: tap one raid button, watch three visitors emerge, then see predefined incoming chat commands act independently. Their follow-up explicitly requested automatic predefined messages; the earlier objection to a programmatic demo means the fixture must inject chat inputs rather than directly choreograph render transforms.

## Decision

The native local world starts empty. Test raid creates one count-only test raid. A finite input fixture delivers !join from Alice, Bob and Charlie at staggered times; each stable stub viewer ID can claim exactly one stable character ID. Later messages enter the same local message/command handler used by the optional manual test console. The renderer and surface motor consume ordinary NativeWorld state. The scenario never writes an animation, transform or reward directly. No Twitch API request, real participant identity, currency or quest success is fabricated.

The 36-second input sequence covers independent wave/dance/jump/sit and bounded directional movement, plus an honest chair-target lookup. The chair command either uses supplied measured geometry or reports a missing target. All ordinary actions work without a chair. Replay replaces the fixture roster rather than appending visitors; finishing the fixture keeps the characters and stage. A compact message/response pair stays visible; Chat opens the full log. Short command bubbles appear in the rendered scene. Actor action shortcuts are hidden in this mode so the streamer can simply watch.

Tracking loss and backgrounding pause incoming test messages without a catch-up burst. Portal lifetime uses the same active clock until the visitors enter. The portal chooses a supported point near the stage, falling back to the tapped measured stage point. A stage move relocates an active entrance. A consumed test raid is not reopened by switching the camera off/on. Fixed-stage actors are not recalled to distant object targets; only explicit Walking mode has the existing 5 m catch-up recall.

This internal debug build opens in test mode even if it has a saved pairing. Test mode suppresses new paired-frame/track uploads; a revoked saved pairing cannot interrupt the local camera. It retains pairing settings so Setup → Return to paired room is reversible, and removes local portal state on return. A pending old detector generation is invalidated on entry. The test is explicitly LOCAL/STUB, and recordings carry TEST RAID on the stage and portal.

## Real stream boundary

This is a device-only input fixture, not a successful live Twitch test. The native local keyword handler is deliberately smaller than the server planner. Separately, tests/stub-chat.test.ts sends a raid and identified chatter fixtures through the actual backend EventSub inbox and shared chatCommand path, checking separate ownership, idempotent joins and WASD movement. The backend now accepts !w/!a/!s/!d as well as the existing directions. Those backend changes must run on the paired world service to affect real chat; an offline APK does not replace that service.

Official reference checked 2026-10-30: Twitch EventSub channel.raid supplies viewer count, while channel.chat.message supplies chatter_user_id. Twitch Extension policy 2.3 prohibits keyboard shortcuts; its local/hosted test lifecycle is separate from normal chat commands. This change does not register or publish an Extension.

- https://dev.twitch.tv/docs/eventsub/eventsub-reference/
- https://dev.twitch.tv/docs/extensions/guidelines-and-policies/
- https://dev.twitch.tv/docs/extensions/life-cycle/

## Remaining product gates

The owner confirmed initial S25 anchoring, but long walk-away/relocalization, final MP4/OBS A/V, thermal and interruption behavior still need physical validation. Live OAuth/EventSub with a real raid and three real chatters is unpassed. Automatic chair seats, arbitrary object geometry, moving-object attachment and occlusion remain limited; horizontal support and approximate/manual target heights are not full scene reconstruction. Native cooperative quest presentation/reward feedback and a complete live broadcast rehearsal are still required for the original stream scenario. See ANDROID_RECOVERY.md and RELEASE_SCORECARD.md for the broader, still-incomplete project.
