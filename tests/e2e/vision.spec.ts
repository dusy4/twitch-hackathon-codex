import { test, expect } from "@playwright/test";
test("actual local detector processes licensed dog video and sends grounded tracks", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Real model validation is CPU-intensive and run once in Chromium",
  );
  test.setTimeout(75000); // Detector initialization + bounded segmentation/action checks have separate assertions.
  const observations: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/creator/vision/tracks")) {
      try {
        observations.push({
          at: Date.now(),
          kind: "capture",
          ...request.postDataJSON(),
        });
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
    await expect(page.locator("#video-file")).toBeVisible();
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
    await expect(page.locator("#capture-metrics")).toContainText(
      "visible objects",
      { timeout: 15000 },
    );
    await page.waitForTimeout(1800);
    const snapshot = await page.request.get("/v1/worlds/demo-world");
    const data = await snapshot.json();
    expect(data.tracks.some((t: any) => t.class === "dog")).toBe(true);
    await page.locator("#capture-video").evaluate((video: HTMLVideoElement) => {
      video.currentTime = 0.5;
    });
    await page.locator("#silhouette-enabled").check();
    await expect
      .poll(
        async () => {
          const w = await (
            await page.request.get("/v1/worlds/demo-world")
          ).json();
          const found = w.tracks.some(
            (t: any) => t.class === "dog" && t.anchor,
          );
          return found;
        },
        { timeout: 20000 },
      )
      .toBe(true);
    const diagnostic = await page
      .locator("#capture-metrics")
      .getAttribute("data-silhouette");
    if (diagnostic) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile("artifacts/silhouette-runtime.json", diagnostic);
    }
    await expect
      .poll(
        async () => {
          const world = await (
            await page.request.get("/v1/worlds/demo-world")
          ).json();
          return world.tracks.some(
            (track: any) =>
              track.class === "dog" &&
              track.confidence >= 0.6 &&
              Date.now() - track.seenAt < 350,
          );
        },
        { timeout: 8000 },
      )
      .toBe(true);
    await page
      .locator("#capture-command")
      .fill("sprint towards the dog and sit on it");
    const requested = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/worlds/demo-world/actions") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Send action", exact: true })
      .click();
    const actionResponse = await requested;
    expect(actionResponse.status(), await actionResponse.text()).toBe(200);
    await expect
      .poll(
        async () => {
          const w = await (
            await page.request.get("/v1/worlds/demo-world")
          ).json();
          const actor = w.avatars.find((a: any) => a.name === "Juniper");
          observations.push({
            at: Date.now(),
            kind: "world",
            tracks: w.tracks,
            actor: actor
              ? {
                  animation: actor.animation,
                  message: actor.message,
                  target: actor.target,
                }
              : null,
          });
          return actor?.animation;
        },
        { timeout: 8000 },
      )
      .toBe("sit");
    await page.screenshot({
      path: "artifacts/chromium-real-dog-detection.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stop capture", exact: true })
      .click();
    await expect(page.locator("#capture-status")).toContainText("stopped");
    expect(
      (await (await page.request.get("/v1/worlds/demo-world")).json()).tracks,
    ).toHaveLength(0);
  } finally {
    const { writeFile } = await import("node:fs/promises");
    const diagnostic = await page
      .locator("#capture-metrics")
      .getAttribute("data-silhouette")
      .catch(() => null);
    await writeFile(
      `artifacts/vision-trace-${info.repeatEachIndex}.json`,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          licensedFixture: "dog-tail.webm",
          diagnostic: diagnostic ? JSON.parse(diagnostic) : null,
          observations: observations.slice(-500),
        },
        null,
        2,
      ),
    );
  }
});
