import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { localCompile } from "../apps/api/compiler.js";
import {
  createTailnetTestApp,
  TAILNET_ROOM,
} from "../apps/api/tailnet-test.js";

test("WASD chat aliases compile into the same bounded movement as directional commands", () => {
  for (const [alias, direction] of [
    ["w", "up"],
    ["a", "left"],
    ["s", "down"],
    ["d", "right"],
  ]) {
    const expected = localCompile(direction, [], 0.5, 0.5)!;
    for (const command of [`!${alias}`, `!rift ${alias.toUpperCase()}`]) {
      const actual = localCompile(command, [], 0.5, 0.5)!;
      assert.deepEqual(actual.steps, expected.steps);
    }
  }
});

test("stub raid and three identified chatters travel through EventSub inbox and own separate characters", async () => {
  delete process.env.OPENCODE_GO_API_KEY;
  const s = await createTailnetTestApp({
    host: "127.0.0.1",
    port: 3497,
    origin: "http://127.0.0.1:3497",
    timers: false,
    debugChatStaggerMs: 0,
  });
  try {
    const pair = (await s.app.inject({ url: "/v1/debug/pair" })).json();
    const event = async (payload: Record<string, unknown>) => {
      const result = await s.app.inject({
        method: "POST",
        url: "/v1/native/debug/event",
        headers: { authorization: `Bearer ${pair.token}` },
        payload,
      });
      assert.equal(result.statusCode, 200, result.body);
      await s.drain();
    };
    const w = await s.world(TAILNET_ROOM);
    await event({ type: "reset" });
    await event({
      type: "raid",
      from: "Stub viewers",
      viewers: 3,
      chatters: 0,
    });
    assert.equal(w.state.raid!.count, 3);
    assert.equal(
      w.state.avatars.length,
      0,
      "The count does not identify viewers",
    );
    for (const name of ["Alice", "Bob", "Charlie"])
      await event({ type: "chat", name, text: "!join" });
    assert.equal(w.state.avatars.length, 3);
    assert.equal(new Set(w.state.avatars.map((a) => a.id)).size, 3);
    const bob = w.state.avatars.find((a) => a.name === "Bob")!;
    const bobBefore = { ...bob };
    await event({ type: "chat", name: "Alice", text: "!dance" });
    assert.equal(
      w.state.avatars.find((a) => a.name === "Alice")!.animation,
      "dance",
    );
    assert.deepEqual(bob, bobBefore);
    await event({ type: "chat", name: "Bob", text: "!d" });
    assert.equal(w.running.get(bob.id)!.plan.steps[0].name, "walk");
    assert.ok(w.running.get(bob.id)!.plan.steps[0].x! > bobBefore.x);
    await event({ type: "chat", name: "Charlie", text: "!wave" });
    assert.equal(
      w.state.avatars.find((a) => a.name === "Charlie")!.animation,
      "wave",
    );
    await event({ type: "chat", name: "Alice", text: "!join" });
    assert.equal(
      w.state.avatars.length,
      3,
      "Repeated !join never makes another character",
    );
    mock.timers.enable({ apis: ["Date"], now: Date.now() + 1000 });
    await event({ type: "chat", name: "Alice", text: "!rift make @Bob dance" });
    assert.equal(
      w.running.get(bob.id)!.plan.steps[0].name,
      "walk",
      "Alice cannot take over Bob",
    );
    assert.ok(
      w.debugLog.some(
        (line) =>
          line.kind === "error" && line.text.includes("CONSENT_REQUIRED"),
      ),
    );
  } finally {
    mock.timers.reset();
    await s.app.close();
  }
});
