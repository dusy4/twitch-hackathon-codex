import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createApp } from "../apps/api/server.js";
import { Database } from "../apps/api/db.js";
import { Security } from "../apps/api/security.js";
import { account } from "../apps/api/economy.js";
import { defaultConfig } from "../packages/shared/contracts.js";

if (process.env.NODE_ENV === "production")
  throw Error(
    "This isolated synthetic smoke must not run in a production environment",
  );
const executable = resolve(
  process.env.TWITCH_CLI_PATH ||
    ".tools/twitch-cli/twitch-cli_1.1.24_Windows_x86_64/twitch.exe",
);
if (!existsSync(executable))
  throw Error(
    "Install the official Twitch CLI and set TWITCH_CLI_PATH; see docs/SETUP.md",
  );
// These belong only to this disposable loopback process. No configured provider account is used.
process.env.TWITCH_CLIENT_ID = "";
process.env.TWITCH_CLIENT_SECRET = "";
const webhookSecret = "raidrift-official-cli-local-fixture";
process.env.TWITCH_EVENTSUB_WEBHOOK_SECRET = webhookSecret;
const origin = "http://127.0.0.1:3402",
  channelId = "99112233";
const s = await createApp({
  db: Database.memory(),
  security: new Security(Buffer.alloc(32, 27)),
  demo: false,
  origin,
});
const cli = (args: string[]) =>
  new Promise<string>((ok, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-30000);
    });
    child.stderr.on("data", (bytes) => {
      output = (output + bytes.toString()).slice(-30000);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? ok(output)
        : reject(Error(`Official CLI fixture exited ${code}`)),
    );
  });
