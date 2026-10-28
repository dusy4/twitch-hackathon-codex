import { test, expect } from "@playwright/test";
test("verified quest earnings buy and equip a cosmetic without reducing lifetime score", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Economy browser flow runs once in the isolated QA database",
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  for (let n = 0; n < 4; n++) {
    await page
      .locator('#quest-form input[name="title"]')
      .fill(`QA dance quest ${n + 1}`);
    await page.locator('#quest-form input[name="minPlayers"]').fill("1");
    await page.locator('#quest-form input[name="reward"]').fill("100");
    await page
      .getByRole("button", { name: "Create virtual quest", exact: true })
      .click();
    await expect(page.locator("#toast")).toContainText("Quest activated");
    await page.waitForTimeout(100);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Connect Twitch", exact: false }).first(),
  ).toBeVisible();
  await page.goto("/controller");
  await page.getByRole("button", { name: "Try viewer simulator" }).click();
  await page.getByRole("button", { name: "dance", exact: true }).click();
  await expect
    .poll(
      async () =>
        Number((await (await page.request.get("/v1/me")).json()).wallet),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(450);
  const before = await (await page.request.get("/v1/me")).json();
  await page.getByRole("link", { name: "The outfitter", exact: true }).click();
  await page.locator('[data-item="violet-mage"]').click();
  await expect(page.locator("#toast")).toContainText("Cosmetic unlocked");
  await page.locator('[data-item="violet-mage"]').click();
  await expect(page.locator("#toast")).toContainText("equipped");
  const after = await (await page.request.get("/v1/me")).json();
  expect(Number(after.wallet)).toBe(Number(before.wallet) - 150);
  expect(Number(after.earned)).toBe(Number(before.earned));
  expect(after.user.cosmetic).toBe("violet-mage");
  await page.locator('[data-item="star-crown"]').click();
  await expect(page.locator("#toast")).toContainText("Cosmetic unlocked");
  await page.locator('[data-item="star-crown"]').click();
  await expect(page.locator("#toast")).toContainText("equipped");
  await page.reload();
  await expect(page.locator("#equipment")).toContainText("skin · Violet mage");
  await expect(page.locator("#equipment")).toContainText("hat · Star crown");
  const equipped = await (await page.request.get("/v1/me")).json();
  expect(equipped.user.equipment).toEqual({
    skin: "violet-mage",
    hat: "star-crown",
  });
  expect(Number(equipped.wallet)).toBe(Number(before.wallet) - 450);
  await page.screenshot({
    path: "artifacts/chromium-equipment.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Remove hat", exact: true }).click();
  await expect(page.locator("#equipment")).toContainText("hat · None");
  expect(
    (await (await page.request.get("/v1/me")).json()).user.equipment,
  ).toEqual({ skin: "violet-mage" });
  // Ownership survives removal, so equipping again costs no Shards.
  await page.locator('[data-item="star-crown"]').click();
  await expect(page.locator("#equipment")).toContainText("hat · Star crown");
  await page.goto(`/players/${after.user.id}`);
  await expect(
    page.getByRole("heading", { name: /Mossling/, level: 1 }),
  ).toBeVisible();
  await expect(page.locator("#avatar-preview")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByRole("button", { name: "Create public share card" }).click();
  await expect
    .poll(() =>
      page
        .locator("#share-card-image")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth === 1200,
        ),
    )
    .toBe(true);
  await page.screenshot({
    path: "artifacts/chromium-share-card.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Revoke existing card links" })
    .click();
  await expect(page.locator("#share-card-result")).toContainText(
    "Existing links revoked",
  );
  await page.screenshot({
    path: "artifacts/chromium-purchased-profile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Meet the factions" }).click();
  await page.locator('[data-faction="moss"]').click();
  await expect(page.locator('[data-faction="moss"]')).toHaveText("Joined");
  expect((await (await page.request.get("/v1/factions")).json()).mine).toBe(
    "moss",
  );
  await page.screenshot({
    path: "artifacts/chromium-factions.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Leave faction" }).click();
  await expect(page.locator('[data-faction="moss"]')).toHaveText(
    "Join faction",
  );
  expect(
    (await (await page.request.get("/v1/factions")).json()).mine,
  ).toBeNull();
});
