import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { World } from "../apps/api/world.js";
import { PORTAL_FOOT } from "../packages/shared/arrivals.js";

test("claimed characters enter from the portal, settle authoritatively, never duplicate on rejoin and obey commands/stop instead of finishing stale arrivals", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 18)),
    demo: true,
    timers: false,
  });
  try {
    const login = async (persona: string) => {
      const response = await s.app.inject({
        method: "POST",
        url: "/v1/demo/session",
        headers: { origin: "http://127.0.0.1:3400" },
        payload: { persona },
      });
      const cookie = `rr_session=${response.cookies[0].value}`;
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
    const player = await login("third"),
      other = await login("second");
    const world = await s.world("demo-world");
    const identities = Number(
      (await s.db.query("SELECT count(*) AS n FROM accounts")).rows[0].n,
    );
    await world.raid(
      "arrival-fixture",
      "synthetic-source",
      "Synthetic raid",
      10000,
      true,
    );
    assert.equal(
      Number(
        (await s.db.query("SELECT count(*) AS n FROM accounts")).rows[0].n,
      ),
      identities,
      "Reported raid viewers do not create player identities",
    );
    const joining = await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/join",
      headers: player.headers,
      payload: {},
    });
    assert.equal(joining.statusCode, 200, joining.body);
    const first = joining.json();
    assert.deepEqual([first.x, first.y], PORTAL_FOOT);
    assert.deepEqual(first.arrival.from, PORTAL_FOOT);
    assert.notEqual(first.arrival.to[0], first.x);
    world.tick(first.arrival.startedAt + first.arrival.durationMs / 2);
    const actor = world.state.avatars.find((a) => a.id === player.id)!;
    assert.ok(actor.x > first.x && actor.x < first.arrival.to[0]);
    world.tick(first.arrival.startedAt + first.arrival.durationMs + 1);
    assert.deepEqual([actor.x, actor.y], first.arrival.to);
    assert.equal(actor.arrival, undefined);
    const again = (
      await s.app.inject({
        method: "POST",
        url: "/v1/worlds/demo-world/join",
        headers: player.headers,
        payload: {},
      })
    ).json();
    assert.equal(again.spawnedAt, first.spawnedAt);
    assert.equal(
      world.state.avatars.filter((a) => a.id === player.id).length,
      1,
    );
    await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/join",
      headers: other.headers,
      payload: {},
    });
    const action = await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/actions",
      headers: other.headers,
      payload: { prompt: "wave", clientRequestId: randomUUID() },
    });
    assert.equal(action.statusCode, 200, action.body);
    assert.equal(
      world.state.avatars.find((a) => a.id === other.id)?.arrival,
      undefined,
      "A viewer's command takes precedence over automatic arrival motion",
    );
    actor.spawnedAt = Date.now() - 4000; // Advance the entrance cooldown without a wall-clock sleep.
    const before = (
      await s.app.inject({ url: "/v1/me", headers: player.headers })
    ).json();
    const reentered = await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/join",
      headers: player.headers,
      payload: { entrance: true },
    });
    assert.equal(reentered.statusCode, 200, reentered.body);
    assert.deepEqual(reentered.json().arrival.from, PORTAL_FOOT);
    const after = (
      await s.app.inject({ url: "/v1/me", headers: player.headers })
    ).json();
    assert.equal(
      before.wallet,
      after.wallet,
      "Reentering does not repeat the first-join award",
    );
    assert.equal(world.state.avatars.length, 2);
    world.stop();
    assert.ok(world.state.avatars.every((a) => !a.arrival));
    await world.save();
    const saved = (
      await s.db.query(
        "SELECT state FROM world_saves WHERE channel_id='demo-world'",
      )
    ).rows[0].state;
    assert.ok(
      saved.avatars.every((a: any) => !a.arrival && !a.spawnedAt),
      "Restarts restore positions without replaying an old entrance",
    );
    const recovered = new World(s.db, world.channel, saved);
    assert.equal(recovered.state.avatars.length, 2);
  } finally {
    await s.app.close();
  }
});