const until = async (
  condition: () => boolean | Promise<boolean>,
  label: string,
) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error(`Timed out: ${label}`);
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const owner = await account(s.db, channelId, "CLI fixture channel", true);
  await s.db.query(
    "INSERT INTO channels(id,owner_id,config,connected) VALUES($1,$2,$3,true)",
    [channelId, owner.id, JSON.stringify(defaultConfig)],
  );
  const sourceVideo = existsSync("tests/fixtures/dog-tail.webm")
    ? await readFile("tests/fixtures/dog-tail.webm")
    : null;
  if (sourceVideo)
    s.app.get("/qa/source.webm", async (_req, reply) =>
      reply
        .type("video/webm")
        .header("Cache-Control", "no-store")
        .send(sourceVideo),
    );
  await s.app.listen({ host: "127.0.0.1", port: 3402 });
  const w = await s.world(channelId);
  assert.equal(w.state.mode, "SIMULATOR");
  const originalAccounts = Number(
    (await s.db.query("SELECT count(*) AS n FROM accounts")).rows[0].n,
  );
  browser = await chromium.launch({
    args: [
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(`${origin}/overlay?room=${channelId}`);
  await page.locator('#stage[data-rendered="true"]').waitFor();
  const eventId = randomUUID();
  const flags = [
    "event",
    "trigger",
    "raid",
    "--no-config",
    "--from-user",
    "424242",
    "--to-user",
    channelId,
    "--secret",
    webhookSecret,
    "--forward-address",
    `${origin}/v1/twitch/eventsub`,
    "--event-id",
    eventId,
  ];
  await cli(flags);
  await until(
    () => w.state.raid?.id === eventId,
    "official CLI signed raid consumed",
  );
  const reported = w.state.raid!.count;
  assert.equal(
    w.state.raid!.test,
    true,
    "Simulator channel never labels a generated event as live",
  );
  assert.equal(
    Number((await s.db.query("SELECT count(*) AS n FROM accounts")).rows[0].n),
    originalAccounts,
  );
  await until(
    async () =>
      Number(
        await page.locator("#stage").getAttribute("data-anonymous-crowd-count"),
      ) > 0,
    "anonymous crowd rendered",
  );
  const signedChat = async (chatterId: string, name: string, text: string) => {
    const id = randomUUID(),
      timestamp = new Date().toISOString();
    const raw = JSON.stringify({
      subscription: {
        type: "channel.chat.message",
        condition: { broadcaster_user_id: channelId },
      },
      event: {
        broadcaster_user_id: channelId,
        chatter_user_id: chatterId,
        chatter_user_name: name,
        message_id: id,
        message: { text },
      },
    });
    const response = await fetch(`${origin}/v1/twitch/eventsub`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "twitch-eventsub-message-id": id,
        "twitch-eventsub-message-timestamp": timestamp,
        "twitch-eventsub-message-signature": `sha256=${createHmac(
          "sha256",
          webhookSecret,
        )
          .update(id + timestamp + raw)
          .digest("hex")}`,
        "twitch-eventsub-message-type": "notification",
      },
      body: raw,
    });
    assert.equal(response.status, 204);
  };
  // CLI v1.1.24 has no chat-message generator. Chat payloads below are explicitly our signed fixtures.
  await signedChat("801001", "CLI_One", "!join");
  await signedChat("801002", "CLI_Two", "!join");
  await until(
    () =>
      w.state.avatars.length === 2 && w.state.avatars.every((a) => !a.arrival),
    "two chat identities enter through portal",
  );
  assert.equal(new Set(w.state.avatars.map((a) => a.id)).size, 2);
  assert.equal(
    Number((await s.db.query("SELECT count(*) AS n FROM accounts")).rows[0].n),
    originalAccounts + 2,
  );
  assert.ok(
    (
      await s.db.query(
        "SELECT demo FROM accounts WHERE twitch_id IN ('801001','801002')",
      )
    ).rows.every((row) => row.demo),
  );
  await cli(flags);
  await until(
    () => s.metrics.duplicates > 0,
    "duplicate official raid suppressed",
  );
  assert.equal(w.state.raid!.count, reported);
  await signedChat("801001", "CLI_One", "!rift dance");
  await until(
    () =>
      w.state.avatars.some(
        (a) => a.name === "CLI_One" && a.animation === "dance",
      ),
    "chat controls the corresponding character",
  );
  assert.notEqual(
    w.state.avatars.find((a) => a.name === "CLI_Two")!.animation,
    "dance",
  );
  await until(
    async () =>
      (await page.locator("#stage").getAttribute("data-avatar-count")) === "2",
    "two claimed characters rendered",
  );
  await page.screenshot({
    path: "artifacts/twitch-cli-character-overlay.png",
    omitBackground: true,
  });
  if (sourceVideo) {
    await page.evaluate(async () => {
      const video = document.createElement("video");
      video.id = "qa-background";
      video.src = "/qa/source.webm";
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;max-height:none;object-fit:cover;border-radius:0;z-index:0";
      document.body.prepend(video);
      const app = document.querySelector<HTMLElement>("#app")!;
      app.style.zIndex = "1";
      await video.play();
    });
    await page.waitForFunction(() => {
      const video = document.querySelector<HTMLVideoElement>("#qa-background");
      return !!video && video.readyState >= 2 && video.currentTime > 0.1;
    });
    await page.screenshot({
      path: "artifacts/twitch-cli-character-composite.png",
    });
  }
  const provenance = existsSync(".tools/twitch-cli/provenance.json")
    ? JSON.parse(await readFile(".tools/twitch-cli/provenance.json", "utf8"))
    : { source: "operator-supplied TWITCH_CLI_PATH" };
  await writeFile(
    "artifacts/twitch-cli-smoke.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        result: "passed",
        scope:
          "Official CLI synthetic signed raid + our signed synthetic chat fixtures → real HTTP inbox/world/WebSocket/Chromium overlay; no live Twitch/OAuth calls",
        cli: provenance,
        reportedViewers: reported,
        claimedCharacters: w.state.avatars.map((a) => ({
          id: a.id,
          name: a.name,
          animation: a.animation,
        })),
        accountsCreatedByReportedCount: 0,
        compositeBackground: sourceVideo
          ? "Licensed dog-tail.webm fixture; video composite/rendering only, not camera grounding or AR proof"
          : null,
        duplicates: s.metrics.duplicates,
        rewardMode: "simulator",
        limitations: [
          "Official CLI does not generate chat messages in this version",
          "No live raid, real viewer identity or OBS application validation",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Official CLI raid + signed chat character smoke passed; artifacts/twitch-cli-smoke.json",
  );
} finally {
  await browser?.close();
  await s.app.close();
}
