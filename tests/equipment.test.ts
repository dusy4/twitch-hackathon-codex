import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { credit } from "../apps/api/economy.js";
import { World } from "../apps/api/world.js";
import { avatarColor, equipmentOf } from "../packages/shared/equipment.js";

test("owned slots equip concurrently, survive canonical save/recovery and remove independently without spending", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 9)),
    demo: true,
    timers: false,
  });
  try {
    const login = await s.app.inject({
      method: "POST",
      url: "/v1/demo/session",
      headers: { origin: "http://127.0.0.1:3400" },
      payload: { persona: "third" },
    });
    const cookie = `rr_session=${login.cookies[0].value}`;
    const me = (
      await s.app.inject({ url: "/v1/me", headers: { cookie } })
    ).json();
    const headers = {
      cookie,
      origin: "http://127.0.0.1:3400",
      "x-csrf-token": me.csrf,
    };
    const post = (url: string, payload = {}) =>
      s.app.inject({ method: "POST", url, headers, payload });
    assert.equal(
      (await post("/v1/me/cosmetics/pocket-dragon/equip")).statusCode,
      403,
    );
    assert.equal(
      (await post("/v1/me/cosmetics/unknown/equip")).statusCode,
      404,
    );
    await s.db.transaction((tx) =>
      credit(
        tx,
        me.user.id,
        null,
        980,
        "equipment-test",
        "Test fixture funding",
      ),
    );
    assert.equal((await post("/v1/worlds/demo-world/join")).statusCode, 200);
    const loadout = {
      skin: "mint-scout",
      hat: "star-crown",
      pet: "pocket-dragon",
    };
    for (const id of Object.values(loadout)) {
      const result = await post("/v1/shop/orders", {
        itemId: id,
        idempotencyKey: `buy-${id}`,
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    const before = (await s.app.inject({ url: "/v1/me", headers })).json();
    for (const result of await Promise.all(
      Object.values(loadout).map((id) => post(`/v1/me/cosmetics/${id}/equip`)),
    ))
      assert.equal(result.statusCode, 200, result.body);
    let after = (await s.app.inject({ url: "/v1/me", headers })).json();
    assert.deepEqual(after.user.equipment, loadout);
    assert.equal(after.wallet, before.wallet);
    assert.equal(after.earned, before.earned);
    assert.equal(
      after.user.color,
      me.user.color,
      "Skin does not overwrite the base profile color",
    );
    assert.equal(avatarColor(after.user), "#7be8bf");
    const world = await s.world("demo-world");
    assert.deepEqual(
      world.state.avatars.find((a) => a.id === me.user.id)?.equipment,
      loadout,
    );
    // Saving replaces stale in-memory appearance with the account's canonical loadout.
    world.state.avatars.find((a) => a.id === me.user.id)!.equipment = {};
    await world.save();
    const saved = (
      await s.db.query(
        "SELECT state FROM world_saves WHERE channel_id='demo-world'",
      )
    ).rows[0].state;
    const recovered = new World(s.db, world.channel, saved);
    await recovered.refreshIdentities();
    assert.deepEqual(
      recovered.state.avatars.find((a) => a.id === me.user.id)?.equipment,
      loadout,
    );
    const card = (await post("/v1/me/share-card", { consent: true })).json();
    const svg = await s.app.inject({ url: new URL(card.url).pathname });
    assert.match(svg.body, /data-equipment="star-crown"/);
    assert.match(svg.body, /data-equipment="pocket-dragon"/);
    assert.match(svg.body, /#7be8bf/);
    const removed = await s.app.inject({
      method: "DELETE",
      url: "/v1/me/equipment/hat",
      headers,
    });
    assert.equal(removed.statusCode, 200, removed.body);
    after = (await s.app.inject({ url: "/v1/me", headers })).json();
    assert.deepEqual(after.user.equipment, {
      skin: loadout.skin,
      pet: loadout.pet,
    });
    assert.equal(
      (
        await s.app.inject({
          method: "DELETE",
          url: "/v1/me/equipment/wallet",
          headers,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await s.app.inject({
          method: "DELETE",
          url: "/v1/me/equipment/skin",
          headers: { cookie, origin: headers.origin },
        })
      ).statusCode,
      403,
    );
    for (const slot of ["skin", "pet"])
      await s.app.inject({
        method: "DELETE",
        url: `/v1/me/equipment/${slot}`,
        headers,
      });
    await s.db.migrate();
    assert.deepEqual(
      (
        await s.db.query("SELECT equipment FROM accounts WHERE id=$1", [
          me.user.id,
        ])
      ).rows[0].equipment,
      {},
      "Restart migration preserves an intentionally empty loadout",
    );
    // Upgrade a legacy single-slot account and prove the backfill is idempotent.
    await s.db.query("ALTER TABLE accounts DROP COLUMN equipment");
    await s.db.query("UPDATE accounts SET cosmetic='star-crown' WHERE id=$1", [
      me.user.id,
    ]);
    await s.db.migrate();
    assert.deepEqual(
      (
        await s.db.query("SELECT equipment FROM accounts WHERE id=$1", [
          me.user.id,
        ])
      ).rows[0].equipment,
      { hat: "star-crown" },
    );
    assert.deepEqual(equipmentOf({ cosmetic: "star-crown" }), {
      hat: "star-crown",
    });
    assert.deepEqual(
      equipmentOf({ cosmetic: "star-crown", equipment: {} }),
      {},
    );
  } finally {
    await s.app.close();
  }
});
