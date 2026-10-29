import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { z } from "zod";

// Disposable, loopback-only native QA. No productive accounts, files, provider keys or database.
process.env.TWITCH_CLIENT_ID = "";
process.env.TWITCH_CLIENT_SECRET = "";
process.env.OPENAI_API_KEY = "";
process.env.ALLOW_PAID_AI = "false";
const origin = "http://127.0.0.1:3403";
const security = new Security(randomBytes(32));
const s = await createApp({
  db: Database.memory(),
  security,
  demo: true,
  origin,
});
const world = await s.world("demo-world");
world.state.config.paused = false;
world.state.config.public = false;
world.state.config.ai = false;
await s.db.query("UPDATE channels SET config=$2 WHERE id=$1", [
  world.state.roomId,
  JSON.stringify(world.state.config),
]);
const players = {
  one: await account(s.db, "native-qa-one", "Juniper", true),
  two: await account(s.db, "native-qa-two", "Moss", true),
};
await world.join(players.one);
await world.join(players.two);
const version = (
  await s.db.query("SELECT token_version FROM channels WHERE id=$1", [
    world.state.roomId,
  ])
).rows[0].token_version;
const scope = {
  room: world.state.roomId,
  version,
  exp: Date.now() + 3_600_000,
};
await mkdir(".data", { recursive: true });
await writeFile(
  ".data/boat-android-pairing.json",
  JSON.stringify({
    server: origin,
    token: security.sign({ ...scope, role: "capture" }),
    receiverUrl: `${origin}/receiver#token=${security.sign({ ...scope, role: "overlay" })}`,
    mode: "SIMULATOR",
    purpose: "Disposable native emulator QA only",
  }),
);
const eventsPath = ".data/boat-android-world-events.jsonl";
await writeFile(
  eventsPath,
  JSON.stringify({
    type: "started",
    mode: "SIMULATOR",
    actors: Object.values(players).map((p) => ({ id: p.id, name: p.name })),
  }) + "\n",
);
s.app.post("/__qa/action", async (request) => {
  const input = z
    .object({
      actor: z.enum(["one", "two"]),
      prompt: z.string().min(1).max(500),
    })
    .strict()
    .parse(request.body);
  const result = await world.action(
    players[input.actor],
    input.prompt,
    randomUUID(),
  );
  await appendFile(
    eventsPath,
    JSON.stringify({
      at: Date.now(),
      type: "action",
      actor: players[input.actor].id,
      prompt: input.prompt,
      result,
    }) + "\n",
  );
  return result;
});
s.app.post("/__qa/pause", async () => {
  world.stop();
  return { paused: world.state.config.paused };
});
s.app.post("/__qa/revoke", async () => {
  await s.db.query(
    "UPDATE channels SET token_version=token_version+1 WHERE id=$1",
    [world.state.roomId],
  );
  return { revoked: true };
});
await s.app.listen({ host: "127.0.0.1", port: 3403 });
console.log(
  "Disposable native QA world listening on loopback port 3403. Pairing is in an ignored local file; no provider credentials are used.",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void s.app.close().then(() => process.exit(0));
  });
