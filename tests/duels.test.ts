import { test } from "node:test";
import assert from "node:assert/strict";
import { DuelArena } from "../apps/api/duels.js";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";

test("duels enforce participants, turn revisions, replay identity, shields, charge, win and timeout", () => {
  const arena = new DuelArena(() => {}),
    d = arena.start("game", ["a", "b"], 1000);
  assert.throws(
    () => arena.move("game", "stranger", "cast", 0, "x", 1001),
    /consenting/,
  );
  assert.throws(
    () => arena.move("game", "b", "cast", 0, "x", 1001),
    /opponent/,
  );
  arena.move("game", "a", "charge", 0, "a1", 1001);
  arena.move("game", "a", "charge", 0, "a1", 1001);
  assert.equal(d.revision, 1);
  assert.throws(
    () => arena.move("game", "a", "cast", 0, "a1", 1001),
    /different turn/,
  );
  assert.throws(
    () => arena.move("game", "b", "cast", 0, "b1", 1001),
    /duel changed/,
  );
  arena.move("game", "b", "shield", 1, "b1", 1002);
  arena.move("game", "a", "cast", 2, "a2", 1003);
  assert.deepEqual(d.health, [3, 2]);
  assert.equal(d.shield[1], false);
  arena.move("game", "b", "cast", 3, "b2", 1004);
  arena.move("game", "a", "cast", 4, "a3", 1005);
  arena.move("game", "b", "cast", 5, "b3", 1006);
  arena.move("game", "a", "cast", 6, "a4", 1007);
  assert.equal(d.winner, "a");
  assert.equal(d.status, "won");
  assert.throws(() => arena.move("game", "b", "cast", 7, "b4", 1008), /ended/);
  assert.throws(() => arena.start("self", ["a", "a"]), /another traveler/);
  const next = arena.start("next", ["a", "b"], 2000);
  arena.tick(new Set(["a", "b"]), false, 62000);
  assert.equal(next.status, "cancelled");
  const last = arena.start("last", ["a", "b"], 63000);
  arena.cancelFor("b");
  assert.equal(last.status, "cancelled");
});

test("HTTP invitations require consent, reject self/replays and cannot mint duel rewards", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 22)),
    demo: true,
    timers: false,
  });
  try {
    const login = async (persona: string) => {
      const r = await s.app.inject({
        method: "POST",
        url: "/v1/demo/session",
        headers: { origin: "http://127.0.0.1:3400" },
        payload: { persona },
      });
      assert.equal(r.statusCode, 200, r.body);
      const cookie = `${r.cookies[0].name}=${r.cookies[0].value}`;
      const me = (
        await s.app.inject({ url: "/v1/me", headers: { cookie } })
      ).json();
      return {
        id: me.user.id,
        headers: {
          cookie,
          origin: "http://127.0.0.1:3400",
          "x-csrf-token": me.csrf,
        },
      };
    };
    const a = await login("traveler"),
      b = await login("host");
    for (const player of [a, b])
      assert.equal(
        (
          await s.app.inject({
            method: "POST",
            url: "/v1/worlds/demo-world/join",
            headers: player.headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
    const send = async (inviteeId: string) =>
      s.app.inject({
        method: "POST",
        url: "/v1/parties/invite",
        headers: a.headers,
        payload: { channelId: "demo-world", inviteeId, kind: "duel" },
      });
    assert.equal((await send(a.id)).statusCode, 400);
    const invite = (await send(b.id)).json();
    const url = `/v1/parties/${invite.id}/accept`;
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url,
          headers: a.headers,
          payload: {},
        })
      ).statusCode,
      400,
    );
    const accepted = await s.app.inject({
      method: "POST",
      url,
      headers: b.headers,
      payload: {},
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url,
          headers: b.headers,
          payload: {},
        })
      ).statusCode,
      400,
    );
    const before = (await s.db.query("SELECT count(*) FROM ledger")).rows[0]
      .count;
    const move = async (player: typeof a, revision: number, key: string) =>
      s.app.inject({
        method: "POST",
        url: `/v1/worlds/demo-world/duels/${invite.id}/moves`,
        headers: player.headers,
        payload: { move: "cast", revision, clientRequestId: key },
      });
    assert.equal((await move(b, 0, "bad")).statusCode, 409);
    assert.equal((await move(a, 0, "one")).statusCode, 200);
    assert.equal((await move(a, 0, "one")).json().duel.revision, 1);
    assert.equal((await move(b, 0, "old")).statusCode, 409);
    const w = await s.world("demo-world");
    w.stop();
    assert.equal((await move(b, 1, "two")).statusCode, 409);
    assert.equal(w.duels.games[0].status, "cancelled");
    assert.equal(
      (await s.db.query("SELECT count(*) FROM ledger")).rows[0].count,
      before,
    );
  } finally {
    await s.app.close();
  }
});
