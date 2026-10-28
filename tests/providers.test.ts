import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { Twitch } from "../apps/api/twitch.js";
import { account } from "../apps/api/economy.js";
import { defaultConfig } from "../packages/shared/contracts.js";
import { World } from "../apps/api/world.js";
import { verifyEvidence } from "../apps/api/vision.js";
import { compileAI } from "../apps/api/compiler.js";
test("OAuth refresh rotates encrypted credentials and validates stable identity with mocked Twitch", async () => {
  const db = Database.memory();
  await db.migrate();
  const key = new Security(Buffer.alloc(32, 9));
  const old = {
    id: process.env.TWITCH_CLIENT_ID,
    secret: process.env.TWITCH_CLIENT_SECRET,
  };
  process.env.TWITCH_CLIENT_ID = "client";
  process.env.TWITCH_CLIENT_SECRET = "server-secret";
  const requests: any[] = [];
  const fake: typeof fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/validate")
          ? { client_id: "client", user_id: "123", login: "Alice" }
          : {
              access_token: "rotated",
              refresh_token: "rotated-refresh",
              expires_in: 3600,
            },
      ),
      { status: 200 },
    );
  };
  try {
    const who = await account(db, "123", "Alice");
    const tokens = key.seal({
      access_token: "expired",
      refresh_token: "refresh-me",
      expiresAt: 1,
    });
    await db.query(
      "INSERT INTO channels(id,owner_id,config,tokens) VALUES($1,$2,$3,$4)",
      ["123", who.id, JSON.stringify(defaultConfig), tokens],
    );
    const twitch = new Twitch(db, key, fake);
    assert.equal(await twitch.access({ id: "123", tokens }), "rotated");
    const stored = (await db.query("SELECT tokens FROM channels")).rows[0]
      .tokens;
    assert.equal(key.open(stored).refresh_token, "rotated-refresh");
    assert.equal(
      String(requests[0].init.body).includes("grant_type=refresh_token"),
      true,
    );
    assert.equal((await twitch.user("rotated")).user_id, "123");
  } finally {
    await db.close();
    if (old.id === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = old.id;
    if (old.secret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = old.secret;
  }
});
test("mocked Decisions uses distinct current frames and never directly mints; model timeout releases budget", async () => {
  const db = Database.memory();
  await db.migrate();
  const world = new World(db, {
    id: "test",
    config: { ...defaultConfig, vision: true },
  });
  world.state.quests = [
    {
      id: "q",
      title: "Dog",
      type: "camera",
      action: "sit",
      targetClass: "dog",
      minPlayers: 1,
      sustainMs: 1000,
      reward: 40,
      progress: 0,
      completed: false,
    },
  ];
  const old = [process.env.OPENAI_API_KEY, process.env.ALLOW_PAID_AI];
  process.env.OPENAI_API_KEY = "test-key";
  process.env.ALLOW_PAID_AI = "true";
  try {
    let request: any;
    const fake: typeof fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: [{ name: "visible", type: "predicate", probability: 0.97 }],
        }),
      );
    };
    const now = Date.now();
    const frame = "data:image/jpeg;base64,YWJj";
    const first = await verifyEvidence(
      world,
      { questId: "q", frame, timestamp: now - 800, epoch: world.state.epoch },
      fake,
    );
    assert.equal(first.positiveFrames, 1);
    assert.equal(request.model, "gpt-6-luna");
    assert.equal(request.questions[0].type, "predicate");
    await assert.rejects(
      verifyEvidence(
        world,
        { questId: "q", frame, timestamp: now, epoch: world.state.epoch },
        fake,
      ),
      /distinct frames/,
    );
    const second = await verifyEvidence(
      world,
      {
        questId: "q",
        frame: "data:image/jpeg;base64,ZGVm",
        timestamp: now,
        epoch: world.state.epoch,
      },
      fake,
    );
    assert.equal(second.positiveFrames, 2);
    assert.equal((await db.query("SELECT * FROM ledger")).rows.length, 0);
    await assert.rejects(
      verifyEvidence(
        world,
        {
          questId: "q",
          frame: "data:image/jpeg;base64,Z2hp",
          timestamp: now - 2000,
          epoch: world.state.epoch,
        },
        async () => {
          throw Error("timeout");
        },
      ),
      /timeout/,
    );
    assert.equal(world.aiInFlight, 0);
    world.state.config.vision = false;
    await assert.rejects(
      verifyEvidence(
        world,
        { questId: "q", frame, timestamp: now, epoch: world.state.epoch },
        fake,
      ),
      /disabled/,
    );
  } finally {
    await db.close();
    for (const [i, name] of ["OPENAI_API_KEY", "ALLOW_PAID_AI"].entries()) {
      if (old[i] === undefined) delete process.env[name];
      else process.env[name] = old[i];
    }
  }
});
test("Responses strict output is validated, unknown executable operations cannot reach engine", async () => {
  const old = [process.env.OPENAI_API_KEY, process.env.ALLOW_PAID_AI];
  process.env.OPENAI_API_KEY = "test-key";
  process.env.ALLOW_PAID_AI = "true";
  try {
    const fake: typeof fetch = async (_url, init) => {
      const r = JSON.parse(String(init?.body));
      assert.equal(r.text.format.strict, true);
      assert.equal(r.store, false);
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    version: 1,
                    steps: [
                      {
                        op: "execute_js",
                        name: "eval",
                        target: null,
                        x: null,
                        y: null,
                        durationMs: 100,
                      },
                    ],
                    message: "owned",
                  }),
                },
              ],
            },
          ],
        }),
      );
    };
    await assert.rejects(compileAI("unknown", [], fake));
  } finally {
    for (const [i, name] of ["OPENAI_API_KEY", "ALLOW_PAID_AI"].entries()) {
      if (old[i] === undefined) delete process.env[name];
      else process.env[name] = old[i];
    }
  }
});
