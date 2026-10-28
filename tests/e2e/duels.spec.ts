import { test, expect } from "@playwright/test";
test("two consenting browser players take turns in a friendly wizard duel", async ({
  browser,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Social two-session flow runs once against isolated QA server",
  );
  test.setTimeout(90000); // Includes provisioning and rendering two browser contexts on a shared workstation.
  const contextA = await browser.newContext(),
    contextB = await browser.newContext();
  try {
    const a = await contextA.newPage(),
      b = await contextB.newPage();
    await a.bringToFront();
    await a.goto("http://127.0.0.1:3401/controller");
    await a.getByRole("button", { name: "Try viewer simulator" }).click();
    await b.bringToFront();
    await b.goto("http://127.0.0.1:3401/dashboard");
    await b.getByRole("button", { name: "Try creator simulator" }).click();
    await b.goto("http://127.0.0.1:3401/controller");
    await a.bringToFront();
    await expect(a.locator("#party-target option")).toHaveCount(2);
    await a.locator("#party-target").selectOption({ index: 1 });
    await a.locator("#party-kind").selectOption("duel");
    await a
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await b.bringToFront();
    await b.getByRole("button", { name: "Check invitations" }).click();
    const acceptance = b.waitForResponse(
      (response) =>
        /\/v1\/parties\/[^/]+\/accept$/.test(response.url()) &&
        response.request().method() === "POST",
    );
    await b.getByRole("button", { name: "Accept duel invitation" }).click();
    const accepted = await acceptance;
    expect(accepted.status(), await accepted.text()).toBe(200);
    const authoritative = await (
      await a.request.get("http://127.0.0.1:3401/v1/worlds/demo-world")
    ).json();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      "artifacts/duel-sync.json",
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          tick: authoritative.tick,
          duels: authoritative.duels,
          avatarIds: authoritative.avatars.map((actor: any) => actor.id),
        },
        null,
        2,
      ),
    );
    expect(
      authoritative.duels.some((duel: any) => duel.status === "active"),
    ).toBe(true);
    await a.bringToFront();
    await expect(a.locator("#duel-panel")).toContainText("Your turn");
    await expect(
      b.locator('#duel-panel button[data-duel-move="cast"]'),
    ).toBeDisabled();
    await a.locator('#duel-panel button[data-duel-move="charge"]').click();
    await b.bringToFront();
    await expect(b.locator("#duel-panel")).toContainText("Your turn");
    await b.locator('#duel-panel button[data-duel-move="shield"]').click();
    await a.bringToFront();
    await expect(
      a.locator('#duel-panel button[data-duel-move="cast"]'),
    ).toBeEnabled();
    await a.locator('#duel-panel button[data-duel-move="cast"]').click();
    await b.bringToFront();
    await expect(b.locator("#duel-panel")).toContainText("2/3 hearts");
    await a.bringToFront();
    await a.screenshot({ path: "artifacts/chromium-duel.png", fullPage: true });
    await b.bringToFront();
    await b.locator('#duel-panel button[data-duel-move="leave"]').click();
    await a.bringToFront();
    await expect(a.locator("#duel-panel")).toContainText("Duel cancelled");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
