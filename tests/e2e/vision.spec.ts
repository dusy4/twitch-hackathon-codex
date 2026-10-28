import { test, expect } from "@playwright/test";
test("actual local detector processes licensed dog video and sends grounded tracks", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Real model validation is CPU-intensive and run once in Chromium",
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await page.locator('input[name="vision"]').check();
  await page.locator('input[name="paused"]').uncheck();
  await page.getByRole("button", { name: "Save world settings" }).click();
  await expect(page.locator("#toast")).toContainText("saved");
  await page.getByRole("link", { name: "Open camera companion" }).click();
  await expect(page.locator("#video-file")).toBeVisible();
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
  await page.locator("#silhouette-enabled").check();
  await expect
    .poll(
      async () => {
        const w = await (
          await page.request.get("/v1/worlds/demo-world")
        ).json();
        const found = w.tracks.some((t: any) => t.class === "dog" && t.anchor);
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
  await page
    .locator("#capture-command")
    .fill("sprint towards the dog and sit on it");
  await page.getByRole("button", { name: "Send action", exact: true }).click();
  await expect
    .poll(
      async () => {
        const w = await (
          await page.request.get("/v1/worlds/demo-world")
        ).json();
        return w.avatars.find((a: any) => a.name === "Juniper")?.animation;
      },
      { timeout: 8000 },
    )
    .toBe("sit");
  await page.screenshot({
    path: "artifacts/chromium-real-dog-detection.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
  await expect(page.locator("#capture-status")).toContainText("stopped");
  expect(
    (await (await page.request.get("/v1/worlds/demo-world")).json()).tracks,
  ).toHaveLength(0);
});
