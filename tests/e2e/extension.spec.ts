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

test("held feedback clears on cancellation and blur; reduced motion and review input remain usable", async ({ page }, info) => {
  await setup(page, info.project.name === "mobile" ? 10031 : 10030);
  await page.goto("/ext/mobile.html");
  await page.getByRole("button", { name: "Join the raid" }).click();
  const right = page.getByRole("button", { name: "Move Right", exact: true });
  await right.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch" });
  await expect(right).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toHaveText("Your hero is moving");
  await page.screenshot({ path: `artifacts/extension-moving-${info.project.name}.png` });
  await right.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "touch" });
  await expect(right).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status")).not.toHaveText("Your hero is moving");
  const forward = page.getByRole("button", { name: "Move Forward", exact: true });
  await forward.focus();
  await page.keyboard.down("Space");
  await expect(forward).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Give your hero an idea").focus();
  await page.keyboard.up("Space");
  await expect(forward).toHaveAttribute("aria-pressed", "false");
  if (!(await page.getByText("WASD or arrows when focused", { exact: false }).count())) {
    let steers = 0;
    await expect(page.getByRole("status")).not.toHaveText("Your hero is moving");
    await page.waitForTimeout(200); // Settle the legitimate release before observing shortcut input.
    page.on("request", request => { if (request.url().endsWith("/v1/ext/steer")) steers++; });
    await page.getByRole("main").focus();
    await page.keyboard.down("d");
    await page.waitForTimeout(250);
    await page.keyboard.up("d");
    expect(steers, "The review build must not implement keyboard shortcuts").toBe(0);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.fonts.ready);
  const proof = await page.evaluate(() => ({
    fonts: [...document.fonts].filter(f => f.status === "loaded").map(f => f.family),
    animations: [
      getComputedStyle(document.querySelector(".voxel-body")!).animationName,
      getComputedStyle(document.querySelector(".target")!, "::after").animationName,
    ],
  }));
  expect(proof.fonts).toEqual(expect.arrayContaining(["Inter", "Space Grotesk"]));
  expect(proof.animations).toEqual(["none", "none"]);
  await page.screenshot({ path: `artifacts/extension-reduced-motion-${info.project.name}.png` });
});

test("all full-frame surfaces handle narrow widths, long identities and unavailable controls", async ({ page }, info) => {
  await setup(page, info.project.name === "mobile" ? 10041 : 10040);
  await page.goto("/ext/panel.html");
  await page.getByRole("button", { name: "Join the raid" }).click();
  // Deliberately extreme display data. Existing integration tests exercise actual server state.
  await page.route("**/v1/ext/state", async route => {
    const response = await route.fetch();
    const state = await response.json();
    state.hero.name = "A".repeat(50);
    state.hero.cosmetic = "Rift adventurer with a very long cosmetic description";
    state.targets = [{ id: "long-target", number: 3, label: "sofa-with-an-unusually-long-target-label" }];
    state.roster = [{ ...state.roster[0], name: "B".repeat(50) }];
    await route.fulfill({ json: state });
  });
  await page.route("**/v1/ext/events", route => route.fulfill({
    contentType: "text/event-stream", body: ": isolated display fixture\n\n",
  }));
  for (const path of ["panel.html", "component.html", "mobile.html"]) {
    await page.goto(`/ext/${path}`);
    await expect(page.getByRole("heading", { name: "A".repeat(50), exact: true })).toBeVisible();
    for (const width of [280, 320, 390, 768]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.locator("main").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/v1/ext/state", route => route.fulfill({ status: 503, json: { message: "World temporarily unavailable" } }));
  await page.goto("/ext/mobile.html");
  await expect(page.getByRole("alert")).toHaveText("World temporarily unavailable");
  await expect(page.getByRole("button", { name: "Join the raid" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 850 });
  await page.screenshot({ path: `artifacts/extension-unavailable-${info.project.name}.png` });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});
