import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

test("two browser players build a persistent supported tower, respect removals and see each other's edits", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Two-session construction runs once in isolated QA database",
  );
  test.setTimeout(120000); // Two rendered sessions + full axe scan measured ~75 s; allow bounded context cleanup.
  const founder = await browser.newContext({
      baseURL: "http://127.0.0.1:3401",
    }),
    contributor = await browser.newContext({
      baseURL: "http://127.0.0.1:3401",
    });
  const a = await founder.newPage(),
    b = await contributor.newPage();
  try {
    await a.goto("/dashboard");
    await a.getByRole("button", { name: "Try creator simulator" }).click();
    await expect(a.locator("#config-form")).toBeVisible();
    await a.locator('input[name="construction"]').check();
    await a.locator('input[name="paused"]').uncheck();
    await a.getByRole("button", { name: "Save world settings" }).click();
    await expect(a.locator("#toast")).toContainText("saved");
    await a.goto("/workshop?room=demo-world");
    await a
      .locator('#workshop-create input[name="title"]')
      .fill("Our shared watchtower");
    await a
      .getByRole("button", { name: "Create community structure", exact: true })
      .click();
    await expect(a.locator("#building-details")).toContainText("Revision 1");
    const login = await contributor.request.post("/v1/demo/session", {
      headers: { origin: "http://127.0.0.1:3401" },
      data: { persona: "second" },
    });
    expect(login.status()).toBe(200);
    await b.goto("/workshop?room=demo-world");
    await expect(b.locator("#building-details")).toContainText(
      "Our shared watchtower",
    );
    await b
      .locator('#workshop-edit select[name="material"]')
      .selectOption("moss");
    await b.getByRole("button", { name: "Place block", exact: true }).click();
    await expect(a.locator("#building-details")).toContainText("Revision 2");
    await a.bringToFront();
    await a.locator('#workshop-edit input[name="y"]').fill("2");
    await a
      .locator('#workshop-edit select[name="material"]')
      .selectOption("amethyst");
    await a.getByRole("button", { name: "Place block", exact: true }).click();
    await expect(b.locator("#building-details")).toContainText("Revision 3");
    await a.reload();
    await expect(a.locator("#building-details")).toContainText("3/64 blocks");
    await expect(a.locator("#stage")).toHaveAttribute(
      "data-structure-blocks",
      "3",
    );
    const accessibility = await new AxeBuilder({ page: a })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await a.screenshot({
      path: "artifacts/chromium-community-workshop.png",
      fullPage: true,
    });
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await a.setViewportSize({ width: 390, height: 844 });
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await a.screenshot({
      path: "artifacts/mobile-community-workshop.png",
      fullPage: true,
    });
    await a.setViewportSize({ width: 1280, height: 720 });
    await b.bringToFront();
    await b
      .getByRole("button", { name: "Remove my block", exact: true })
      .click();
    await expect(b.locator("#toast")).toContainText("above");
    await a.bringToFront();
    await a.locator('#workshop-edit input[name="y"]').fill("2");
    await a
      .getByRole("button", { name: "Remove my block", exact: true })
      .click();
    await expect(b.locator("#building-details")).toContainText("2/64 blocks");
    await b.bringToFront();
    await b
      .getByRole("button", { name: "Remove my block", exact: true })
      .click();
    await expect(a.locator("#building-details")).toContainText("1/64 blocks");
    const snapshot = await (
      await a.request.get("/v1/worlds/demo-world")
    ).json();
    await writeFile(
      "artifacts/construction-browser.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          scope:
            "Two actual browser sessions, HTTP persistence and WebSocket updates; synthetic world",
          structures: snapshot.structures,
          accessibilityViolations: accessibility.violations,
        },
        null,
        2,
      ),
    );
    await a.bringToFront();
    await a
      .getByRole("button", { name: "Remove entire structure", exact: true })
      .click();
    await expect(b.locator("#building-details")).toContainText(
      "No structures yet",
    );
  } finally {
    await Promise.allSettled([founder.close(), contributor.close()]);
  }
});
