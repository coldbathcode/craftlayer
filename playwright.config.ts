import { defineConfig, devices } from "@playwright/test";

const suite =
  process.env.CRAFTLAYER_FAMILY_E2E === "1"
    ? "family"
    : process.env.CRAFTLAYER_SERVER_E2E === "1"
      ? "servers"
      : process.env.CRAFTLAYER_IDENTITY_E2E === "1"
        ? "identity"
        : "foundation";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: `**/${suite}.spec.ts`,
  fullyParallel: true,
  outputDir: `test-results/${suite}`,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `playwright-report/${suite}`,
      },
    ],
  ],
  use: {
    baseURL:
      process.env.CRAFTLAYER_TEST_URL ??
      `http://127.0.0.1:${process.env.CRAFTLAYER_HTTP_PORT ?? 3000}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
