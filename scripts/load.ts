import { monitorEventLoopDelay } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { WebSocket } from "ws";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
const count = Number(process.argv[2] || 1000);
const s = await createApp({
  db: Database.memory(),
  security: new Security(Buffer.alloc(32, 4)),
  demo: true,
  origin: "http://127.0.0.1:0",
});
const connections: WebSocket[] = [];
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let snapshots = 0;
const started = performance.now();
let errors = 0;
try {
  await s.app.listen({ host: "127.0.0.1", port: 0 });
  const address = s.app.server.address() as any;
  for (let offset = 0; offset < count; offset += 50) {
    await Promise.all(
      Array.from(
        { length: Math.min(50, count - offset) },
        () =>
          new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(
              `ws://127.0.0.1:${address.port}/v1/socket?room=demo-world`,
            );
            connections.push(ws);
            ws.once("open", () => resolve());
            ws.on("message", () => snapshots++);
            ws.once("error", (error) => {
              errors++;
              reject(error);
            });
          }),
      ),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const report = {
    runAt: new Date().toISOString(),
    kind: "Local synthetic WebSocket spectators, no real Twitch viewers",
    connections: count,
    connected: s.metrics.sockets,
    errors,
    snapshots,
    durationMs: performance.now() - started,
    eventLoopP95Ms: delay.percentile(95) / 1e6,
    eventLoopP99Ms: delay.percentile(99) / 1e6,
    rssMiB: process.memoryUsage().rss / 1048576,
    activeAvatars: (await s.world("demo-world")).state.avatars.length,
    limitation:
      "Does not establish 1000 active avatar simulation, multi-instance throughput or internet performance",
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/load.json", JSON.stringify(report, null, 2));
  console.log(report);
  if (errors || s.metrics.sockets !== count) throw Error("Load smoke failed");
} finally {
  delay.disable();
  for (const ws of connections) ws.terminate();
  await s.app.close();
}
