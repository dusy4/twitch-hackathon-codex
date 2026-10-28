import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("late optional silhouette results are discarded and bounding-box capture remains usable", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Real model + controlled worker-delay test runs once",
  );
  test.setTimeout(75000);
  await page.route("**/assets/silhouette.worker-*.js", async (route) => {
    const response = await route.fetch();
    const delay =
      "const originalPost=self.postMessage.bind(self);self.postMessage=(message,...rest)=>{if(message.type==='anchor')setTimeout(()=>originalPost(message,...rest),1800);else originalPost(message,...rest);};\n";
    await route.fulfill({ response, body: delay + (await response.text()) });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await page.locator('input[name="vision"]').check();
  await page.locator('input[name="paused"]').uncheck();
  await page.getByRole("button", { name: "Save world settings" }).click();
  await expect(page.locator("#toast")).toContainText("saved");
  await page.getByRole("link", { name: "Open camera companion" }).click();
  await expect(page.locator("#capture-metrics")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page
    .locator("#video-file")
    .setInputFiles("tests/fixtures/dog-tail.webm");
  await expect(page.locator("#capture-status")).toContainText(
    "Processing locally",
    { timeout: 25000 },
  );
  await expect
    .poll(
      async () => {
        const world = await (
          await page.request.get("/v1/worlds/demo-world")
        ).json();
        return world.tracks.some((t: any) => t.class === "dog");
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await page.locator("#silhouette-enabled").check();
  await expect(page.locator("#capture-metrics")).toHaveAttribute(
    "data-silhouette-status",
    /^(running|current|no-surface)$/,
    { timeout: 30000 },
  );
  await expect(page.locator("#capture-metrics")).toHaveAttribute(
    "data-silhouette-stage",
    "segmenting",
    { timeout: 10000 },
  );
  await expect(page.locator("#capture-metrics")).toHaveAttribute(
    "data-silhouette-status",
    /^unavailable-/,
    { timeout: 15000 },
  );
  await expect(page.locator("#capture-status")).toContainText(/Bounding-box/i);
  await expect
    .poll(
      async () => {
        const world = await (
          await page.request.get("/v1/worlds/demo-world")
        ).json();
        return world.tracks.length;
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  const snapshot = await (
    await page.request.get("/v1/worlds/demo-world")
  ).json();
  expect(snapshot.tracks.every((track: any) => !track.anchor)).toBe(true);
  const requested = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/worlds/demo-world/actions") &&
      response.request().method() === "POST",
  );
  await page.locator("#capture-command").fill("wave");
  await page.getByRole("button", { name: "Send action", exact: true }).click();
  const action = await requested;
  expect(action.status(), await action.text()).toBe(200);
  await writeFile(
    "artifacts/vision-fallback.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        faultInjectedDelayMs: 1800,
        status: await page
          .locator("#capture-metrics")
          .getAttribute("data-silhouette-status"),
        message: await page.locator("#capture-status").textContent(),
        observedTracks: snapshot.tracks,
        model:
          "Actual local MagicTouch legacy; outgoing result delivery delayed deliberately",
        scope: "Fallback handling, not a passing silhouette quality benchmark",
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "artifacts/chromium-vision-fallback.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
});
