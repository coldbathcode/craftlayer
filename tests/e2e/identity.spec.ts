import { expect, test } from "@playwright/test";

test("isolated identity journeys enforce adult, child and revoked access", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    process.env.CRAFTLAYER_IDENTITY_E2E !== "1",
    "Requires disposable identity installation",
  );
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const password = "Browser fixture password 42!";
  const form = (title: string) =>
    page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Set up your instance" }),
  ).toBeVisible();
  await page
    .getByLabel("Setup token")
    .fill(process.env.CRAFTLAYER_E2E_BOOTSTRAP_TOKEN ?? "");
  await page.getByLabel("Owner login", { exact: true }).fill("browser-owner");
  await page.getByLabel("Owner password").fill(password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await expect(
    page.getByRole("heading", { name: "People and access" }),
  ).toBeVisible();
  await form("Create project")
    .getByLabel("Project name")
    .fill("Family project");
  await form("Create project").getByRole("button").click();
  await expect(form("Add environment")).toBeVisible();
  await form("Add environment")
    .getByLabel("Environment name")
    .fill("Family world");
  await form("Add environment").getByRole("button").click();
  await expect(form("Create a child account")).toBeVisible();
  await form("Create a child account")
    .getByLabel("Child login")
    .fill("browser-child");
  await form("Create a child account")
    .getByLabel("Child password")
    .fill(password);
  await form("Create a child account").getByRole("button").click();
  await expect(
    page.getByRole("cell", { name: "browser-child child", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-desktop.png"),
    fullPage: true,
  });

  const childContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const child = await childContext.newPage();
  await child.goto("/account");
  await child.getByLabel("Login", { exact: true }).fill("browser-child");
  await child.getByLabel("Password", { exact: true }).fill(password);
  await child.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    child.getByRole("heading", { name: "Your assigned worlds" }),
  ).toBeVisible();
  await expect(child.getByText("Family world", { exact: true })).toBeVisible();
  await expect(
    child.getByRole("heading", { name: "People and access" }),
  ).toHaveCount(0);
  expect(
    await child.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const childMe = await (await child.request.get("/api/v1/auth/me")).json();
  expect(
    (
      await child.request.get("/api/v1/memberships", {
        headers: { "x-craftlayer-organization": childMe.organizations[0].id },
      })
    ).status(),
  ).toBe(403);
  await child.screenshot({
    path: testInfo.outputPath("child-mobile.png"),
    fullPage: true,
  });

  await form("Invite an adult")
    .getByLabel("Invitation role")
    .selectOption({ label: "viewer" });
  await form("Invite an adult").getByRole("button").click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  expect(link).toContain("#invite=");
  const viewerContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  const viewer = await viewerContext.newPage();
  await viewer.goto(link);
  await viewer.getByLabel("Choose a login").fill("browser-viewer");
  await viewer.getByLabel("Choose a password").fill(password);
  await viewer.getByRole("button", { name: "Create account and join" }).click();
  await expect(
    viewer.getByRole("heading", { name: "viewer", exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByText("No environments have been assigned yet."),
  ).toBeVisible();
  expect(new URL(viewer.url()).hash).toBe("");
  await page.getByRole("button", { name: "Refresh access" }).click();
  const row = page.getByRole("row").filter({ hasText: "browser-viewer" });
  await expect(row).toBeVisible();
  const assignment = form("Assign scoped access");
  await assignment
    .getByRole("combobox", { name: "Member", exact: true })
    .selectOption({ label: "browser-viewer" });
  await assignment
    .getByRole("combobox", { name: "Permission", exact: true })
    .selectOption("environment:read");
  await assignment
    .getByLabel("World (optional for adults)")
    .selectOption({ label: "Family world" });
  await assignment.getByRole("button", { name: "Grant access" }).click();
  await expect(
    page.getByText("Scoped access granted.", { exact: true }),
  ).toBeVisible();
  await viewer.getByRole("button", { name: "Refresh access" }).click();
  await expect(viewer.getByText("Family world", { exact: true })).toBeVisible();
  const scopedGrant = page
    .getByRole("listitem")
    .filter({ hasText: "browser-viewer" })
    .filter({ hasText: "environment:read" });
  await scopedGrant.getByRole("button", { name: "Revoke grant" }).click();
  await expect(page.getByText("Grant revoked.", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Refresh access" }).click();
  await expect(
    viewer.getByText("No environments have been assigned yet."),
  ).toBeVisible();
  await row.getByRole("button", { name: "Suspend membership" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Membership updated." }),
  ).toHaveText("Membership updated.");
  await viewer.getByRole("button", { name: "Refresh access" }).click();
  await expect(
    viewer.getByText("You have no active organization membership.", {
      exact: false,
    }),
  ).toBeVisible();

  await expect(
    viewer.getByRole("heading", { name: "Your sessions" }),
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: "Revoke session", exact: true })
    .click();
  await expect(
    viewer.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();

  await form("Reset a child’s password")
    .getByLabel("New child password")
    .fill("New browser child password 43!");
  await form("Reset a child’s password").getByRole("button").click();
  await expect(
    page.getByRole("status").filter({ hasText: "Child password changed;" }),
  ).toHaveText("Child password changed; their existing sessions were revoked.");
  await child.getByRole("button", { name: "Refresh access" }).click();
  await expect(
    child.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await child.getByRole("button", { name: "Forgot your password?" }).click();
  await child.getByLabel("Login or email").fill("browser-child");
  await child
    .getByRole("button", { name: "Request reset", exact: true })
    .click();
  await expect(child.getByRole("status")).toContainText(
    "If email recovery is configured",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(failures).toEqual([]);
  await viewerContext.close();
  await childContext.close();
});
