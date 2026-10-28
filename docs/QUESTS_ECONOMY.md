# QUESTS + RIFT SHARDS — verification and game economy

## Distinct types of quests
1. `virtual`: authoritative server world predicates: avatar A is inside bench zone; 3 distinct identified players are dancing; faction recovered X virtual objects. Evaluate these deterministically from server state and time windows, **never call a vision model** to verify already-known virtual actions.
2. `camera_observable`: capture a sampled and time-bounded set of camera frames with streamer permission; use OpenAI Decisions `gpt-6-luna` predicates for visible real-world facts. Examples: clearly red physical object currently visible, a bicycle seen, a dog present. Multiple frames with scene-consistent timestamp required for state changes.
3. `hybrid`: e.g., real dog present AND 3 separate virtual avatars sitting at its video-aligned position for 2 seconds; vision verifies `dog visible`, world service verifies virtual avatar positions/temporal contact.
4. `streamer_confirmed`: inherently nonobservable personal or off-camera facts, best marked as creator-confirmed, NEVER auto-awarded by AI certainty.

## Quest sample schema
```json
{
  "id": "quest-014",
  "title": "The Doggo Throne",
  "type": "hybrid",
  "objective": "Three unique avatars must perch on the visible dog for two seconds",
  "vision_predicates": [{"name": "dog_visible", "question": "Is a live physical dog visibly present in the camera image, not a graphic or screen depiction?"}],
  "state_predicates": [{"name": "three_players_perching", "minDistinctAccounts": 3, "action": "sit", "anchorClass": "dog", "sustainMs": 2000}],
  "evidence_policy": {"minPositiveFrames": 2, "minGapMs": 700, "maximumAgeMs": 3000, "requiredConfidence": "calibrated"},
  "reward": {"eligiblePlayerShards": 40, "creatorPrestige": 20, "maxAwardsPerPlayer": 1},
  "cooldownSec": 1800
}
```
**Important:** `requiredConfidence` is tuned on held-out evidence samples with actual costs of wrong positives/negatives, not an arbitrary theoretical "0.95 guarantees truth" threshold. Different quests need different calibration and creator attestation fallback.

## Decisions API request shape (current official docs)
OpenAI Decisions API `POST https://api.openai.com/v1/decisions`, `model: "gpt-6-luna"`, `input` may contain `input_text`, `input_json`, `input_image` using base64 data URL or HTTPS URL; `questions` list of `predicate`, `choice`, `score`, max 400 questions. Each predicate answer has a probability; interpret as estimate, not factual certainty. Decisions is used for classification/verifications and does not execute any action. Official doc: https://developers.openai.com/api/docs/guides/decisions

```json
{
  "model": "gpt-6-luna",
  "input": [{
    "role": "user",
    "content": [
      {"type": "input_text", "text": "Verify only visibly observable things in this camera frame. Ignore overlays and drawings. If uncertain, assign low probability."},
      {"type": "input_image", "image_url": "data:image/jpeg;base64,<FRAME_BYTES>"}
    ]
  }],
  "questions": [
    {"name": "dog_visible", "type": "predicate", "instructions": "Is a real dog visibly present in this camera scene, not a picture or monitor image?"},
    {"name": "bench_visible", "type": "predicate", "instructions": "Is a bench or low outdoor seat visible?"}
  ]
}
```
`<FRAME_BYTES>` is explicitly a placeholder, not actual valid JSON until replaced with base64 frame. Always keep API key server-side. Set per-creator max frames/minute and resolution/retention budgets. Use source frame hash and timestamp; detect duplicates and do not let static replays complete temporal movement challenges. Distinguish offline demo from real camera evidence. Multiple-frame logic should require ordered frames and plausibility, not reuse cached old one.

## Why not native Twitch currency
Twitch **Bits** are a separate, paid support mechanism; Twitch **Channel Points** are creator-channel-scoped and cannot be transferred across channels. There is no general supported API to directly credit a viewer's native Channel Points balance for completing external AI quests. RaidRift awards its own non-cash **Rift Shards**. Possible future Bits-in-Extension cosmetics require separate Twitch extension policy compliance, clear transparency, and no counterfeit native points.

## Suggested coherent economy (tunable from telemetry)
| Event | Example reward | Condition |
| --- | ---: | --- |
| First real join and linking | 20 Shards | Once per linked verified account |
| First completed individual action of session | 5 Shards | Once per session, not idle/bot/anonymous |
| Solo virtual action quest | 25–60 Shards | Server-state verification |
| Camera-observable approved quest | 40–100 Shards | Verified across frames + creator criteria |
| Team hybrid quest | 40 each + optional faction score | Unique eligible active players, capped |
| Cross-stream raid participation | 10–30 | Actual authenticated participation, not raid count |
| Weekly mission chain | 80–250 | Limited completion, audited |
| Creator prestige | separate `prestige_xp` | Community milestones, not viewer spendable wallet |

**Do not** give rewards simply for raw spam message count, number of hallucinated avatars, or arbitrary camera claims. Use spend sinks: cosmetics 150–1000 Shards, pet companions, tiny aura variants, portal entrance animations, title frames, scene decorations. Cosmetic only by default; avoid pay-to-win leaderboard corruption. Balance and earned total displayed separately.

## Full reward verification lifecycle
`quest.created -> quest.activated -> quest.enrolled -> attempt.in_progress -> evidence.collected -> evidence.checked -> rule_evaluator.confirmed -> ledger.awarded -> leaderboard.updated -> overlay.celebration`. Each step has timestamp, source event id, room epoch and audit trace. If vision false-positive or invalid data is detected, flag/reverse with compensating ledger transaction and adjusted score event; never directly mutate history.

## Abuse prevention and privacy
- Per quest/player/channel/day caps; device fingerprinting only if proportionate, not covert surveillance; clear streamer moderation and suspicious-score review.
- Camera frames sampled only if explicit creator opt-in; transient processing and deletion TTL; no face recognition, private location or unnecessary retention. Offer local-only perception when feasible and separate opt-in to share clip/replay.
- Quest generator cannot demand real-world theft, risky stunts, pursuit, harassment, dangerous acts, or off-screen proof. These are about virtual acts and simple optional streamer-approved camera conditions.
- If no camera permission, vision service offline, or object absent, quest must be `pending`/`unavailable`, not silently completed.
