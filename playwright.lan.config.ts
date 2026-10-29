import { defineConfig, devices } from "@playwright/test";
import { lanCandidates, privateIpv4 } from "./apps/api/lan-test.js";
const host = process.env.LAN_TEST_HOST || lanCandidates()[0] || "127.0.0.1";
if (!privateIpv4(host) && host !== "127.0.0.1")
  throw Error("Invalid LAN test host");
const baseURL = `http://${host}:3405`;
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "lan-test.spec.ts",
  timeout: 90000,
  workers: 1,
  webServer: {
    command: `node --import tsx scripts/lan-test.ts --host ${host} --port 3405`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 45000,
  },
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--enable-webgl",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
  ],
});
