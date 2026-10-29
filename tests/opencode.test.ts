import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameError,
  OPENCODE_URL,
  aiProvider,
  compileAI,
  extractJson,
  summarizePlan,
} from "../apps/api/compiler.js";
import type { SceneTrack } from "../packages/shared/contracts.js";

const tracks = (): SceneTrack[] => [
  {
    id: "phone-dog-7",
    class: "dog",
    attributes: ["brown"],
    box: [0.4, 0.5, 0.2, 0.3],
    confidence: 0.82,
    seenAt: Date.now(),
  },
];
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T) {
  const saved = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env))
    if (v === undefined) delete process.env[k];
  const restore = () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  };
  try {
    const result = fn();
    if (result instanceof Promise)
      return result.finally(restore) as unknown as T;
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
const OPENCODE = {
  ALLOW_PAID_AI: "true",
  AI_PROVIDER: "opencode",
  OPENCODE_GO_API_KEY: "sk-test-not-real",
  OPENCODE_MODEL: undefined,
};
const reply = (content: string, status = 200) =>
  new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );

test("provider selection honours ALLOW_PAID_AI and AI_PROVIDER", () => {
  assert.equal(aiProvider({}), null);
  assert.equal(
    aiProvider({ ALLOW_PAID_AI: "true", AI_PROVIDER: "opencode" }),
    null,
  );
  assert.deepEqual(
    aiProvider({ ...OPENCODE, OPENCODE_MODEL: undefined } as any),
    { provider: "opencode", model: "deepseek-v4.1-flash" },
  );
  assert.deepEqual(aiProvider({ ALLOW_PAID_AI: "true", OPENAI_API_KEY: "x" }), {
    provider: "openai",
    model: "gpt-6-luna",
  });
  assert.equal(
    aiProvider({ ALLOW_PAID_AI: "false", OPENCODE_GO_API_KEY: "x" }),
    null,
  );
});

test("OpenCode Go request shape and fenced JSON plan are validated", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return reply(
      '```json\n{"message":"On my way!","steps":[{"op":"navigate","name":"run","target":"phone-dog-7","durationMs":1700},{"op":"play_animation","name":"sit","target":"phone-dog-7","x":null,"y":null,"durationMs":3000},{"op":"attach_to_track","name":"sit","target":"phone-dog-7","x":null,"y":null,"durationMs":5000}]}\n```',
    );
  }) as unknown as typeof fetch;
  const plan = await withEnv(OPENCODE, () =>
    compileAI("go hang with the pupper", tracks(), fetcher),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, OPENCODE_URL);
  const headers = seen[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test-not-real");
  assert.match(headers["x-opencode-session"], /^[0-9a-f-]{36}$/);
  const sent = JSON.parse(String(seen[0].init.body));
  assert.equal(sent.model, "deepseek-v4.1-flash");
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.equal(sent.messages[0].role, "system");
  assert.match(sent.messages[0].content, /phone-dog-7/);
  assert.match(sent.messages[0].content, /backflip/);
  assert.match(sent.messages[1].content, /pupper/);
  assert.equal(plan.version, 1);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].x, null);
  assert.equal(
    summarizePlan(plan, tracks()),
    "navigate run → dog#phone-dog-7 · sit → dog#phone-dog-7 · attach sit → dog#phone-dog-7",
  );
  // The session id is stable for the process.
  await withEnv(OPENCODE, () => compileAI("again", tracks(), fetcher));
  assert.equal(
    (seen[1].init.headers as Record<string, string>)["x-opencode-session"],
    headers["x-opencode-session"],
  );
});

test("OpenCode Go failures become friendly game errors", async () => {
  const cases: [Response | Error, string][] = [
    [reply("", 401), "AI_UNAVAILABLE"],
    [reply("I cannot do that."), "AI_REFUSAL"],
    [
      reply(
        '{"version":1,"message":"x","steps":[{"op":"navigate","name":"run","target":"ghost-track","x":null,"y":null,"durationMs":1000}]}',
      ),
      "STALE_TARGET",
    ],
    [
      reply(
        '{"version":1,"message":"x","steps":[{"op":"teleport","name":null,"target":null,"x":null,"y":null,"durationMs":1000}]}',
      ),
      "AI_INVALID_PLAN",
    ],
    [Object.assign(new Error("t"), { name: "TimeoutError" }), "AI_UNAVAILABLE"],
  ];
  for (const [result, code] of cases) {
    const fetcher = (async () => {
      if (result instanceof Error) throw result;
      return result;
    }) as unknown as typeof fetch;
    await assert.rejects(
      withEnv(OPENCODE, () => compileAI("do a thing", tracks(), fetcher)),
      (e: unknown) => e instanceof GameError && e.code === code,
      code,
    );
  }
  await assert.rejects(
    withEnv({ ALLOW_PAID_AI: "false" }, () =>
      compileAI("x", tracks(), (async () => reply("{}")) as any),
    ),
    (e: unknown) => e instanceof GameError && e.code === "AI_UNAVAILABLE",
  );
});

test("extractJson tolerates chatter around the object", () => {
  assert.deepEqual(extractJson('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.throws(() => extractJson("no json"), GameError);
});
