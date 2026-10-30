import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { chatIntent } from "../apps/api/chat-intent.js";
import { localCompile, validatePlan } from "../apps/api/compiler.js";
import {
  createTailnetTestApp,
  TAILNET_ROOM,
} from "../apps/api/tailnet-test.js";

test("plain English and Ukrainian intent is bounded and ordinary chat remains conversation", () => {
  for (const [message, expected] of [
    ["please walk right", "right"],
    ["йди ліворуч", "left"],
    ["підійди ближче", "down"],
    ["стрибни!", "jump"],
    ["walk right then jump", "right then jump"],
    ["повернись потім танцюй", "turn_around then dance"],
  ]) {
    assert.equal(chatIntent(message), expected);
    const plan = localCompile(message, [], 0.5, 0.5)!;
    assert.ok(plan, message);
    validatePlan(plan, []);
  }
  const travel = localCompile("walk right then jump", [], 0.5, 0.5)!;
  assert.deepEqual(
    travel.steps.map((s) => s.op),
    ["navigate", "jump"],
  );
  assert.ok(travel.steps[0].x! > 0.5);
  for (const message of [
    "W",
    "join then dance",
    "great stream!",
    "I jump into games",
    "my dog can dance",
    "make @Bob jump",
    "everyone jump",
    "walk right then delete files",
    "jump then jump then jump then jump then jump",
  ])
    assert.equal(chatIntent(message), null, message);
});

test("plain chat goes through authenticated EventSub identity and never redirects another viewer", async () => {
  const s = await createTailnetTestApp({
    host: "127.0.0.1",
    port: 3496,
    origin: "http://127.0.0.1:3496",
    timers: false,
    debugChatStaggerMs: 0,
  });
  try {
    const pair = (await s.app.inject({ url: "/v1/debug/pair" })).json();
    async function chat(name: string, text: string) {
      const response = await s.app.inject({
        method: "POST",
        url: "/v1/native/debug/event",
        headers: { authorization: `Bearer ${pair.token}` },
        payload: { type: "chat", name, text },
      });
      assert.equal(response.statusCode, 200, response.body);
      await s.drain();
    }
    const w = await s.world(TAILNET_ROOM);
    await chat("Alice", "join");
    await chat("Bob", "join");
    const bob = w.state.avatars.find((a) => a.name === "Bob")!;
    const before = { ...bob };
    await chat("Alice", "walk right then jump");
    const alice = w.state.avatars.find((a) => a.name === "Alice")!;
    assert.equal(w.running.get(alice.id)!.plan.steps[0].op, "navigate");
    assert.equal(w.running.get(alice.id)!.plan.steps[1].op, "jump");
    assert.deepEqual(bob, before);
    const count = w.state.avatars.length;
    const accounts = (
      await s.db.query("SELECT count(*) AS count FROM accounts")
    ).rows[0].count;
    await chat("Unjoined", "walk right");
    await chat("Unjoined", "stop");
    await chat("W fan", "W");
    assert.equal(
      (await s.db.query("SELECT count(*) AS count FROM accounts")).rows[0]
        .count,
      accounts,
      "Ordinary chat does not create accounts or join rewards",
    );
    await chat("Someone", "great stream!");
    assert.equal(
      w.state.avatars.length,
      count,
      "Conversation must not silently join a viewer",
    );
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 1000 });
    await chat("Bob", "стрибни");
    assert.equal(bob.animation, "jump");
    assert.notEqual(alice.id, bob.id);
  } finally {
    mock.timers.reset();
    await s.app.close();
  }
});
