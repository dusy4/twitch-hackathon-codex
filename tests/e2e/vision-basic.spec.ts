import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test("worker detection and observed motion drive a selected dog action in bounding-box mode", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Actual detector fixture runs once",
  );
  test.setTimeout(75000);
  const observations: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/creator/vision/tracks")) {
      try {
        observations.push({ at: Date.now(), ...request.postDataJSON() });
      } catch {}
    }
  });
  try {
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
    await page
      .locator("#capture-command")
      .fill("sprint towards the dog and sit on it");
    await expect(
      page.locator("#target option").filter({ hasText: /^dog/ }).first(),
    ).toBeAttached({ timeout: 15000 });
    const selected = (await page
      .locator("#target option")
      .filter({ hasText: /^dog/ })
      .first()
      .getAttribute("value"))!;
    await page.locator("#target").selectOption(selected);
    const requested = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/worlds/demo-world/actions") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Send action", exact: true })
      .click();
    const action = await requested;
    expect(action.status(), await action.text()).toBe(200);
    await expect
      .poll(
        async () => {
          const world = await (
            await page.request.get("/v1/worlds/demo-world")
          ).json();
          return world.avatars.find((actor: any) => actor.name === "Juniper")
            ?.animation;
        },
        { timeout: 8000 },
      )
      .toBe("sit");
    const snapshot = await (
      await page.request.get("/v1/worlds/demo-world")
    ).json();
    await writeFile(
      "artifacts/vision-basic.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          mode: "Bounding-box mode; no silhouette-contact claim",
          tracks: snapshot.tracks,
          actor: snapshot.avatars.find(
            (actor: any) => actor.name === "Juniper",
          ),
          metrics: await page.locator("#capture-metrics").textContent(),
          workerLatencyMs: await page
            .locator("#capture-metrics")
            .getAttribute("data-detector-ms"),
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: "artifacts/chromium-vision-basic.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stop capture", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/v1/worlds/demo-world")).json())
            .tracks.length,
      )
      .toBe(0);
  } finally {
    await writeFile(
      "artifacts/vision-basic-trace.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          observations: observations.slice(-300),
        },
        null,
        2,
      ),
    );
  }
});
