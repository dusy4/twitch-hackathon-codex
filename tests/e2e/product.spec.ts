import { test, expect } from "@playwright/test";
test("public website, working simulation, authoritative quest reward and leaderboard", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your stream/ }),
  ).toBeVisible();
  await expect(page.locator("#connection")).toContainText("CONNECTED");
  await expect(page.locator("#stage")).toHaveAttribute("data-rendered", "true");
  await page.screenshot({
    path: `artifacts/${info.project.name}-home.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Enter the world" }).click();
  await expect(page).toHaveURL(/controller/);
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
  await page.getByRole("button", { name: "dance", exact: true }).click();
  await expect(page.locator("#action-feed")).toContainText("dance");
  await page.waitForTimeout(2600);
  await page.screenshot({
    path: `artifacts/${info.project.name}-controller.png`,
    fullPage: true,
  });
  await page.locator("#prompt").fill("wave then jump then bow");
  await page.getByRole("button", { name: "Make it happen" }).click();
  await expect(page.locator("#action-feed")).toContainText("Step 2/3: jump");
  await expect(page.locator("#action-feed")).toContainText("Step 3/3: bow");
  await page.getByRole("link", { name: "Leaderboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Small heroes/ }),
  ).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Mossling");
  await expect(page.locator("tbody")).toContainText("SIMULATOR");
  await page.screenshot({
    path: `artifacts/${info.project.name}-leaderboard.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.locator("tbody")).toContainText("Mossling");
  expect(errors).toEqual([]);
});
test("creator onboarding, OBS token, test raid, privacy and emergency stop", async ({
  page,
}, info) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await expect(
    page.getByRole("heading", { name: "Your world, your rules." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate / rotate overlay URL" })
    .click();
  await expect(page.locator("#overlay-url")).toContainText(
    "/overlay?room=demo-world#token=",
  );
  await page.getByRole("button", { name: "Run a labelled test raid" }).click();
  await page.screenshot({
    path: `artifacts/${info.project.name}-dashboard.png`,
    fullPage: true,
    mask: [page.locator("#overlay-url"), page.locator("#mobile-pairing")],
  });
  const overlay = await page.context().newPage();
  await overlay.goto(
    (await page.locator("#overlay-url").textContent()) as string,
  );
  await expect(overlay.locator("#overlay-status")).toContainText("SIMULATOR");
  await overlay.waitForTimeout(3300);
  await overlay.screenshot({
    path: `artifacts/${info.project.name}-overlay.png`,
    omitBackground: info.project.name !== "firefox",
  });
  await page.getByRole("button", { name: "Emergency stop" }).click();
  await expect(page.locator('input[name="paused"]')).toBeChecked();
  await expect(page.locator('input[name="vision"]')).not.toBeChecked();
  await page.locator('input[name="paused"]').uncheck();
  await page.getByRole("button", { name: "Save world settings" }).click();
  await expect(page.locator("#toast")).toContainText("saved");
  await overlay.close();
});
test("responsive routes, no horizontal overflow, keyboard and missing camera target explanation", async ({
  page,
}, info) => {
  await page.goto("/controller");
  await page.getByRole("button", { name: "Try viewer simulator" }).click();
  await expect(page.locator("#command-form")).toBeVisible();
  await page.locator("#prompt").fill("sprint towards the dog and sit on it");
  await page.getByRole("button", { name: "Make it happen" }).click();
  await expect(page.locator("#toast")).toContainText("Couldn't find");
  await page.locator("#prompt").blur();
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#action-feed")).toContainText("Moving right");
  for (const path of [
    "/quests",
    "/shop",
    "/live",
    "/privacy",
    "/streamers/demo-world",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    expect(overflow, `${path} must fit the viewport`).toBe(false);
    await page.screenshot({
      path: `artifacts/${info.project.name}-${path.slice(1)}.png`,
      fullPage: true,
    });
  }
});
