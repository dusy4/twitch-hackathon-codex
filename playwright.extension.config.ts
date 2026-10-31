import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  webServer: {
    command: "node --import tsx scripts/extension-qa-server.ts",
    url: "http://127.0.0.1:3499/health",
    reuseExistingServer: process.env.RAIDRIFT_E2E_EXTERNAL_SERVER === "true",
    timeout: 30000,
  },
  testDir: "tests/e2e",
  outputDir: "test-results-extension",
  testMatch: "extension.spec.ts",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3499",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
