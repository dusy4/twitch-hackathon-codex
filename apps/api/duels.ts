import { GameError } from "./compiler.js";
import type { DuelMove, DuelState } from "../../packages/shared/duels.js";

/** Ephemeral, bounded social game. Never reads or writes the Shards ledger. */
export class DuelArena {
  games: DuelState[] = [];
  private receipts = new Map<
    string,
    Map<string, { actor: string; move: DuelMove; revision: number }>
  >();
  constructor(private emit: (type: string, duel: DuelState) => void) {}
  start(id: string, players: [string, string], now = Date.now()) {
    const existing = this.games.find((d) => d.id === id);
    if (existing) return existing;
    if (players[0] === players[1])
      throw new GameError("SELF_INVITE", "Choose another traveler.");
    if (
      this.games.some(
        (d) =>
          d.status === "active" && d.players.some((p) => players.includes(p)),
      )
    )
      throw new GameError("DUEL_BUSY", "A player is already in a duel.", 409);
    if (this.games.filter((d) => d.status === "active").length >= 4)
      throw new GameError(
        "DUEL_CAPACITY",
        "Four duels are already in progress.",
        429,
      );
    const duel: DuelState = {
      id,
      players,
      health: [3, 3],
      charge: [0, 0],
      shield: [false, false],
      turn: players[0],
      revision: 0,
      expires: now + 60000,
      status: "active",
      winner: null,
      message:
        "The challenger opens. Each turn has 60 seconds. No Shards are at stake.",
    };
    this.games = [
      ...this.games.filter((d) => d.status === "active").slice(-7),
      duel,
    ];
    for (const key of this.receipts.keys())
      if (!this.games.some((d) => d.id === key)) this.receipts.delete(key);
    this.receipts.set(id, new Map());
    this.emit("duel.started", duel);
    return duel;
  }
  move(
    id: string,
    actor: string,
    move: DuelMove,
    revision: number,
    requestKey: string,
    now = Date.now(),
  ) {
    const d = this.games.find((d) => d.id === id);
    if (!d)
      throw new GameError(
        "DUEL_NOT_FOUND",
        "This duel has ended or expired.",
        404,
      );
    const index = d.players.indexOf(actor);
    if (index < 0)
      throw new GameError(
        "DUEL_PARTICIPANT",
        "Only the two consenting players can act.",
        403,
      );
    const receipts = this.receipts.get(id)!;
    const previous = receipts.get(requestKey);
    if (previous) {
      if (
        previous.actor !== actor ||
        previous.move !== move ||
        previous.revision !== revision
      )
        throw new GameError(
          "REQUEST_CONFLICT",
          "Use a new request ID for a different turn.",
          409,
        );
      return d;
    }
    if (d.status !== "active")
      throw new GameError("DUEL_ENDED", "This duel has ended.", 409);
    if (now >= d.expires) {
      this.cancel(d, "The turn expired.");
      throw new GameError("DUEL_EXPIRED", "The turn expired.", 409);
    }
    if (revision !== d.revision)
      throw new GameError(
        "STALE_TURN",
        "The duel changed. Wait for the current turn.",
        409,
      );
    if (move !== "leave" && d.turn !== actor)
      throw new GameError(
        "NOT_YOUR_TURN",
        "Wait for your opponent’s turn.",
        409,
      );
    if (receipts.size >= 80) {
      this.cancel(d, "The 80-turn limit was reached.");
      throw new GameError(
        "DUEL_LIMIT",
        "The duel reached its turn limit.",
        409,
      );
    }
    const other = 1 - index;
    if (move === "leave") this.cancel(d, "A player left the friendly duel.");
    else {
      if (move === "cast") {
        const power = 1 + d.charge[index];
        const damage = Math.max(0, power - (d.shield[other] ? 1 : 0));
        d.health[other] = Math.max(0, d.health[other] - damage);
        d.charge[index] = 0;
        d.shield[other] = false;
        d.message = damage
          ? `Spell hit for ${damage}.`
          : "The shield blocked the spell.";
      } else if (move === "charge") {
        if (d.charge[index] >= 2)
          throw new GameError(
            "CHARGE_FULL",
            "Your next spell is fully charged.",
            409,
          );
        d.charge[index]++;
        d.shield[index] = false;
        d.message = "A stronger spell is charging.";
      } else {
        d.shield[index] = true;
        d.message =
          "A shield will absorb one point from the next incoming spell.";
      }
      d.revision++;
      d.turn = d.players[other];
      d.expires = now + 60000;
      if (d.health[other] === 0) {
        d.status = "won";
        d.winner = actor;
        d.message = "Friendly duel complete. No Shards awarded.";
      }
    }
    receipts.set(requestKey, { actor, move, revision });
    this.emit("duel.changed", d);
    return d;
  }
  private cancel(d: DuelState, message: string) {
    d.status = "cancelled";
    d.winner = null;
    d.message = message;
    d.revision++;
    this.emit("duel.changed", d);
  }
  cancelFor(actor: string) {
    for (const d of this.games)
      if (d.status === "active" && d.players.includes(actor))
        this.cancel(d, "A player left this world.");
  }
  tick(present: Set<string>, paused: boolean, now = Date.now()) {
    for (const d of this.games)
      if (
        d.status === "active" &&
        (paused || now >= d.expires || d.players.some((p) => !present.has(p)))
      )
        this.cancel(
          d,
          paused
            ? "The creator stopped the world."
            : now >= d.expires
              ? "The turn expired."
              : "A player left this world.",
        );
    this.games = this.games.filter(
      (d) => d.status === "active" || now - d.expires < 60000,
    );
    for (const id of this.receipts.keys())
      if (!this.games.some((d) => d.id === id)) this.receipts.delete(id);
  }
}
