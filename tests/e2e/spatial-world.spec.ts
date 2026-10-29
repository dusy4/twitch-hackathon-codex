import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

test("ordinary desktop reports unsupported AR without requesting camera or inventing an anchor", async ({
  page,
}) => {
  await page.goto("/ar");
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-spatial-state",
    "unsupported",
  );
  await expect(page.locator("#ar-status")).toContainText(
    "does not provide immersive AR",
  );
  await expect(
    page.getByRole("button", { name: "Start room AR" }),
  ).toBeDisabled();
  await expect(page.locator("#stage canvas")).toHaveCount(0);
});

test("official IWER emulator exercises real XR API placement, independent rigged actors, camera motion, recenter and session cleanup", async ({
  page,
  request,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Official XR runtime emulation runs once; not a physical device acceptance test",
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bundle = await build({
    stdin: {
      contents: `
      import { XRDevice, metaQuest3 } from 'iwer';
      import { SyntheticEnvironmentModule } from '@iwer/sem';
      import room from './node_modules/@iwer/sem/captures/office_small.json';
      const device = new XRDevice(metaQuest3, { stereoEnabled: false });
      device.installRuntime({ forceInstall: true });
      device.installSEM(SyntheticEnvironmentModule);
      device.sem.loadEnvironment(room);
      device.position.set(0, 1.6, 0);
      device.quaternion.set(-0.3826834, 0, 0, 0.9238795);
      window.__xrTest = device;
    `,
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  await page.addInitScript({ content: bundle.outputFiles[0].text });
  await page.goto("/controller");
  await page.getByRole("button", { name: "Try viewer simulator" }).click();
  await expect(page.locator("#command-form")).toBeVisible();
  await request.post("/v1/demo/session", {
    headers: { origin: "http://127.0.0.1:3401" },
    data: { persona: "third" },
  });
  const second = await (await request.get("/v1/me")).json();
  const joining = await request.post("/v1/worlds/demo-world/join", {
    headers: { origin: "http://127.0.0.1:3401", "X-CSRF-Token": second.csrf },
    data: {},
  });
  expect(joining.status()).toBe(200);
  await page.goto("/ar");
  await expect(
    page.getByRole("button", { name: "Start room AR" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start room AR" }).click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-spatial-state",
    "scanning",
  );
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-hit-visible",
    "true",
  );
  await page.evaluate(() =>
    (window as any).__xrTest.remote.dispatch("select", {
      device: "controller-right",
      duration: 0.1,
    }),
  );
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-spatial-state",
    "anchored",
  );
  await expect
    .poll(async () =>
      Number(
        await page.locator("#stage").getAttribute("data-rigged-avatar-count"),
      ),
    )
    .toBeGreaterThanOrEqual(2);
  const anchor = await page
    .locator("#stage")
    .getAttribute("data-anchor-position");
  await page.screenshot({ path: "artifacts/webxr-emulator-anchored.png" });
  await page.evaluate(() =>
    (window as any).__xrTest.remote.dispatch("set_transform", {
      device: "headset",
      position: { x: 0.4, y: 1.3, z: 0.2 },
    }),
  );
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-tracking",
    "webxr-pose",
  );
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-anchor-position",
    anchor!,
  );
  await page.screenshot({ path: "artifacts/webxr-emulator-camera-moved.png" });
  const action = page.waitForResponse(
    (response) =>
      response.url().endsWith("/actions") &&
      response.request().method() === "POST",
  );
  await page
    .locator('[data-ar-command="wave"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  expect((await action).status()).toBe(200);
  await page
    .locator("#ar-recenter")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-spatial-state",
    "scanning",
  );
  await page
    .locator("#ar-end")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-spatial-state",
    "idle",
  );
  await expect(page.locator("#ar-status")).toContainText(
    "Camera session closed",
  );
  const active = await page.evaluate(
    () => !!(window as any).__xrTest.activeSession,
  );
  expect(active).toBe(false);
  expect(errors).toEqual([]);
  await writeFile(
    "artifacts/webxr-emulator.json",
    JSON.stringify(
      {
        runtime: "IWER 2.7.0 + SEM office_small",
        physicalDevice: false,
        anchor,
        cameraMotion: "0.4m sideways, 0.3m lower, 0.2m forward",
        actionStatus: 200,
        activeSessionAfterEnd: active,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
});
