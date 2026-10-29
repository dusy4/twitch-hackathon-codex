import { createLanTestApp, lanCandidates } from "../apps/api/lan-test.js";

let host: string | undefined;
let port = 3400;
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (option === "--host") host = process.argv[++i];
  else if (option === "--port") port = Number(process.argv[++i]);
  else
    throw Error(
      "Usage: npm run lan:test -- [--host 192.168.1.20] [--port 3400]",
    );
}
const candidates = lanCandidates();
host ??= candidates[0];
if (!host)
  throw Error(
    "No private Wi-Fi/Ethernet IPv4 found. Connect to your LAN, then pass --host <laptop-ip>.",
  );
const server = await createLanTestApp(host, port);
try {
  await server.app.listen({ host, port });
} catch (error) {
  await server.app.close();
  throw error;
}
console.log(`RaidRift LAN SIMULATOR: ${server.origin}`);
console.log(`Creator/pairing: ${server.origin}/dashboard`);
console.log(`Viewer controls: ${server.origin}/controller?room=demo-world`);
console.log(`Phone health check: ${server.origin}/health`);
console.log(
  "Two synthetic characters are ready. Data resets on stop; no Twitch/OpenAI credentials or paid calls.",
);
if (candidates.length > 1)
  console.log(
    `Other local addresses: ${candidates.filter((a) => a !== host).join(", ")}. Use --host if needed.`,
  );
if (host === "127.0.0.1")
  console.log("Loopback test only: a phone cannot reach this address.");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void server.app.close().then(() => process.exit(0)));
