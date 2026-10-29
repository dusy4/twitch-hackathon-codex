import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("capture preview transforms actual video pixels into the OBS canvas and aligns the overlay", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Synthetic pixel geometry fixture runs once; no perception-quality claim",
  );
  test.setTimeout(60000);
  await page.addInitScript(() => {
    // Explicit synthetic source: exercise browser media/canvas rendering without requesting a real camera.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        for (const [color, x, y] of [
          ["#ff0000", 0, 0],
          ["#00ff00", 200, 0],
          ["#0000ff", 0, 150],
          ["#ffff00", 200, 150],
        ] as const) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 200, 150);
        }
      };
      paint();
      const timer = setInterval(paint, 33);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0],
        stop = track.stop.bind(track);
      track.stop = () => {
        clearInterval(timer);
        stop();
      };
      return stream;
    };
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await expect(page.locator("#config-form")).toBeVisible();
  const me = await (await page.request.get("/v1/me")).json();
  const original = await (await page.request.get("/v1/creator/config")).json();
  const headers = { "x-csrf-token": me.csrf, origin: "http://127.0.0.1:3401" };
  const geometry = {
    width: 640,
    height: 480,
    crop: [0.1, 0.1, 0.1, 0.1],
    mirror: true,
    rotation: "90",
    viewport: [0.1, 0.2, 0.8, 0.6],
  };
  try {
    const response = await page.request.patch("/v1/creator/config", {
      headers,
      data: { ...original.config, vision: true, paused: false, geometry },
    });
    expect(response.status(), await response.text()).toBe(200);
    await page.goto("/capture");
    await expect(page.locator("#capture-metrics")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await page
      .getByRole("button", { name: "Select camera", exact: true })
      .click();
    await expect(page.locator("#capture-status")).toContainText(
      "Processing locally",
      { timeout: 30000 },
    );
    const sample = () =>
      page.locator("#capture-boxes").evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: [
            [0.75, 0.6875],
            [0.75, 0.3125],
            [0.25, 0.6875],
            [0.25, 0.3125],
            [0.01, 0.01],
          ].map(([x, y]) =>
            Array.from(
              ctx.getImageData(
                Math.round(x * canvas.width),
                Math.round(y * canvas.height),
                1,
                1,
              ).data,
            ).slice(0, 3),
          ),
        };
      });
    const expected = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [8, 10, 16],
    ];
    await expect
      .poll(
        async () => {
          const actual = await sample();
          return (
            actual.width === 640 &&
            actual.height === 480 &&
            actual.pixels.every((pixel, i) =>
              pixel.every(
                (channel, j) => Math.abs(channel - expected[i][j]) <= 8,
              ),
            )
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    const aligned = await page.evaluate(() => {
      const a = document
          .querySelector("#capture-boxes")!
          .getBoundingClientRect(),
        b = document.querySelector("#capture-world")!.getBoundingClientRect();
      return Math.max(
        Math.abs(a.width - b.width),
        Math.abs(a.height - b.height),
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
      );
    });
    expect(aligned).toBeLessThan(2);
    await writeFile(
      "artifacts/capture-geometry.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          fixture:
            "Synthetic four-color camera stream; no real camera or model quality claim",
          geometry,
          rendered: await sample(),
          maximumOverlayMisalignmentPx: aligned,
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: "artifacts/chromium-capture-geometry.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stop capture", exact: true })
      .click();
    await expect(page.locator("#capture-status")).toContainText("stopped");
  } finally {
    await page.request.patch("/v1/creator/config", {
      headers,
      data: original.config,
    });
  }
});
