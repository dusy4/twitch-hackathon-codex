import { createHash } from "node:crypto";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { rotateEncryptedTokens } from "../apps/api/key-rotation.js";

const flags = process.argv.slice(2);
if (flags.some((flag) => !["--apply", "--offline"].includes(flag)))
  throw Error(
    "Supported flags: --apply --offline. Without --apply this performs a dry run.",
  );
const apply = flags.includes("--apply");
if (apply && !flags.includes("--offline"))
  throw Error(
    "Stop every app/worker process first, then acknowledge offline maintenance with --apply --offline. This tool cannot verify remote process shutdown.",
  );
const { DATABASE_URL, OLD_APP_SECRET, NEW_APP_SECRET, REWARD_IDENTITY_SECRET } =
  process.env;
if (
  !DATABASE_URL ||
  !OLD_APP_SECRET ||
  !NEW_APP_SECRET ||
  !REWARD_IDENTITY_SECRET ||
  [OLD_APP_SECRET, NEW_APP_SECRET, REWARD_IDENTITY_SECRET].some(
    (key) => key.length < 43,
  )
)
  throw Error(
    "Set DATABASE_URL, OLD_APP_SECRET, NEW_APP_SECRET and the unchanged REWARD_IDENTITY_SECRET through the secret manager; keys must have at least 43 characters.",
  );
if (OLD_APP_SECRET === NEW_APP_SECRET)
  throw Error("The encryption keys must differ.");
const security = (raw: string) =>
  new Security(createHash("sha256").update(raw).digest());
const db = await Database.open(DATABASE_URL);
try {
  // The app schema must already be upgraded and backed up. No bootstrap or provider calls here.
  const result = await rotateEncryptedTokens(
    db,
    security(OLD_APP_SECRET),
    security(NEW_APP_SECRET),
    apply,
    process.env.KEY_ROTATION_OPERATOR || "maintenance-cli",
  );
  console.log(JSON.stringify(result, null, 2));
} catch {
  process.exitCode = 1;
  console.error(
    "Key rotation failed. The transaction rolled back; verify the original key, ciphertext integrity and database access before retrying.",
  );
} finally {
  await db.close();
}
