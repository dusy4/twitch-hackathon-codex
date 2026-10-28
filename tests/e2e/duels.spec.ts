import { test, expect } from "@playwright/test";
test("two consenting browser players take turns in a friendly wizard duel", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Social two-session flow runs once against isolated QA server",
  );
  const contextA = await browser.newContext(),
    contextB = await browser.newContext();
  try {
    const a = await contextA.newPage(),
      b = await contextB.newPage();
    await a.goto("http://127.0.0.1:3401/controller");
    await a.getByRole("button", { name: "Try viewer simulator" }).click();
    await b.goto("http://127.0.0.1:3401/dashboard");
    await b.getByRole("button", { name: "Try creator simulator" }).click();
    await b.goto("http://127.0.0.1:3401/controller");
    await expect(a.locator("#party-target option")).toHaveCount(2);
    await a.locator("#party-target").selectOption({ index: 1 });
    await a.locator("#party-kind").selectOption("duel");
    await a
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await b.getByRole("button", { name: "Check invitations" }).click();
    await b.getByRole("button", { name: "Accept duel invitation" }).click();
    await expect(a.locator("#duel-panel")).toContainText("Your turn");
    await expect(
      b.locator('#duel-panel button[data-duel-move="cast"]'),
    ).toBeDisabled();
    await a.locator('#duel-panel button[data-duel-move="charge"]').click();
    await expect(b.locator("#duel-panel")).toContainText("Your turn");
    await b.locator('#duel-panel button[data-duel-move="shield"]').click();
    await expect(
      a.locator('#duel-panel button[data-duel-move="cast"]'),
    ).toBeEnabled();
    await a.locator('#duel-panel button[data-duel-move="cast"]').click();
    await expect(b.locator("#duel-panel")).toContainText("2/3 hearts");
    await a.screenshot({ path: "artifacts/chromium-duel.png", fullPage: true });
    await b.locator('#duel-panel button[data-duel-move="leave"]').click();
    await expect(a.locator("#duel-panel")).toContainText("Duel cancelled");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
