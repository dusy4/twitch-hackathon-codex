# OPERATIONS, MONITORING & SECURITY

## Deployment topology
- Web: deployed SSR/edge-capable website with cached public leaderboards and static assets on CDN.
- API: durable stateless HTTP replicas with shared Postgres + Redis, TLS, secrets manager, session cookie security.
- Twitch EventSub: reliable webhook receiver with HMAC verification and queue outbox. Use Conduits at scale if official docs recommend; subscription reconciliation and app/user token refresh with revocation cleanup.
- World: stateful websocket servers with per-channel rooms and rolling deploy/recovery; avoid purely ephemeral serverless world state.
- Workers: AI action compiler, scene vision and quest verifier with budget queues, retry and duplicate suppression.
- Media/AR: mobile app publishes composited output to streaming backend or RTMP endpoint using opt-in creator account; server-side object sampling only when enabled.
- Persistence: managed Postgres, Redis, restricted evidence storage buckets and periodic backups.

## Metrics & dashboards
`raids_received`, `raids_deduplicated`, `raid_animation_latency_ms`, `chat_actions_received`, `chat_action_rejected`, `prompt_compile_p50/p95_ms`, `model_tokens_input`, `ai_requests_per_channel`, `scene_track_age_ms`, `target_resolution_fail_rate`, `camera_frame_end_to_end_latency_ms`, `world_tick_p95_ms`, `overlay_fps`, `websocket_reconnects`, `quest_false_positive_rate`, `quest_awards_minted`, `idempotency_collisions`, `leaderboard_freshness_ms`, `wallet_invariant_errors`, `SFX_audio_enabled` and mobile AR tracking quality. Add error correlation ID without logging excessive raw chat/frames.

## Security priorities
- Rotate/secure Twitch OAuth tokens; validate scopes; provider callback anti-CSRF/state; maintain audit logs.
- Twitch signed webhook HMAC + timestamp freshness + dedup message id. No unsigned game payout.
- `!rift` prompt untrusted: strict schema / denylist dangerous operations, resource quotas, clean HTML escaping, never execute generated code, never let chat set arbitrary Twitch/account IDs. Optical recognition/OCR is also untrusted.
- Actions run under per-stream permission and per-user ownership, not a shared privileged bot context.
- WebSockets authenticate overlay room read-only vs viewer control writer vs moderator, expire/revoke tokens, validate all payload sizes, rate limits, origin checks.
- PII: pseudonymous option, data deletion, camera consent, explicit retention policy and real-world footage sampling only as needed. No real faces/locations required for user ranking.
- Game credits: all validated server-side in DB transaction; reserve caps, circuit breaker on exploit detection, compensating correction process with detailed audit.
- Streamers own emergency stop and safe settings, including moderation of user-generated text bubbles/avatars and effects.

## Operational documentation Codex must add when implemented
- Local stack guide with Docker Compose services and seed data; environment variable reference and CLI test mocks.
- Twitch Developer Console registration, callback, token scopes, EventSub subscription setup, test raid, error handling, creator unlink/relink.
- OBS Browser Source source positioning/canvas transform/camera capture companion setup and audio routing with screenshots and failure troubleshooting.
- Mobile AR build/sign/debug and device compatibility matrix, Twitch RTMP/media transport, permissions.
- Migrations/rollback, backup restore drills, season rollovers, ledger audit/admin corrections.
- Budget meter (per creator call limits), billing and quotas, staged release and incident runbook.
