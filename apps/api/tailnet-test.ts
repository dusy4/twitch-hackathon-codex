import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createApp } from "./server.js";
import { Database } from "./db.js";
import { Security } from "./security.js";
import { account } from "./economy.js";
import { defaultConfig } from "../../packages/shared/contracts.js";

/** Numeric, Twitch-style id so the real EventSub drain path accepts the room. */
export const TAILNET_ROOM = "900000001";

/** Tailscale CGNAT range 100.64.0.0/10. */
export function tailscaleIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p)))
    return false;
  const [a, b, c, d] = parts.map(Number);
  return [c, d].every((v) => v <= 255) && a === 100 && b >= 64 && b <= 127;
}

/** Reads one KEY=value line from a dotenv file without loading anything else. */
export function readEnvValue(file: string, key: string): string | undefined {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match?.[1] === key)
      return match[2].trim().replace(/^(['"])(.*)\1$/, "$2") || undefined;
  }
}

export async function createTailnetTestApp(options: {
  host: string;
  port: number;
  origin: string;
  relayUrl?: string;
  timers?: boolean;
  debugChatStaggerMs?: number;
  ovDetectorUrl?: string;
}) {
  const { host, port } = options;
  if (!(host === "127.0.0.1" || tailscaleIpv4(host)))
    throw Error(
      "Tailnet tests bind 127.0.0.1 (for tailscale serve) or a 100.64.0.0/10 Tailscale address; other hosts are refused.",
    );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Choose a port from 1024 to 65535.");
  if (process.env.NODE_ENV === "production")
    throw Error("The disposable tailnet simulator cannot run in production.");
  const origin = new URL(options.origin).origin;
  if (!/^https?:$/.test(new URL(origin).protocol))
    throw Error("--origin must be an http(s) URL");
  // Only this disposable process is changed: no Twitch credentials, and the
  // planner uses OpenCode Go when OPENCODE_GO_API_KEY is present.
  process.env.TWITCH_CLIENT_ID = "";
  process.env.TWITCH_CLIENT_SECRET = "";
  process.env.OPENAI_API_KEY = "";
  process.env.EXPERIMENTAL_CAMERA_REWARDS = "false";
  process.env.DEBUG_TOOLS = "true";
  // Small fast planner first (Groq gpt-oss-20b, or any OpenAI-compatible PLANNER_BASE_URL such as a
  // local Liquid LFM2), else OpenCode Go.
  process.env.AI_PROVIDER ||=
    process.env.GROQ_API_KEY || process.env.PLANNER_BASE_URL
      ? "compat"
      : "opencode";
  process.env.ALLOW_PAID_AI =
    process.env.AI_PROVIDER === "compat"
      ? process.env.GROQ_API_KEY ||
        process.env.PLANNER_API_KEY ||
        process.env.PLANNER_BASE_URL
        ? "true"
        : "false"
      : process.env.OPENCODE_GO_API_KEY
        ? "true"
        : "false";
  const server = await createApp({
    db: Database.memory(),
    security: new Security(randomBytes(32)),
    demo: true,
    origin,
    timers: options.timers,
    debugTools: true,
    debugRoom: TAILNET_ROOM,
    debugChatStaggerMs: options.debugChatStaggerMs,
    relayUrl: options.relayUrl,
    ovDetectorUrl: options.ovDetectorUrl,
  });
  try {
    const { db } = server;
    // The dashboard's demo creator (Juniper) owns the test room; the stock
    // demo-world moves to a separate demo owner so /v1/creator/* is unambiguous.
    const host = await account(db, "demo-host", "Juniper", true);
    const other = await account(db, "demo-world-owner", "Juniper (demo)", true);
    await db.query("UPDATE channels SET owner_id=$2 WHERE id=$1", [
      "demo-world",
      other.id,
    ]);
    await db.query(
      "INSERT INTO channels(id,owner_id,config,connected) VALUES($1,$2,$3,true)",
      [
        TAILNET_ROOM,
        host.id,
        JSON.stringify({
          ...defaultConfig,
          title: "RaidRift tailnet test",
          paused: false,
          vision: true,
          ai: true,
        }),
      ],
    );
    await db.query(
      "INSERT INTO quests(id,channel_id,definition) VALUES($1,$2,$3)",
      [
        "tailnet-sit-with-dog",
        TAILNET_ROOM,
        JSON.stringify({
          title: "Sit with the dog",
          type: "virtual",
          action: "sit",
          targetClass: "dog",
          minPlayers: 2,
          sustainMs: 2000,
          reward: 50,
        }),
      ],
    );
    const world = await server.world(TAILNET_ROOM);
    for (const [provider, name] of [
      ["demo-traveler", "Mossling"],
      ["demo-second", "Emberfox"],
    ])
      await world.join(await account(db, provider, name, true));
    world.log(
      "info",
      `tailnet test room ready; AI ${process.env.ALLOW_PAID_AI === "true" ? "on" : "off (no OPENCODE_GO_API_KEY)"}`,
    );
    return { ...server, origin, room: TAILNET_ROOM };
  } catch (error) {
    await server.app.close();
    throw error;
  }
}
