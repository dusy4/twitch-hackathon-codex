/** Isolated loopback-only EBS fixture. No Twitch credentials, no production server restart. */
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
const s = await createApp({
  db: Database.memory(),
  security: new Security(Buffer.alloc(32, 81)),
  demo: true,
  origin: "http://127.0.0.1:3499",
  debugRoom: "demo-world",
  debugTools: true,
  extensionOwnerId: "555",
  extensionClientId: "testclient",
  extensionSecret: Buffer.alloc(32, 37).toString("base64"),
});
const w = await s.world("demo-world");
w.state.config.vision = true;
const tracks = setInterval(
  () =>
    w.updateTracks(
      [
        {
          id: "qa-sofa",
          class: "spot 3",
          attributes: ["sofa"],
          box: [0.6, 0.3, 0.2, 0.2],
          confidence: 1,
          seenAt: Date.now(),
        },
      ],
      w.state.epoch,
    ),
  500,
);
await s.app.listen({ host: "127.0.0.1", port: 3499 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(tracks);
    void s.app.close().then(() => process.exit(0));
  });
