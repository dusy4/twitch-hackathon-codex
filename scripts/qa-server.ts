import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";

const temporaryRoot = resolve(tmpdir());
const prefix = `raidrift-qa-${createHash("sha256").update(resolve(".")).digest("hex").slice(0, 12)}-`;
const snapshot = await mkdtemp(join(temporaryRoot, prefix));
async function removeSnapshot() {
  const target = resolve(snapshot);
  if (dirname(target) !== temporaryRoot || !basename(target).startsWith(prefix))
    throw Error("Refusing to remove an unexpected QA snapshot path");
  await rm(target, { recursive: true, force: true });
}
try {
  await cp(resolve("dist/web"), snapshot, { recursive: true });
  const { app } = await createApp({
    db: Database.memory(),
    security: new Security(Buffer.alloc(32, 21)),
    demo: true,
    origin: "http://127.0.0.1:3401",
    webRoot: snapshot,
  });
  app.addHook("onClose", removeSnapshot);
  await app.listen({ host: "127.0.0.1", port: 3401 });
  let closing = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  await removeSnapshot();
  throw error;
}
