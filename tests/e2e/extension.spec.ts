import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ request }) => {
  const pair = (await request.get("/v1/debug/pair")).json();
  const { token: capture } = await pair;
  const reset = await request.post("/v1/native/debug/event", {
    headers: { Authorization: `Bearer ${capture}` },
    data: { type: "reset" },
  });
  expect(reset.status()).toBe(200);
});

function jwt(viewer: number) {
  const data = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: "viewer",
        channel_id: "555",
        user_id: String(viewer),
        opaque_user_id: `Utest${viewer}`,
      }),
    ).toString("base64url"),
  ].join(".");
  return `${data}.${createHmac("sha256", Buffer.alloc(32, 37)).update(data).digest("base64url")}`;
}
async function setup(page: Page, viewer: number) {
  await page.route("https://extension-files.twitch.tv/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "/* Twitch helper mocked for isolated UI tests. */",
    }),
  );
  await page.addInitScript(
    ({ token, viewer }) => {
      // Synthetic simultaneous touches have no browser pointer capture session.
      // Real pointer capture is covered by the focused mouse/keyboard test below.
      const capture = HTMLElement.prototype.setPointerCapture;
      HTMLElement.prototype.setPointerCapture = function (id) {
        try {
          capture.call(this, id);
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "NotFoundError"))
            throw e;
        }
      };
      (window as any).Twitch = {
        ext: {
          onAuthorized: (cb: (a: any) => void) =>
            setTimeout(
              () => cb({ token, channelId: "555", userId: `Utest${viewer}` }),
              0,
            ),
          onVisibilityChanged: () => {},
          actions: {
            requestIdShare: () => {
              (window as any).identityRequested = true;
            },
          },
        },
      };
    },
    { token: jwt(viewer), viewer },
  );
}
test("three viewers join separate server heroes, hold different directions, release and use emotes/targets", async ({
  browser,
  request,
}, info) => {
  const contexts: BrowserContext[] = [],
    pages: Page[] = [];
  const ids = [10001, 10002, 10003].map(
    (n) => n + (info.project.name === "mobile" ? 10 : 0),
  );
  try {
    for (const id of ids) {
      const context = await browser.newContext({
        viewport: {
          width: info.project.name === "mobile" ? 390 : 360,
          height: 850,
        },
        deviceScaleFactor: 1,
      });
      contexts.push(context);
      const page = await context.newPage();
      let unsolicitedSteer = 0;
      const observeIdle = (request: { url(): string }) => {
        if (request.url().endsWith("/v1/ext/steer")) unsolicitedSteer++;
      };
      page.on("request", observeIdle);
      pages.push(page);
      await setup(page, id);
      await page.goto("/ext/component.html");
      await page.getByRole("button", { name: "Join the raid" }).click();
      await expect(
        page.getByRole("heading", {
          name: `viewer-${String(id).slice(-4)}`,
          exact: true,
        }),
      ).toBeVisible();
      await page.waitForTimeout(160);
      expect(
        unsolicitedSteer,
        "Joining or opening an idle controller must not cancel a hero's portal entrance or another controller's action",
      ).toBe(0);
      page.off("request", observeIdle);
    }
    const directions = ["Right", "Forward", "Left"];
    await Promise.all(
      pages.map((page, i) =>
        page
          .getByRole("button", { name: `Move ${directions[i]}`, exact: true })
          .dispatchEvent("pointerdown", {
            pointerId: i + 1,
            pointerType: "touch",
            isPrimary: true,
          }),
      ),
    );
    for (const page of pages)
      await expect(
        page.getByText("Your hero is moving", { exact: true }),
      ).toBeVisible();
    const states = await Promise.all(
      ids.map(async (id) =>
        (
          await request.get("/v1/ext/state", {
            headers: { Authorization: `Bearer ${jwt(id)}` },
          })
        ).json(),
      ),
    );
    expect(new Set(states.map((s) => s.hero.id)).size).toBe(3);
    expect(states.map((s) => [s.hero.steer.x, s.hero.steer.y])).toEqual([
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    await Promise.all(
      pages.map((page, i) =>
        page
          .getByRole("button", { name: `Move ${directions[i]}`, exact: true })
          .dispatchEvent("pointerup", {
            pointerId: i + 1,
            pointerType: "touch",
          }),
      ),
    );
    for (const page of pages)
      await expect(
        page.getByText("Your hero is moving", { exact: true }),
      ).toHaveCount(0);
    await pages[0].getByRole("button", { name: "dance", exact: true }).click();
    await expect(pages[0].getByRole("status")).toHaveText("dance");
    await pages[0].waitForTimeout(550);
    await pages[0].getByRole("button", { name: "3sofa", exact: true }).click();
    await expect
      .poll(async () =>
        (
          await request.get("/v1/ext/state", {
            headers: { Authorization: `Bearer ${jwt(ids[0])}` },
          })
        )
          .json()
          .then((s) => s.hero.target),
      )
      .toBe("qa-sofa");
    await pages[0]
      .getByRole("button", { name: "Use my Twitch identity" })
      .click();
    expect(
      await pages[0].evaluate(() => (window as any).identityRequested),
    ).toBe(true);
    const axe = await new AxeBuilder({ page: pages[0] }).analyze();
    expect(axe.violations).toEqual([]);
    const dimensions = await pages[0].evaluate(() => ({
      width: innerWidth,
      right: document.documentElement.scrollWidth,
    }));
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.width);
    await pages[0].screenshot({
      path: `artifacts/extension-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("overlay collapses to the corner; local keyboard movement stops on blur and typing never steers", async ({
  page,
}, info) => {
  await setup(page, info.project.name === "mobile" ? 10021 : 10020);
  await page.goto("/ext/");
  await expect(page.getByRole("main")).toHaveCount(0);
  await page.getByRole("button", { name: /RaidRift/ }).click();
  await page.getByRole("button", { name: "Join the raid" }).click();
  await expect(page.getByRole("heading", { name: /viewer-/ })).toBeVisible();
  const right = page.getByRole("button", { name: "Move Right", exact: true });
  await right.hover();
  await page.mouse.down();
  await expect(
    page.getByText("Your hero is moving", { exact: true }),
  ).toBeVisible();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(
    page.getByText("Your hero is moving", { exact: true }),
  ).toHaveCount(0);
  if (
    await page
      .getByText("WASD or arrows when focused", { exact: false })
      .count()
  ) {
    await page.getByRole("main").focus();
    await page.keyboard.down("d");
    await expect(
      page.getByText("Your hero is moving", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Give your hero an idea").focus();
    await page.keyboard.up("d");
    await expect(
      page.getByText("Your hero is moving", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Give your hero an idea").fill("wasd");
    await page.waitForTimeout(650);
    await expect(
      page.getByText("Your hero is moving", { exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Collapse controls" }).click();
  await expect(page.getByRole("main")).toHaveCount(0);
  const rect = await page.locator(".launcher").boundingBox();
  expect(rect!.x).toBeLessThan(40);
  await page.screenshot({
    path: `artifacts/extension-collapsed-${info.project.name}.png`,
  });
});
