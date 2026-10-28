import { test, expect } from "@playwright/test";
test("consented local composite clip downloads as playable video and discards on permission withdrawal", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Local encoder validation runs once in Chromium",
  );
  test.setTimeout(75000);
  let releaseVision = () => {};
  const initializationGate = new Promise<void>((resolve) => {
    releaseVision = resolve;
  });
  await page.route("**/assets/vision-*.js", async (route) => {
    await initializationGate;
    await route.continue();
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await page.locator('input[name="vision"]').check();
  await page.locator('input[name="paused"]').uncheck();
  await page.getByRole("button", { name: "Save world settings" }).click();
  await expect(page.locator("#toast")).toContainText("saved");
  await page.getByRole("link", { name: "Open camera companion" }).click();
  try {
    await expect(page.locator("#video-file")).toBeDisabled();
  } finally {
    releaseVision();
  }
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
  await page.locator("#capture-command").fill("wave");
  await page.getByRole("button", { name: "Send action", exact: true }).click();
  await page.getByRole("button", { name: "Record local clip" }).click();
  await expect(page.locator("#clip-status")).toContainText("permission");
  await expect(page.locator("#clip-download")).toHaveCount(0);
  await page.locator("#clip-consent").check();
  await page.getByRole("button", { name: "Record local clip" }).click();
  await expect(page.locator("#clip-status")).toContainText("Recording locally");
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Finish clip" }).click();
  await expect(page.locator("#clip-download")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#clip-preview")
        .evaluate((v: HTMLVideoElement) => v.videoWidth),
    )
    .toBeGreaterThan(0);
  await page.locator("#clip-preview").evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await page.waitForTimeout(400);
  await page
    .locator("#clip-preview")
    .evaluate((v: HTMLVideoElement) => v.pause());
  await page
    .locator("#clip-preview")
    .screenshot({ path: "artifacts/chromium-clip-frame.png" });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#clip-download").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("raidrift-clip.webm");
  await download.saveAs("artifacts/dog-composite-qa.webm");
  const { readFile, writeFile } = await import("node:fs/promises");
  const clipBytes = await readFile("artifacts/dog-composite-qa.webm");
  expect(clipBytes.length).toBeGreaterThan(1000);
  expect(clipBytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  const { createHash } = await import("node:crypto");
  const dimensions = await page
    .locator("#clip-preview")
    .evaluate((v: HTMLVideoElement) => ({
      width: v.videoWidth,
      height: v.videoHeight,
    }));
  await writeFile(
    "artifacts/clip-export.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        fixture: "tests/fixtures/dog-tail.webm",
        output: "dog-composite-qa.webm",
        sha256: createHash("sha256").update(clipBytes).digest("hex"),
        bytes: clipBytes.length,
        ...dimensions,
        sourceLicense: "CC-BY-SA-4.0",
        sourceAuthor: "Liannadavis",
        syntheticIdentity: true,
        containsAudio: false,
        uploaded: false,
      },
      null,
      2,
    ),
  );
  await page.getByRole("button", { name: "Discard local clip" }).click();
  await expect(page.locator("#clip-download")).toHaveCount(0);
  await page.getByRole("button", { name: "Record local clip" }).click();
  await expect(page.locator("#clip-status")).toContainText("Recording locally");
  await page.locator("#clip-consent").uncheck();
  await expect(page.locator("#clip-status")).toContainText("discarded");
  await page.getByRole("button", { name: "Stop capture", exact: true }).click();
});
