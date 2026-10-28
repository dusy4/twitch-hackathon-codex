import { test } from "node:test";
import assert from "node:assert/strict";
import { localCompile, validatePlan } from "../apps/api/compiler.js";
import { Database } from "../apps/api/db.js";
import { account } from "../apps/api/economy.js";
import { World } from "../apps/api/world.js";
import {
  defaultConfig,
  type SceneTrack,
  type ActionPlan,
} from "../packages/shared/contracts.js";

test("local choreography chains bounded verbs, relative movement and visible-object pronouns without partial execution", () => {
  const table: SceneTrack = {
    id: "table-1",
    class: "table",
    attributes: [],
    box: [0.2, 0.5, 0.4, 0.2],
    seenAt: Date.now(),
    confidence: 0.9,
  };
  let p = localCompile("wave then jump then dance", [])!;
  assert.deepEqual(
    p.steps.map((s) => s.name),
    ["wave", "jump", "dance"],
  );
  validatePlan(p, []);
  p = localCompile("left then left then right", [], 0.5, 0.7)!;
  assert.ok(Math.abs(p.steps[0].x! - 0.37) < 1e-8);
  assert.ok(Math.abs(p.steps[1].x! - 0.24) < 1e-8);
  assert.ok(Math.abs(p.steps[2].x! - 0.37) < 1e-8);
  p = localCompile("climb the table then dance on it", [table])!;
  assert.equal(p.steps.filter((s) => s.op === "navigate").length, 1);
  assert.ok(p.steps.some((s) => s.name === "dance" && s.target === table.id));
  assert.ok(p.steps.reduce((n, s) => n + s.durationMs, 0) <= 15000);
  validatePlan(p, [table]);
  p = localCompile("climb the table then wave then backflip", [table])!;
  assert.equal(p.steps.at(-1)?.target, table.id);
  assert.throws(
    () => localCompile("wave then sit on it", []),
    /Name a visible target/,
  );
  assert.throws(
    () => localCompile("dance then dance then dance", []),
    /fifteen seconds/,
  );
  assert.throws(() => localCompile("wave then", []), /complete instructions/);
  assert.throws(() => localCompile("wave then control @Bob", []), /invitation/);
  assert.equal(localCompile("wave then unknown unsupported thing", []), null);
  const emote = validatePlan(
    {
      version: 1,
      message: "wave",
      steps: [
        {
          op: "emote",
          name: "wave",
          target: null,
          x: null,
          y: null,
          durationMs: 1000,
        },
      ],
    },
    [],
  );
  assert.equal(emote.steps[0].op, "play_animation");
  assert.throws(
    () =>
      validatePlan(
        { ...emote, steps: [{ ...emote.steps[0], name: "execute code" }] },
        [],
      ),
    /catalog/,
  );
});

test("delayed mocked planning preserves animation time and revalidates current observations, newer intent and creator stop", async () => {
  const db = Database.memory();
  await db.migrate();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY,
    originalPaid = process.env.ALLOW_PAID_AI;
  process.env.OPENAI_API_KEY = "mock-only";
  process.env.ALLOW_PAID_AI = "true";
  try {
    const who = await account(db, "planner-viewer", "Planner");
    await db.query(
      "INSERT INTO channels(id,owner_id,config) VALUES($1,$2,$3)",
      ["planner-world", who.id, JSON.stringify(defaultConfig)],
    );
    const w = new World(db, {
      id: "planner-world",
      config: { ...defaultConfig, ai: true, vision: true },
    });
    const track: SceneTrack = {
      id: "dog-1",
      class: "dog",
      attributes: [],
      box: [0.3, 0.4, 0.2, 0.2],
      seenAt: Date.now() - 1000,
      confidence: 0.9,
    };
    w.updateTracks([track], w.state.epoch);
    let release = () => {},
      called = () => {};
    let arrived = new Promise<void>((r) => {
      called = r;
    });
    let gate = new Promise<void>((r) => {
      release = r;
    });
    let replyAt = 0;
    const plan: ActionPlan = {
      version: 1,
      message: "Mocked choreography",
      steps: [
        {
          op: "attach_to_track",
          name: "sit",
          target: track.id,
          x: null,
          y: null,
          durationMs: 1000,
        },
      ],
    };
    globalThis.fetch = async () => {
      called();
      await gate;
      replyAt = Date.now();
      return new Response(
        JSON.stringify({
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(plan) }] },
          ],
        }),
      );
    };
    const first = w.action(who, "perform a graceful pirouette", "slow-plan");
    await arrived;
    await new Promise((r) => setTimeout(r, 350));
    w.updateTracks([{ ...track, seenAt: Date.now() }], w.state.epoch);
    release();
    await first;
    assert.ok(
      w.running.get(who.id)!.started >= replyAt,
      "Timeline begins after model and database acceptance",
    );
    assert.equal(w.state.avatars[0].animation, "sit");
    plan.steps = [
      {
        op: "play_animation",
        name: "wave",
        target: null,
        x: null,
        y: null,
        durationMs: 1000,
      },
    ];
    w.cooldowns.delete(who.id);
    arrived = new Promise<void>((r) => {
      called = r;
    });
    gate = new Promise<void>((r) => {
      release = r;
    });
    const stopped = w.action(
      who,
      "perform another graceful pirouette",
      "stopped-plan",
    );
    await arrived;
    w.stop();
    w.state.config.paused = false;
    release();
    await assert.rejects(stopped, /changed while planning/);
    assert.equal(w.running.size, 0);
    w.cooldowns.delete(who.id);
    arrived = new Promise<void>((r) => {
      called = r;
    });
    gate = new Promise<void>((r) => {
      release = r;
    });
    const superseded = w.action(who, "perform another pirouette", "older-plan");
    await arrived;
    await new Promise((r) => setTimeout(r, 510));
    const newer = await w.action(who, "jump", "newer-plan");
    release();
    await assert.rejects(superseded, /changed while planning/);
    assert.equal(w.running.get(who.id)?.id, newer.id);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalPaid === undefined) delete process.env.ALLOW_PAID_AI;
    else process.env.ALLOW_PAID_AI = originalPaid;
    await db.close();
  }
});
