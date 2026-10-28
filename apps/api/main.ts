import { createApp } from "./server.js";
const { app } = await createApp();
await app.listen({
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3400),
});
console.log(
  `RaidRift listening at ${process.env.PUBLIC_URL || "http://127.0.0.1:3400"}`,
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => void app.close().then(() => process.exit(0)));
