import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { compileAI, localCompile } from "../apps/api/compiler.js";
import { mentions, targetNouns } from "../apps/api/targets.js";
import {
  TAILNET_ROOM,
  createTailnetTestApp,
} from "../apps/api/tailnet-test.js";
import type { SceneTrack } from "../packages/shared/contracts.js";

const track = (id: string, cls: string, confidence = 0.8): SceneTrack => ({
  id,
  class: cls,
  attributes: [],
  box: [0.4, 0.5, 0.2, 0.3],
  confidence,
  seenAt: Date.now(),
});
const JPEG = readFileSync(
  new URL("../services/ov-detector/warmup.jpg", import.meta.url),
).toString("base64");

/** Tiny stand-in for services/ov-detector: finds "wooden crate" and "box". */
async function fakeSidecar() {
  const calls: { classes: string[]; image: string }[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify({ ok: true, device: "cuda", dtype: "fp16", model: "x" }),
      );
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      calls.push(body);
      const known: Record<string, [number, number, number, number]> = {
        "wooden crate": [0.27, 0.64, 0.33, 0.12],
        box: [0.28, 0.75, 0.3, 0.25],
      };
      const detections = (body.classes as string[])
        .filter((c) => known[c])
        .map((c) => ({ label: c, score: 0.52, box: known[c] }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ms: 120, detections }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, close: () => new Promise((r) => server.close(r)) };
}

async function setup(ovDetectorUrl: string) {
  delete process.env.OPENCODE_GO_API_KEY;
  const server = await createTailnetTestApp({
    host: "127.0.0.1",
    port: 3499,
    origin: "https://raidrift-pc.example.ts.net",
    timers: false,
    debugChatStaggerMs: 0,
    ovDetectorUrl,
  });
  const pair = (await server.app.inject({ url: "/v1/debug/pair" })).json();
  const headers = { authorization: `Bearer ${pair.token}` };
  const post = (url: string, payload: Record<string, unknown>) =>
    server.app.inject({ method: "POST", url, headers, payload });
  const state = async () =>
    (
      await server.app.inject({ url: "/v1/native/debug/state", headers })
    ).json();
  return { server, post, state };
}

test("target words: multi-word classes, synonyms, plurals and object nouns", () => {
  assert.deepEqual(targetNouns("sit on the wooden crate"), ["wooden crate"]);
  assert.deepEqual(targetNouns("!rift hide behind the boxes"), ["box"]);
  assert.deepEqual(targetNouns("run to the dog and sit on it"), ["dog"]);
  assert.deepEqual(targetNouns("dance to the music"), []);
  assert.ok(mentions("potted plant", "hide behind the plant"));
  assert.ok(mentions("couch", "go chill on the sofa"));
  assert.ok(mentions("box", "hide behind the boxes"));
  assert.ok(mentions("dining table", "climb the table"));
  assert.ok(!mentions("chair", "jump on the chairlift"));
});

test("keyword planner: 'jump on the chair' jumps onto it; 'the plant' finds a potted plant", () => {
  const jump = localCompile("jump on the chair", [
    track("ph-chair-2", "chair"),
  ])!;
  assert.deepEqual(
    jump.steps.map((s) => s.op),
    ["navigate", "jump_to_surface", "play_animation", "attach_to_track"],
  );
  assert.ok(jump.steps.every((s) => s.name !== "point"));
  assert.ok(jump.steps.every((s) => s.target === "ph-chair-2"));
  const plant = localCompile("sit on the plant", [
    track("ph-plant-4", "potted plant", 0.7),
  ])!;
  assert.equal(plant.steps[0].target, "ph-plant-4");
  assert.ok(plant.steps.some((s) => s.name === "sit"));
  // Unknown verbs go to the model; named but missing objects are friendly errors.
  assert.equal(
    localCompile("hide behind the plant", [track("p", "potted plant")]),
    null,
  );
  assert.throws(
    () => localCompile("sit on the pillow", []),
    /Couldn't find a pillow/,
  );
  // A server (open-vocabulary) track counts even with a modest detector score.
  const crate = localCompile("sit on the wooden crate", [
    { ...track("ov-1", "wooden crate", 0.41), source: "server" },
  ])!;
  assert.equal(crate.steps[0].target, "ov-1");
});

