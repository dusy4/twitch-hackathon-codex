import { createApp } from "./server.js";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

// Keep the reviewable local app's HTML and hashed assets together while the next build is produced.
const temporaryRoot = resolve(tmpdir());
const prefix = `raidrift-local-${createHash("sha256").update(resolve(".")).digest("hex").slice(0, 12)}-`;
let snapshot: string | undefined;
async function removeSnapshot() {
  if (!snapshot) return;
  const target = resolve(snapshot);
  if (dirname(target) !== temporaryRoot || !basename(target).startsWith(prefix))
    throw Error("Unexpected local asset snapshot path");
  await rm(target, { recursive: true, force: true });
}
let app: Awaited<ReturnType<typeof createApp>>["app"];
try {
  if (
    process.env.NODE_ENV !== "production" &&
    existsSync(resolve("dist/web/index.html"))
  ) {
    snapshot = await mkdtemp(join(temporaryRoot, prefix));
    await cp(resolve("dist/web"), snapshot, { recursive: true });
  }
  ({ app } = await createApp({ webRoot: snapshot }));
  app.addHook("onClose", removeSnapshot);
} catch (error) {
  await removeSnapshot();
  throw error;
}
try {
  await app.listen({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3400),
  });
} catch (error) {
  await app.close();
  throw error;
}
console.log(
  `RaidRift listening at ${process.env.PUBLIC_URL || "http://127.0.0.1:3400"}`,
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => void app.close().then(() => process.exit(0)));
