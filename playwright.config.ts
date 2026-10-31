import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  outputDir:
    process.env.CRAFTLAYER_IDENTITY_E2E === "1"
      ? "test-results/identity"
      : "test-results/foundation",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder:
          process.env.CRAFTLAYER_IDENTITY_E2E === "1"
            ? "playwright-report/identity"
            : "playwright-report/foundation",
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
