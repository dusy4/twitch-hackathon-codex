import {
  TAILNET_ROOM,
  createTailnetTestApp,
  readEnvValue,
} from "../apps/api/tailnet-test.js";

let host = "127.0.0.1";
let port = 3400;
let origin: string | undefined;
let relayUrl: string | undefined;
let envFile: string | undefined;
const usage =
  "Usage: npm run tailnet:test -- --origin https://pc.tailXXXX.ts.net [--port 3400] [--host 127.0.0.1|100.x.y.z] [--relay rtmp://host:1935/live/raidrift] [--env-file path/.env]";
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (option === "--host") host = process.argv[++i];
  else if (option === "--port") port = Number(process.argv[++i]);
  else if (option === "--origin") origin = process.argv[++i];
  else if (option === "--relay") relayUrl = process.argv[++i];
  else if (option === "--env-file") envFile = process.argv[++i];
  else throw Error(usage);
}
origin ??= `http://${host}:${port}`;
if (envFile && !process.env.OPENCODE_GO_API_KEY)
  process.env.OPENCODE_GO_API_KEY = readEnvValue(
    envFile,
    "OPENCODE_GO_API_KEY",
  );
if (envFile && !process.env.GROQ_API_KEY)
  process.env.GROQ_API_KEY = readEnvValue(envFile, "GROQ_API_KEY");
if (envFile)
  for (const key of ["EXT_CLIENT_ID", "EXT_SECRET", "EXT_OWNER_ID", "APK_DIR"]) {
    if (!process.env[key]) process.env[key] = readEnvValue(envFile, key);
  }
relayUrl ??= `rtmp://${new URL(origin).hostname}:1935/live/raidrift`;
const server = await createTailnetTestApp({ host, port, origin, relayUrl });
try {
  await server.app.listen({ host, port });
} catch (error) {
  await server.app.close();
  throw error;
}
const ai =
  process.env.ALLOW_PAID_AI !== "true"
    ? "OFF (set GROQ_API_KEY / OPENCODE_GO_API_KEY or pass --env-file)"
    : process.env.AI_PROVIDER === "compat"
      ? `LLM-first small planner (${process.env.PLANNER_MODEL || "openai/gpt-oss-20b"} @ ${process.env.PLANNER_BASE_URL || "Groq"})`
      : `OpenCode Go (${process.env.OPENCODE_MODEL || "deepseek-v4.1-flash"})`;
console.log(`RaidRift TAILNET SIMULATOR listening on http://${host}:${port}`);
console.log(`Public origin:   ${server.origin}`);
console.log(`Dashboard:       ${server.origin}/dashboard (Simulator -> host)`);
console.log(
  `Viewer controls: ${server.origin}/controller?room=${TAILNET_ROOM}`,
);
console.log(`Health:          ${server.origin}/health`);
console.log(
  `Pair the phone:  open ${server.origin}/v1/debug/pair (or tap "Pair" in the app with server ${server.origin})`,
);
console.log(`Relay hint:      ${relayUrl}`);
console.log(`AI planner:      ${ai}`);
console.log(
  `Room ${TAILNET_ROOM}: SIMULATOR, connected, vision on, quest "Sit with the dog" (2 players, 50 shards), 2 demo characters.`,
);
console.log("DEBUG_TOOLS on. Data is in memory and resets on stop.");
// The in-memory rehearsal world is lost on exit, so a stray rejection is logged
// instead of killing the process mid-stream.
process.on("unhandledRejection", (reason) =>
  console.error(
    `${new Date().toISOString()} unhandled rejection:`,
    reason instanceof Error ? reason.message : reason,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void server.app.close().then(() => process.exit(0)));
