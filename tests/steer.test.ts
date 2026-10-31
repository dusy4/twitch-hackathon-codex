import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";

test("steer is actor-owned, bounded, camera-relative, rate limited, expiring and interrupts plans", async () => {
  const s = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 9)),
    timers: false,
  });
  mock.timers.enable({ apis: ["Date"], now: 1800000000000 });
  try {
    const w = await s.world("demo-world"),
      alice = await account(s.db, "alice-steer", "Alice", true),
      bob = await account(s.db, "bob-steer", "Bob", true);
    await Promise.all([w.join(alice), w.join(alice), w.join(bob)]);
    assert.equal(w.state.avatars.length, 2);
    const a = w.state.avatars.find((a) => a.id === alice.id)!,
      b = w.state.avatars.find((a) => a.id === bob.id)!;
    await w.action(alice, "dance", "dance");
    assert.ok(w.running.has(a.id));
    await w.steer(alice, 1, 1);
    assert.equal(w.running.has(a.id), false);
    assert.equal(b.steer, undefined);
    const start = { x: a.x, y: a.y };
    w.tick(Date.now() + 100, 0.1);
    assert.ok(a.x > start.x && a.y < start.y);
    assert.ok(Math.hypot(a.x - start.x, a.y - start.y) <= 0.02501);
    await assert.rejects(w.steer(alice, 0, 0), /ten steering/);
    mock.timers.setTime(Date.now() + 100);
    await w.steer(alice, 0, 0);
    assert.equal(a.steer, null);
    assert.equal(a.animation, "idle");
    await assert.rejects(w.steer(alice, 2, 0), /between/);
    mock.timers.setTime(Date.now() + 100);
    await w.steer(alice, -1, 0);
    const seq = a.steer!.seq;
    w.tick(Date.now() + 601, 0.05);
    assert.equal(a.steer, null);
    assert.equal(a.animation, "idle");
    mock.timers.setTime(Date.now() + 600);
    await w.steer(alice, 0, 1);
    assert.ok(a.steer!.seq > seq);
    await w.action(alice, "wave", "wave");
    assert.equal(a.steer, null);
    assert.equal(a.animation, "wave");
    // An older detector/planner completion must not overwrite a newer held input.
    mock.timers.setTime(Date.now() + 600);
    let resolveDetection!: () => void;
    let detecting!: () => void;
    const started = new Promise<void>((r) => {
      detecting = r;
    });
    const pending = new Promise<void>((r) => {
      resolveDetection = r;
    });
    w.findObjects = async () => {
      detecting();
      await pending;
      return [
        {
          id: "dog",
          class: "dog",
          attributes: [],
          box: [0.2, 0.2, 0.2, 0.2],
          confidence: 1,
          seenAt: Date.now(),
        },
      ];
    };
    const oldAction = w.action(alice, "sit on the dog", "slow-dog");
    // Attach a rejection handler immediately so a losing instruction cannot become unhandled.
    const rejected = assert.rejects(oldAction, /newer|changed/i);
    await started;
    await w.steer(alice, 1, 0);
    resolveDetection();
    await rejected;
    assert.equal(a.steer!.x, 1);
    w.findObjects = undefined;
    mock.timers.setTime(Date.now() + 600);
    await w.steer(alice, 1, 0);
    w.sceneReset();
    assert.equal(a.steer, null);
    mock.timers.setTime(Date.now() + 600);
    await w.steer(alice, 1, 0);
    w.stop();
    assert.equal(a.steer, null);
    await assert.rejects(w.steer(alice, 1, 0), /paused/);
  } finally {
    mock.timers.reset();
    await s.app.close();
  }
});
