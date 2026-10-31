import { expect, test } from "@playwright/test";

test("foundation connects through same-origin API without external requests", async ({
  page,
}) => {
  const external: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname)) {
      external.push(u.origin);
      await route.abort();
    } else await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Good thingsare builttogether.",
  );
  await expect(page.getByRole("status")).toHaveText("Core API connected");
  await expect(
    page.getByText("This is the foundation preview.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Explore your foundation" }).click();
  await expect(page).toHaveURL(/#system$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
  const response = await page.request.get("/api/v1/openapi.json");
  expect(response.ok()).toBe(true);
  expect((await response.json()).paths["/health/live"]).toBeTruthy();
});
test("dependency failure is visible and keyboard skip link works", async ({
  page,
}) => {
  await page.route("**/api/v1/system/status", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "not_ready",
        service: "api",
        version: "0.0.0",
      }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Core API unavailable");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});
