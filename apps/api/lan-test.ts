import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { createApp } from "./server.js";
import { Database } from "./db.js";
import { Security } from "./security.js";
import { account } from "./economy.js";

export function privateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p)))
    return false;
  const [a, b, c, d] = parts.map(Number);
  return (
    [a, b, c, d].every((v) => v <= 255) &&
    (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
  );
}

export function lanCandidates(): string[] {
  return Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter(
          (a) => !a.internal && a.family === "IPv4" && privateIpv4(a.address),
        )
        .map((a) => ({ name, address: a.address })),
    )
    .sort((a, b) => {
      const virtual = /virtual|vethernet|docker|wsl|vbox|vmware|vpn|tailscale/i;
      return Number(virtual.test(a.name)) - Number(virtual.test(b.name));
    })
    .map((a) => a.address);
}

export async function createLanTestApp(host: string, port: number) {
  if (!(privateIpv4(host) || host === "127.0.0.1"))
    throw Error(
      "LAN tests require a private IPv4 address; public/wildcard hosts are refused.",
    );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Choose a port from 1024 to 65535.");
  if (process.env.NODE_ENV === "production")
    throw Error("The disposable LAN simulator cannot run in production mode.");
  // Only this disposable child process is changed. No account keys or paid integrations.
  process.env.TWITCH_CLIENT_ID = "";
  process.env.TWITCH_CLIENT_SECRET = "";
  process.env.OPENAI_API_KEY = "";
  process.env.ALLOW_PAID_AI = "false";
  process.env.EXPERIMENTAL_CAMERA_REWARDS = "false";
  const origin = `http://${host}:${port}`;
  const server = await createApp({
    db: Database.memory(),
    security: new Security(randomBytes(32)),
    demo: true,
    origin,
  });
  try {
    const world = await server.world("demo-world");
    world.state.config.paused = false;
    world.state.config.ai = false;
    for (const [provider, name] of [
      ["demo-traveler", "Mossling"],
      ["demo-second", "Emberfox"],
    ])
      await world.join(await account(server.db, provider, name, true));
    return { ...server, origin };
  } catch (error) {
    await server.app.close();
    throw error;
  }
}
