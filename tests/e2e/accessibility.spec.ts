import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
test("automated WCAG A/AA checks on public pages, viewer controller and creator forms", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Automated DOM accessibility scan runs once",
  );
  test.setTimeout(90000);
  const reports = [];
  for (const path of [
    "/",
    "/leaderboard",
    "/quests",
    "/shop",
    "/live",
    "/privacy",
    "/factions",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    reports.push({
      path,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          failure: n.failureSummary,
        })),
      })),
    });
  }
  await page.goto("/controller");
  await page.getByRole("button", { name: "Try viewer simulator" }).click();
  await expect(page.locator("#command-form")).toBeVisible();
  const viewer = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  reports.push({
    path: "/controller",
    violations: viewer.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        failure: n.failureSummary,
      })),
    })),
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await expect(page.locator("#config-form")).toBeVisible();
  const creator = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  reports.push({
    path: "/dashboard",
    violations: creator.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        failure: n.failureSummary,
      })),
    })),
  });
  await writeFile(
    "artifacts/accessibility.json",
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        scope:
          "Automated WCAG A/AA subset; does not establish full accessibility conformance",
        reports,
      },
      null,
      2,
    ),
  );
  expect(reports.flatMap((r) => r.violations)).toEqual([]);
});