const OPENCODE = {
  ALLOW_PAID_AI: "true",
  AI_PROVIDER: "opencode",
  OPENCODE_GO_API_KEY: "sk-test-not-real",
};
const modelSays = (target: string) =>
  (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                version: 1,
                message: "Sneaking!",
                steps: [
                  { op: "navigate", name: "sprint", target, durationMs: 1700 },
                  {
                    op: "play_animation",
                    name: "surprised",
                    target,
                    durationMs: 2000,
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

test("AI planner targets bind by class word ('potted plant' bug) or via the detector ('?pillow')", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, OPENCODE);
  try {
    const tracks = [track("ph-plant-4", "potted plant", 0.7)];
    for (const target of ["potted plant", "plant", "ph-potted-plant-4"]) {
      const plan = await compileAI(
        "hide behind the plant",
        tracks,
        modelSays(target),
      );
      assert.equal(plan.steps[0].target, "ph-plant-4", target);
    }
    const asked: string[][] = [];
    const pillow = {
      ...track("ov-9", "pillow", 0.4),
      source: "server" as const,
    };
    const plan = await compileAI(
      "hide behind the pillow",
      tracks,
      modelSays("?pillows"),
      async (nouns) => (asked.push(nouns), [pillow]),
    );
    assert.deepEqual(asked, [["pillow"]]);
    assert.equal(plan.steps[1].target, "ov-9");
    await assert.rejects(
      compileAI(
        "hide behind the lamp",
        tracks,
        modelSays("?lamp"),
        async () => [],
      ),
      /Couldn't find a lamp/,
    );
    await assert.rejects(
      compileAI("x", tracks, modelSays("ghost-track")),
      (e: any) => e.code === "STALE_TARGET",
    );
  } finally {
    for (const k of Object.keys(OPENCODE))
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
});

test("phone frame + server detector: chat targets an ov-* track the phone can re-post", async () => {
  const sidecar = await fakeSidecar();
  const { server, post, state } = await setup(sidecar.url);
  try {
    const w = await server.world(TAILNET_ROOM);
    // No frame yet: friendly refusal, the sidecar is not asked.
    const early = await post("/v1/native/chat", {
      name: "Early",
      text: "sit on the wooden crate",
    });
    assert.equal(early.json().code, "TARGET_NOT_VISIBLE", early.body);
    assert.match(early.json().message, /Couldn't find a wooden crate/);
    assert.equal(sidecar.calls.length, 0);
    // Frame validation.
    assert.equal(
      (
        await post("/v1/native/frame", {
          frameId: "f0",
          jpeg: "not base64!",
          width: 640,
          height: 360,
        })
      ).statusCode,
      400,
    );
    const frame = await post("/v1/native/frame", {
      frameId: "frame-17",
      jpeg: JPEG,
      width: 640,
      height: 360,
    });
    assert.deepEqual(frame.json(), { ok: true });
    const chat = await post("/v1/native/chat", {
      name: "Viewer1",
      text: "sit on the wooden crate",
    });
    assert.equal(chat.json().ok, true, chat.body);
    assert.equal(chat.json().source, "keywords");
    assert.match(chat.json().plan, /wooden crate#ov-1/);
    assert.deepEqual(sidecar.calls[0].classes, ["wooden crate"]);
    assert.equal(sidecar.calls[0].image, JPEG);
    const crate = w.state.tracks.find((t) => t.id === "ov-1")!;
    assert.equal(crate.source, "server");
    assert.equal(crate.frameId, "frame-17");
    assert.deepEqual(crate.box, [0.27, 0.64, 0.33, 0.12]);
    const viewer = w.state.avatars.find((a) => a.name === "Viewer1")!;
    assert.equal(viewer.target, "ov-1");
    // The phone re-posts the anchored server track: same id, kept as server.
    const repost = await post("/v1/native/tracks", {
      tracks: [{ ...crate, box: [0.3, 0.6, 0.3, 0.12], seenAt: 1 }],
    });
    assert.equal(repost.statusCode, 200, repost.body);
    const kept = w.state.tracks.filter((t) => t.id === "ov-1");
    assert.equal(kept.length, 1);
    assert.equal(kept[0].source, "server");
    assert.equal(kept[0].frameId, "frame-17");
    // Already visible: no second detector call.
    await post("/v1/native/chat", {
      name: "Viewer2",
      text: "dance on the crate",
    });
    assert.equal(sidecar.calls.length, 1);
    // Plural + nothing found.
    const none = await post("/v1/native/chat", {
      name: "Viewer3",
      text: "sit on the pillow",
    });
    assert.equal(none.json().code, "TARGET_NOT_VISIBLE");
    assert.match(none.json().message, /Couldn't find a pillow/);
    assert.deepEqual(sidecar.calls[1].classes, ["pillow"]);
    const s = await state();
    assert.equal(s.ov.up, true);
    assert.equal(s.ov.device, "cuda");
    assert.deepEqual(s.ov.lastQuery, ["pillow"]);
    assert.equal(s.ov.lastHits, 0);
    assert.equal(typeof s.ov.lastMs, "number");
    assert.equal(s.frame.id, "frame-17");
    assert.ok(s.frame.bytes > 10000 && s.frame.ageMs < 5000);
    assert.ok(
      s.tracks.some((t: any) => t.id === "ov-1" && t.source === "server"),
    );
  } finally {
    await server.app.close();
    await sidecar.close();
  }
});

test("sidecar down -> TARGET_NOT_VISIBLE and ov.up false; any-noun quests verify from world tracks", async () => {
  const sidecar = await fakeSidecar();
  const url = sidecar.url;
  await sidecar.close(); // nothing listens there now
  const { server, post, state } = await setup(url);
  try {
    const w = await server.world(TAILNET_ROOM);
    await post("/v1/native/frame", {
      frameId: "f1",
      jpeg: JPEG,
      width: 640,
      height: 360,
    });
    const down = await post("/v1/native/chat", {
      name: "A",
      text: "sit on the wooden crate",
    });
    assert.equal(down.json().code, "TARGET_NOT_VISIBLE", down.body);
    const s = await state();
    assert.equal(s.ov.up, false);
    assert.ok(s.ov.lastError);
    // Quest on any short noun (trimmed, lowercased).
    const bad = await post("/v1/native/debug/event", {
      type: "quest",
      targetClass: "x".repeat(41),
    });
    assert.equal(bad.statusCode, 400);
    const quest = await post("/v1/native/debug/event", {
      type: "quest",
      action: "sit",
      targetClass: "  Plant ",
      minPlayers: 1,
      reward: 10,
    });
    assert.equal(quest.json().ok, true, quest.body);
    const q = w.state.quests.find((x) => x.targetClass === "plant");
    assert.ok(q, "quest stored lowercased");
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      const plant = { ...track("ph-plant-4", "potted plant", 0.7) };
      await post("/v1/native/tracks", { tracks: [plant] });
      const sit = await post("/v1/native/chat", {
        name: "Sitter",
        text: "sit on the plant",
      });
      assert.equal(sit.json().ok, true, sit.body);
      for (let i = 0; i < 60 && !q!.completed; i++) {
        mock.timers.tick(250);
        if (i % 2 === 0) await post("/v1/native/tracks", { tracks: [plant] });
        w.tick(Date.now());
        await w.evaluateQuests(Date.now());
      }
      assert.ok(
        q!.completed,
        "sitting on a 'potted plant' completes a 'plant' quest",
      );
    } finally {
      mock.timers.reset();
    }
  } finally {
    await server.app.close();
  }
});
