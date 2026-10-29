# Community construction

The creator explicitly enables **Allow community structures to persist for 24 hours** in Creator Studio. It defaults off. Joined viewers open **Community workshop** from their controller to enter `/workshop?room=<channel>`. This is a shared synthetic stage, not a camera anchor or a real-world building claim. No currency is spent or awarded.

Each founder can create one active structure per world, with up to eight active structures per room. A foundation begins at grid cell 3 / 0 / 3. Contributors place original riftstone, moss, amethyst or sandstone blocks in an 8×6×8 grid. Blocks above ground require direct support below. A supported block cannot be removed until the blocks above it are removed. Each contributor can place at most 16 blocks per structure, and the whole structure is bounded to 64 blocks. These are discrete support constraints; dynamic rigid-body collapse, bridge physics and avatar collisions remain unimplemented.

Contributors remove their own blocks. The channel creator can moderate any block. Only the founder or channel creator can remove an entire structure. A creator can pause the world or disable further construction at any time; existing structures remain until their original 24-hour lease expires. Disabling construction does not silently extend a lease. Saved structures survive process restart and are loaded from SQL alongside the authoritative room. Scene/camera resets do not invent camera attachment for these stage objects.

## Authority and persistence

`migrations/003_construction.sql` adds structures and mutation receipts. Each mutation locks the active account and channel before checking authoritative opt-in, privacy, pause, current participation and bans. Room limits are checked inside that transaction. Existing structures use an expected revision; concurrent edits to the same revision accept one change and reject the stale one. The UI refreshes canonical state after either a successful mutation or an error.

`POST /v1/worlds/:id/construction` accepts a strict discriminated body with `requestId` (UUID) and one operation:

- `create`: `title`, normalized stage `x`/`y`.
- `place`: `structureId`, `revision`, integer `x`/`y`/`z`, catalog `material`.
- `remove`: `structureId`, `revision`, integer `x`/`y`/`z`.
- `delete`: `structureId`, `revision`.

Session, same origin and CSRF checks apply. Actor identity comes from the session. Ownership fields and unknown materials/coordinates are rejected. Successful mutation budgets are three per second and 300 per rolling 24 hours per account. Retries with the same request ID and identical validated input do not repeat the operation or consume another receipt. Reusing an ID with different input is rejected. A replay returns the current canonical structure if it still exists, not a historical copy of other contributors' metadata.

Receipts retain only operation fingerprints and result identifiers; they do not archive titles or block ownership snapshots. Receipts and expired structures are cleaned periodically after their 24-hour window. Account deletion removes structures founded by that account and structures in its owned channel, removes its receipts, and anonymizes contribution ownership in other structures while preserving supported geometry. The account-deletion path and construction path use the same account/channel/structure lock order.

## Validation and limits

Integration checks exercise 100 duplicate creation requests, support rules, unauthorized removals, concurrent revision conflict, save/recovery, disabled/paused/private/banned worlds, CSRF and payload validation, room/contributor/block/daily budgets, contributor deletion and lease expiry. The browser scenario uses two independent sessions, shared WebSocket updates, reload persistence, visible voxel output, supported top-down removal and automated WCAG checks. Actual results are tracked in `PROGRESS.md` and `RELEASE_SCORECARD.md`.

Current rendering is bounded original voxel geometry. A single world-owner process remains required. Native mobile does not yet render these structures. No live Twitch, public deployment, multi-process ownership, stress benchmark or construction quest-reward claim is implied by local tests.
