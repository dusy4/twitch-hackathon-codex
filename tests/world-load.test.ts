import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { account } from "../apps/api/economy.js";
import { World } from "../apps/api/world.js";
import { defaultConfig } from "../packages/shared/contracts.js";
test("hybrid quest requires physical proximity and the same visible target for the sustained group", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const users = await Promise.all(
      ["hybrid-a", "hybrid-b", "hybrid-c"].map((id) => account(db, id, id)),
    );
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["hybrid", users[0].id, JSON.stringify(defaultConfig)],
    );
    await db.query(
      "INSERT INTO quests(id,channel_id,definition) VALUES($1,$2,$3)",
      [
        "hybrid-q",
        "hybrid",
        JSON.stringify({
          title: "Perch together",
          type: "hybrid",
          action: "sit",
          targetClass: "dog",
          minPlayers: 3,
          sustainMs: 1000,
          reward: 40,
        }),
      ],
    );
    const w = new World(db, { id: "hybrid", config: defaultConfig });
    await w.loadQuests();
    await Promise.all(users.map((u) => w.join(u)));
    const now = Date.now();
    w.state.tracks = [
      {
        id: "dog-a",
        class: "dog",
        attributes: [],
        box: [0.5, 0.5, 0.2, 0.2],
        anchor: [0.6, 0.56],
        confidence: 0.9,
        seenAt: now,
      },
      {
        id: "dog-b",
        class: "dog",
        attributes: [],
        box: [0.1, 0.5, 0.2, 0.2],
        confidence: 0.9,
        seenAt: now,
      },
    ];
    w.evidence.set("hybrid-q", [
      { at: now - 900, hash: "one", probability: 0.99 },
      { at: now, hash: "two", probability: 0.99 },
    ]);
    for (const a of w.state.avatars) {
      a.animation = "sit";
      a.target = "dog-a";
      a.x = 0.6;
      a.y = 0.56;
    }
    w.state.avatars[2].target = "dog-b";
    w.state.avatars[2].x = 0.2;
    w.state.avatars[2].y = 0.5;
    await w.evaluateQuests(now);
    await w.evaluateQuests(now + 1100);
    assert.equal(w.state.quests[0].completed, false);
    w.state.avatars[2].target = "dog-a";
    w.state.avatars[2].x = 0.9;
    await w.evaluateQuests(now + 1200);
    assert.equal(w.state.quests[0].progress, 0);
    w.state.avatars[2].x = 0.6;
    w.state.avatars[2].y = 0.56;
    await w.evaluateQuests(now + 1300);
    await w.evaluateQuests(now + 2400);
    assert.equal(
      w.state.quests[0].completed,
      false,
      "old visual evidence must expire",
    );
    w.evidence.set("hybrid-q", [
      { at: now + 1400, hash: "three", probability: 0.99 },
      { at: now + 2200, hash: "four", probability: 0.99 },
    ]);
    await w.evaluateQuests(now + 2500);
    await w.evaluateQuests(now + 3600);
    assert.equal(w.state.quests[0].completed, true);
    assert.equal((await db.query("SELECT * FROM quest_awards")).rows.length, 3);
  } finally {
    await db.close();
  }
});
test("25 parallel identified prompts execute independently with bounded spawned entities", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const host = await account(db, "host", "Host");
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["load", host.id, JSON.stringify(defaultConfig)],
    );
    const world = new World(db, {
      id: "load",
      owner_id: host.id,
      config: defaultConfig,
    });
    const users = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        account(db, `load-${i}`, `Actor ${i}`),
      ),
    );
    const actions = await Promise.all(
      users.map((who, i) =>
        world.action(who, "summon a tiny dragon and ride it", `request-${i}`),
      ),
    );
    assert.equal(new Set(actions.map((a) => a.id)).size, 25);
    assert.equal(world.state.avatars.length, 25);
    assert.equal(world.state.props.length, 25);
    assert.equal(world.running.size, 25);
    assert.equal((await db.query("SELECT * FROM accounts")).rows.length, 26);
    world.stop();
    assert.equal(world.state.props.length, 0);
    assert.equal(world.running.size, 0);
  } finally {
    await db.close();
  }
});
test("cooperative quest cannot swap fresh players into an almost-complete sustained group", async () => {
  const db = Database.memory();
  await db.migrate();
  try {
    const host = await account(db, "host", "Host");
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["team", host.id, JSON.stringify(defaultConfig)],
    );
    await db.query(
      "INSERT INTO quests(id,channel_id,definition) VALUES($1,$2,$3)",
      [
        "team-q",
        "team",
        JSON.stringify({
          title: "Together",
          type: "virtual",
          action: "dance",
          targetClass: null,
          minPlayers: 2,
          sustainMs: 2000,
          reward: 40,
        }),
      ],
    );
    const world = new World(db, { id: "team", config: defaultConfig });
    await world.loadQuests();
    const users = await Promise.all(
      ["a", "b", "c"].map((id) => account(db, id, id)),
    );
    await Promise.all(users.map((u) => world.join(u)));
    world.state.avatars[0].animation = "dance";
    world.state.avatars[1].animation = "dance";
    const now = Date.now();
    await world.evaluateQuests(now);
    await world.evaluateQuests(now + 1800);
    world.state.avatars[1].animation = "idle";
    world.state.avatars[2].animation = "dance";
    await world.evaluateQuests(now + 2100);
    assert.equal(world.state.quests[0].completed, false);
    assert.equal(world.state.quests[0].progress, 0);
    await world.evaluateQuests(now + 4200);
    assert.equal(world.state.quests[0].completed, true);
    assert.equal((await db.query("SELECT * FROM quest_awards")).rows.length, 2);
  } finally {
    await db.close();
  }
});
