import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";

test("native capture consumes named authoritative characters with read-only, expiring, revocable room scope", async () => {
  const security = new Security(Buffer.alloc(32, 27));
  const s = await createApp({
    db: Database.memory(),
    security,
    demo: true,
    timers: false,
  });
  try {
    const world = await s.world("demo-world");
    const viewer = await account(s.db, "native-viewer", "Juniper", true);
    await world.join(viewer);
    const version = (
      await s.db.query("SELECT token_version FROM channels WHERE id=$1", [
        "demo-world",
      ])
    ).rows[0].token_version;
    const scope = {
      room: "demo-world",
      role: "capture",
      version,
      exp: Date.now() + 60_000,
    };
    const token = security.sign(scope);
    const read = (value: string) =>
      s.app.inject({
        url: "/v1/native/world",
        headers: { authorization: `Bearer ${value}` },
      });
    const response = await read(token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.json().mode, "SIMULATOR");
    assert.equal(response.json().avatars.length, 1);
    assert.equal(response.json().avatars[0].id, viewer.id);
    assert.equal(response.json().avatars[0].name, "Juniper");
    await world.action(viewer, "sit", "native-snapshot-sit");
    assert.equal((await read(token)).json().avatars[0].animation, "sit");
    world.state.config.paused = true;
    assert.equal((await read(token)).json().config.paused, true);
    assert.equal(
      (await read(security.sign({ ...scope, role: "overlay" }))).statusCode,
      403,
    );
    assert.equal(
      (await read(security.sign({ ...scope, exp: 1 }))).statusCode,
      401,
    );
    assert.equal(
      (await read(security.sign({ ...scope, room: "missing-room" })))
        .statusCode,
      401,
    );
    assert.equal((await read(token + "invalid")).statusCode, 401);
    assert.equal((await read("")).statusCode, 401);
    const write = await s.app.inject({
      method: "POST",
      url: "/v1/worlds/demo-world/actions",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "http://127.0.0.1:3400",
      },
      payload: {
        prompt: "jump",
        clientRequestId: "native-write",
      },
    });
    assert.equal(
      write.statusCode,
      401,
      "A camera bearer token cannot impersonate a viewer controller",
    );
    await s.db.query(
      "UPDATE channels SET token_version=token_version+1 WHERE id=$1",
      ["demo-world"],
    );
    assert.equal((await read(token)).statusCode, 401);
  } finally {
    await s.app.close();
  }
});
