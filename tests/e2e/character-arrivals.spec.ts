import { test, expect, type Video } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("actual overlay shows a bounded anonymous raid crowd and a distinct claimed character walking out of the portal", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Transparent overlay arrival runs once with labelled simulator input; no live Twitch claim",
  );
  test.setTimeout(90000);
  const host = await browser.newContext({ baseURL: "http://127.0.0.1:3401" }),
    viewer = await browser.newContext({ baseURL: "http://127.0.0.1:3401" });
  const overlayContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3401",
    recordVideo: {
      dir: ".data/qa-arrival-video",
      size: { width: 1280, height: 720 },
    },
  });
  let recording: Video | null = null;
  try {
    const studio = await host.newPage();
    await studio.goto("/dashboard");
    await studio.getByRole("button", { name: "Try creator simulator" }).click();
    await expect(studio.locator("#config-form")).toBeVisible();
    await studio.locator('input[name="paused"]').uncheck();
    await studio.getByRole("button", { name: "Save world settings" }).click();
    await expect(studio.locator("#toast")).toContainText("saved");
    await studio
      .getByRole("button", { name: "Generate / rotate overlay URL" })
      .click();
    await expect(studio.locator("#overlay-url")).toContainText("/overlay?");
    const url = await studio.locator("#overlay-url").textContent();
    const overlay = await overlayContext.newPage();
    recording = overlay.video();
    await overlay.goto(url!);
    await expect(overlay.locator("#stage")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await studio.bringToFront();
    await studio
      .getByRole("button", { name: "Run a labelled test raid" })
      .click();
    await overlay.bringToFront();
    await expect(overlay.locator("#stage")).toHaveAttribute(
      "data-portal-visible",
      "true",
    );
    await expect
      .poll(async () =>
        Number(
          await overlay
            .locator("#stage")
            .getAttribute("data-anonymous-crowd-count"),
        ),
      )
      .toBeGreaterThan(0);
    const before = await (
      await viewer.request.get("/v1/worlds/demo-world")
    ).json();
    const login = await viewer.request.post("/v1/demo/session", {
      headers: { origin: "http://127.0.0.1:3401" },
      data: { persona: "third" },
    });
    expect(login.status()).toBe(200);
    const me = await (await viewer.request.get("/v1/me")).json();
    expect(before.avatars.some((a: any) => a.id === me.user.id)).toBe(false);
    const controller = await viewer.newPage();
    const joining = controller.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/worlds/demo-world/join") &&
        response.request().method() === "POST",
    );
    await controller.goto("/controller?room=demo-world");
    const joined = await joining;
    expect(joined.status(), await joined.text()).toBe(200);
    const actor = await joined.json();
    expect(actor.arrival.from).toEqual([0.36, 0.77]);
    await expect(
      controller.locator(`.avatar-label[data-avatar-id="${me.user.id}"]`),
    ).toContainText("YOU · Luna");
    await overlay.bringToFront();
    await expect(
      overlay.locator(`.avatar-label[data-avatar-id="${me.user.id}"]`),
    ).toContainText("Luna");
    await expect(overlay.locator("#stage")).toHaveAttribute(
      "data-projection",
      "perspective",
    );
    await expect(
      overlay.locator(`.avatar-label[data-avatar-id="${me.user.id}"]`),
    ).toHaveAttribute("data-model", /Knight|Mage|Rogue|Barbarian/);
    await expect
      .poll(
        async () => {
          const world = await (
            await viewer.request.get("/v1/worlds/demo-world")
          ).json();
          return (
            world.avatars.find((a: any) => a.id === me.user.id)?.arrival ===
            undefined
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await expect(overlay.locator("#stage")).toHaveAttribute(
      "data-avatar-count",
      String(before.avatars.length + 1),
    );
    const anonymous = Number(
      await overlay
        .locator("#stage")
        .getAttribute("data-anonymous-crowd-count"),
    );
    expect(anonymous).toBeLessThanOrEqual(120);
    await overlay.screenshot({
      path: "artifacts/chromium-character-arrival-overlay.png",
      omitBackground: true,
    });
    await controller.bringToFront();
    await controller.getByRole("button", { name: "wave", exact: true }).click();
    await expect(controller.locator("#action-feed")).toContainText("wave");
    const reentering = controller.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/worlds/demo-world/join") &&
        response.request().method() === "POST",
    );
    await controller
      .getByRole("button", { name: "Step through the portal", exact: true })
      .click();
    const reentered = await reentering;
    expect(reentered.status(), await reentered.text()).toBe(200);
    expect((await reentered.json()).arrival.from).toEqual([0.36, 0.77]);
    await expect
      .poll(
        async () => {
          const current = await (
            await viewer.request.get("/v1/worlds/demo-world")
          ).json();
          return (
            current.avatars.find((a: any) => a.id === me.user.id)?.arrival ===
            undefined
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await controller.screenshot({
      path: "artifacts/chromium-claimed-character.png",
      fullPage: true,
    });
    const world = await (
      await viewer.request.get("/v1/worlds/demo-world")
    ).json();
    await writeFile(
      "artifacts/character-arrivals.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          input:
            "Labelled simulator raid, actual browser overlay and independent authenticated simulator viewer",
          reportedViewers: world.raid?.count,
          anonymousVisualInstances: anonymous,
          newActorId: me.user.id,
          avatarIds: world.avatars.map((a: any) => a.id),
          arrival: actor.arrival,
          settled: world.avatars.find((a: any) => a.id === me.user.id),
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.allSettled([
      host.close(),
      viewer.close(),
      overlayContext.close(),
    ]);
    await recording?.saveAs("artifacts/character-arrival-qa.webm");
  }
});
