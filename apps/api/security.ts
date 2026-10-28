import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { GameError } from "./compiler.js";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export class Security {
  constructor(private key: Buffer) {}
  static async load() {
    let key = process.env.APP_SECRET;
    if (process.env.NODE_ENV === "production" && (!key || key.length < 43))
      throw Error(
        "Production requires a random APP_SECRET of at least 43 characters",
      );
    if (!key) {
      await mkdir(".data", { recursive: true });
      try {
        key = await readFile(".data/app-secret", "utf8");
      } catch {
        key = secret();
        await writeFile(".data/app-secret", key, { mode: 0o600 });
      }
    }
    return new Security(createHash("sha256").update(key).digest());
  }
  seal(data: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify(data), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
      "base64url",
    );
  }
  open<T = any>(encoded: string): T {
    const b = Buffer.from(encoded, "base64url"),
      cipher = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    cipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(),
    );
  }
  sign(payload: unknown) {
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${data}.${createHmac("sha256", this.key).update(data).digest("base64url")}`;
  }
  verify(token: string) {
    const [data, sig] = token.split(".");
    if (!data || !sig)
      throw new GameError("BAD_TOKEN", "Invalid overlay token", 401);
    const expected = createHmac("sha256", this.key).update(data).digest();
    const actual = Buffer.from(sig, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new GameError("BAD_TOKEN", "Invalid overlay token", 401);
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!p.exp || p.exp < Date.now())
      throw new GameError("TOKEN_EXPIRED", "Refresh the overlay link", 401);
    return p;
  }
}
export function verifyWebhook(
  headers: Record<string, any>,
  body: string,
  webhookSecret: string,
  now = Date.now(),
) {
  const id = headers["twitch-eventsub-message-id"],
    timestamp = headers["twitch-eventsub-message-timestamp"],
    sig = headers["twitch-eventsub-message-signature"];
  if (
    typeof id !== "string" ||
    id.length > 200 ||
    typeof timestamp !== "string" ||
    typeof sig !== "string" ||
    !webhookSecret
  )
    throw new GameError("BAD_SIGNATURE", "Invalid webhook signature", 403);
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || Math.abs(now - time) > 600000)
    throw new GameError(
      "STALE_EVENT",
      "Event timestamp is outside the allowed window",
      403,
    );
  const expected = Buffer.from(
    "sha256=" +
      createHmac("sha256", webhookSecret)
        .update(id + timestamp + body)
        .digest("hex"),
  );
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new GameError("BAD_SIGNATURE", "Invalid webhook signature", 403);
  return id;
}
