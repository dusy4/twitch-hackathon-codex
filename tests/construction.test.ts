import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";

test("community construction enforces opt-in, support, ownership, revisions, replay, recovery, deletion and bounded leases without rewards", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 7)),
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
    const host = await login("host"),
      a = await login("traveler"),
      b = await login("second"),
      c = await login("third");
    const config = (
      await s.app.inject({ url: "/v1/creator/config", headers: host.headers })
    ).json().config;
    const setConfig = (changes: Record<string, unknown>) =>
      s.app.inject({
        method: "PATCH",
        url: "/v1/creator/config",
        headers: host.headers,
        payload: { ...config, construction: true, ...changes },
      });
    const mutate = (actor: typeof a, operation: Record<string, unknown>) =>
      s.app.inject({
        method: "POST",
        url: "/v1/worlds/demo-world/construction",
        headers: actor.headers,
        payload: { requestId: randomUUID(), ...operation },
      });
    const create = {
      kind: "create",
      title: "A shared watchtower",
      x: 0.65,
      y: 0.78,
    };
    assert.equal((await mutate(a, create)).json().code, "BUILDING_DISABLED");
    await setConfig({});
    assert.equal((await mutate(a, create)).json().code, "JOIN_REQUIRED");
    for (const actor of [host, a, b, c])
      assert.equal(
        (
          await s.app.inject({
            method: "POST",
            url: "/v1/worlds/demo-world/join",
            headers: actor.headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
    const before = (
      await s.app.inject({ url: "/v1/me", headers: a.headers })
    ).json();
    const requestId = randomUUID();
    const first = await mutate(a, { ...create, requestId });
    assert.equal(first.statusCode, 200, first.body);
    let building = first.json().structure;
    assert.equal(building.blocks.length, 1);
    for (const replay of await Promise.all(
      Array.from({ length: 100 }, () => mutate(a, { ...create, requestId })),
    )) {
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.json().structure.id, building.id);
    }
    assert.equal(
      (await s.db.query("SELECT count(*)::int AS n FROM structures")).rows[0].n,
      1,
    );
    assert.equal(
      (await mutate(a, { ...create, title: "Another title", requestId })).json()
        .code,
      "REQUEST_REUSED",
    );
    const edit = (kind: string, x = 3, y = 1, z = 3) => ({
      kind,
      structureId: building.id,
      revision: building.revision,
      x,
      y,
      z,
      ...(kind === "place" ? { material: "moss" } : {}),
    });
    assert.equal(
      (await mutate(b, edit("place", 3, 3, 3))).json().code,
      "NEEDS_SUPPORT",
    );
    const placed = await mutate(b, edit("place"));
    assert.equal(placed.statusCode, 200, placed.body);
    const oldRevision = building.revision;
    building = placed.json().structure;
    assert.equal(
      (
        await mutate(a, { ...edit("place", 4, 0, 3), revision: oldRevision })
      ).json().code,
      "BUILD_CONFLICT",
    );
    assert.equal((await mutate(a, edit("remove"))).json().code, "NOT_YOURS");
    assert.equal(
      (await mutate(a, edit("remove", 3, 0, 3))).json().code,
      "SUPPORT_IN_USE",
    );
    const concurrent = await Promise.all([
      mutate(a, edit("place", 4, 0, 3)),
      mutate(c, edit("place", 5, 0, 3)),
    ]);
    assert.equal(
      concurrent.filter((response) => response.statusCode === 200).length,
      1,
    );
    assert.equal(
      concurrent.filter((response) => response.json().code === "BUILD_CONFLICT")
        .length,
      1,
    );
    building = concurrent
      .find((response) => response.statusCode === 200)!
      .json().structure;
    assert.equal(
      (
        await mutate(c, {
          kind: "delete",
          structureId: building.id,
          revision: building.revision,
        })
      ).json().code,
      "NOT_YOURS",
    );
    const world = await s.world("demo-world");
    await world.save();
    s.worlds.delete("demo-world");
    const restored = await s.world("demo-world");
    assert.deepEqual(
      restored.state.structures?.find((item) => item.id === building.id),
      building,
    );
    await setConfig({ paused: true });
    assert.equal(
      (await mutate(b, edit("place", 6, 0, 3))).json().code,
      "WORLD_PAUSED",
    );
    await setConfig({ public: false });
    assert.equal(
      (await mutate(b, edit("place", 6, 0, 3))).json().code,
      "PRIVATE",
    );
    await setConfig({});
    await s.db.query(
      "INSERT INTO bans(channel_id,account_id,reason) VALUES('demo-world',$1,'test fixture')",
      [c.id],
    );
    assert.equal(
      (await mutate(c, edit("place", 6, 0, 3))).json().code,
      "BANNED",
    );
    const bad = await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/construction",
      headers: { cookie: a.headers.cookie, origin: a.headers.origin },
      payload: { ...create, requestId: randomUUID() },
    });
    assert.equal(bad.statusCode, 403);
    assert.equal((await mutate(a, { ...edit("place"), x: 8 })).statusCode, 400);
    assert.equal(
      (await mutate(a, { ...edit("place"), ownerId: b.id })).statusCode,
      400,
    );
    // Deterministic quota fixtures avoid sleeps and exercise the same public mutation endpoint.
    assert.equal((await mutate(a, create)).json().code, "STRUCTURE_LIMIT");
    await s.db.query(
      "INSERT INTO structures(id,channel_id,owner_id,title,x,y) SELECT 'budget-'||n,'demo-world',$1,'Capacity fixture',0.5,0.7 FROM generate_series(1,7) n",
      [host.id],
    );
    assert.equal((await mutate(host, create)).json().code, "STRUCTURE_LIMIT");
    await s.db.query("DELETE FROM structures WHERE id LIKE 'budget-%'");
    const originalBlocks = building.blocks;
    const limited = Array.from({ length: 16 }, (_, i) => ({
      x: i % 4,
      y: 0,
      z: Math.floor(i / 4),
      material: "riftstone",
      ownerId: a.id,
    }));
    await s.db.query("UPDATE structures SET blocks=$2 WHERE id=$1", [
      building.id,
      JSON.stringify(limited),
    ]);
    assert.equal((await mutate(a, edit("place"))).json().code, "BLOCK_LIMIT");
    const full = Array.from({ length: 64 }, (_, i) => ({
      x: i % 8,
      y: 0,
      z: Math.floor(i / 8),
      material: "moss",
      ownerId: null,
    }));
    await s.db.query("UPDATE structures SET blocks=$2 WHERE id=$1", [
      building.id,
      JSON.stringify(full),
    ]);
    assert.equal(
      (await mutate(host, edit("place"))).json().code,
      "BLOCK_LIMIT",
    );
    await s.db.query("UPDATE structures SET blocks=$2 WHERE id=$1", [
      building.id,
      JSON.stringify(originalBlocks),
    ]);
    await s.db.query(
      "INSERT INTO construction_receipts(account_id,request_id,fingerprint,result,created_at) SELECT $1,'budget-'||n,'fixture','{}'::jsonb,now()-interval '2 seconds' FROM generate_series(1,300) n",
      [a.id],
    );
    assert.equal(
      (await mutate(a, edit("place", 6, 0, 3))).json().code,
      "BUILD_BUDGET",
    );
    await s.db.query(
      "DELETE FROM construction_receipts WHERE request_id LIKE 'budget-%'",
    );
    // Deleting a contributor anonymizes their physical contribution without breaking a supported stack.
    assert.equal(
      (
        await s.app.inject({
          method: "DELETE",
          url: "/v1/me",
          headers: b.headers,
        })
      ).statusCode,
      200,
    );
    building = restored.state.structures!.find(
      (item) => item.id === building.id,
    )!;
    assert.equal(
      building.blocks.find((block: any) => block.y === 1)?.ownerId,
      null,
    );
    assert.ok(!JSON.stringify(building).includes(b.id));
    const after = (
      await s.app.inject({ url: "/v1/me", headers: a.headers })
    ).json();
    assert.equal(after.wallet, before.wallet);
    assert.equal(after.earned, before.earned);
    await s.db.query(
      "UPDATE structures SET expires_at=now()-interval '1 second' WHERE id=$1",
      [building.id],
    );
    restored.tick(Date.parse(building.expiresAt) + 1);
    assert.equal(restored.state.structures?.length, 0);
    assert.equal(
      (await mutate(a, edit("place", 6, 0, 3))).json().code,
      "STRUCTURE_GONE",
    );
  } finally {
    await s.app.close();
  }
});
