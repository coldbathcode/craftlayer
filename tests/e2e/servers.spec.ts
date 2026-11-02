import { execFileSync } from "node:child_process";
import { chmod, rm, writeFile } from "node:fs/promises";
import { type APIRequestContext, expect, test } from "@playwright/test";

test("isolated parent dashboard observes without game controls and clears revoked scope", async ({
  page,
  browser,
}, info) => {
  test.skip(
    process.env.CRAFTLAYER_SERVER_E2E !== "1",
    "Requires disposable server installation",
  );
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  const origin = process.env.CRAFTLAYER_TEST_URL ?? "",
    path = process.env.CRAFTLAYER_E2E_INVENTORY_PATH;
  if (!path || !origin)
    throw new Error("Disposable inventory and origin required");
  const errors: string[] = [],
    external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external.push(url.origin);
      await route.abort();
    } else await route.continue();
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const password = "Server fixture password 42!";
  async function post(
    request: APIRequestContext,
    route: string,
    data: unknown,
    csrf = "",
    organization = "",
  ) {
    const r = await request.post(`/api/v1${route}`, {
      data,
      headers: {
        origin,
        "x-csrf-token": csrf,
        "x-craftlayer-organization": organization,
      },
    });
    expect(r.ok(), `${route}: ${r.status()}`).toBe(true);
    return r.json();
  }
  await page.goto("/servers");
  await expect(
    page.getByRole("heading", { name: "Sign in to see your servers." }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(
        "/api/v1/servers?environment_id=11111111-1111-4111-8111-111111111111",
        {
          headers: {
            "x-craftlayer-organization": "11111111-1111-4111-8111-111111111111",
          },
        },
      )
    ).status(),
  ).toBe(401);
  await post(page.request, "/auth/bootstrap", {
    token: process.env.CRAFTLAYER_E2E_BOOTSTRAP_TOKEN,
    login: "server-owner",
    password,
  });
  const me = await (await page.request.get("/api/v1/auth/me")).json(),
    org = me.organizations[0].id,
    csrf = me.csrf_token;
  const project = await post(
    page.request,
    "/projects",
    { name: "Family project" },
    csrf,
    org,
  );
  const world = await post(
    page.request,
    "/environments",
    { name: "Family world", type: "minecraft", projectId: project.id },
    csrf,
    org,
  );
  const observation = {
    observed_at: new Date(Date.now() - 120_000).toISOString(),
    state: "offline",
    data_kind: "synthetic",
    java: { host: "play.example.invalid", port: 25565 },
    bedrock: { host: "play.example.invalid", port: 19132 },
    players: null,
    online_authentication: true,
    allowlist_enabled: true,
    enforce_allowlist: true,
    rcon_public: false,
    backup_verified: false,
    identity_verified: false,
  };
  const target = {
    id: "family",
    organization_id: org,
    environment_id: world.id,
    label: "Approved family capture",
    binding_hash: "a".repeat(64),
    observation,
  };
  const capture = async (o: unknown) =>
    writeFile(
      path,
      JSON.stringify({
        schema_version: 1,
        targets: [{ ...target, observation: o }],
      }),
    );
  await capture(observation);
  await page.reload();
  await expect(page.getByLabel("Approved source")).toBeVisible();
  await page.getByLabel("Display name").fill("Family survival");
  await page.getByRole("button", { name: "Preview registration" }).click();
  await expect(
    page.getByText("Ready to register Family survival"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Register existing server" }).click();
  await expect(
    page.getByRole("heading", { name: "Family survival", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".server-detail-heading .server-state")).toHaveText(
    "Stale observation",
  );
  await expect(
    page.getByText("Family readiness has not been verified.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("play.example.invalid:25565", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("adopted read only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^(Start|Stop|Restart|Restore|Create server)$/i,
    }),
  ).toHaveCount(0);
  await capture({
    ...observation,
    state: "online",
    observed_at: new Date().toISOString(),
    players: [{ name: "FixturePlayer", edition: "java" }],
  });
  await page.getByRole("button", { name: "Observe approved source" }).click();
  await expect(page.getByText("FixturePlayer", { exact: false })).toBeVisible();
  await expect(page.locator(".server-detail-heading .server-state")).toHaveText(
    "Observed online",
  );
  await expect(
    page.getByText("observation recorded", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("LOCAL PROTOTYPE · SIMULATED SERVER", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Game edition").selectOption("java");
  await page.getByLabel("Player name", { exact: true }).fill("BrowserRequest");
  await page.getByRole("button", { name: "Request identity check" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "no game access granted" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".server-enrollment-list")
      .getByText("BrowserRequest", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".server-enrollment-list")
      .getByText("Pending · no access", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Account", exact: true }).focus();
  await page.screenshot({
    path: info.outputPath("servers-desktop.png"),
    fullPage: true,
  });
  // Optional local agent-browser inspection uses only this synthetic session; remove auth state even on failure.
  if (process.env.CRAFTLAYER_BROWSER_REVIEW === "1") {
    const state = info.outputPath("browser-state.json"),
      session = `craftlayer-f1-${process.pid}`;
    await page.context().storageState({ path: state });
    await chmod(state, 0o600);
    const cli = (args: string[]) =>
      execFileSync("agent-browser", ["--session", session, ...args], {
        encoding: "utf8",
        timeout: 30_000,
      });
    try {
      cli(["--state", state, "open", `${origin}/servers`]);
      console.log(cli(["snapshot", "-i"]));
      cli(["wait", "--text", "Family survival"]);
      console.log(cli(["snapshot", "-i"]));
      cli([
        "screenshot",
        info.outputPath("servers-agent-browser.png"),
        "--full",
      ]);
    } finally {
      try {
        cli(["close"]);
      } finally {
        await rm(state, { force: true });
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/servers");
  await expect(
    page.getByRole("heading", { name: "Family survival", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to server overview" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#server-content$/);
  await page.getByRole("link", { name: "Account", exact: true }).focus();
  await page.screenshot({
    path: info.outputPath("servers-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  // A broken source must preserve the last snapshot and never claim a successful update.
  await writeFile(path, "invalid JSON");
  await page.getByRole("button", { name: "Observe approved source" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "prior snapshot is preserved" }),
  ).toBeVisible();
  await expect(page.getByText("FixturePlayer", { exact: false })).toBeVisible();
  await capture({
    ...observation,
    state: "online",
    observed_at: new Date().toISOString(),
    players: [{ name: "FixturePlayer", edition: "java" }],
  });
  await post(
    page.request,
    "/children",
    { login: "server-child", password, environmentIds: [world.id] },
    csrf,
    org,
  );
  const childContext = await browser.newContext({ baseURL: origin }),
    child = await childContext.newPage();
  await post(child.request, "/auth/login", { login: "server-child", password });
  await child.goto("/servers");
  await expect(
    child.getByRole("heading", { name: "Managed by your adult." }),
  ).toBeVisible();
  expect(
    (
      await child.request.get(`/api/v1/servers?environment_id=${world.id}`, {
        headers: { "x-craftlayer-organization": org },
      })
    ).status(),
  ).toBe(403);
  await expect(
    child.getByRole("button", { name: "Observe approved source" }),
  ).toHaveCount(0);
  await childContext.close();
  // Viewer must receive explicit server/player grants and has no adoption or observation controls.
  const roles = await (
    await page.request.get("/api/v1/roles", {
      headers: { "x-craftlayer-organization": org },
    })
  ).json();
  const invitation = await post(
    page.request,
    "/invitations",
    {
      roleId: roles.items.find((r: { name: string }) => r.name === "viewer").id,
    },
    csrf,
    org,
  );
  const viewerContext = await browser.newContext({ baseURL: origin }),
    viewer = await viewerContext.newPage();
  await post(viewer.request, "/invitations/consume", {
    mode: "new",
    token: invitation.token,
    login: "server-viewer",
    password,
  });
  const members = await (
    await page.request.get("/api/v1/memberships", {
      headers: { "x-craftlayer-organization": org },
    })
  ).json();
  const membership = members.items.find(
    (m: { login: string }) => m.login === "server-viewer",
  );
  for (const permission of [
    "environment:read",
    "server:read",
    "player:read",
    "operation:read",
  ])
    await post(
      page.request,
      "/resource-grants",
      {
        membershipId: membership.id,
        permission,
        projectId: project.id,
        environmentId: world.id,
      },
      csrf,
      org,
    );
  await viewer.goto("/servers");
  await expect(
    viewer.getByRole("heading", { name: "Family survival", exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByText("FixturePlayer", { exact: false }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Observe approved source" }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("button", { name: "Request identity check" }),
  ).toHaveCount(0);
  await expect(
    viewer.getByRole("heading", { name: "Adopt existing" }),
  ).toHaveCount(0);
  await expect(
    viewer.getByText("Audit history requires an administrator’s permission."),
  ).toBeVisible();
  await viewerContext.close();
  const other = await post(
    page.request,
    "/organizations",
    { name: "Other family" },
    csrf,
  );
  const otherProject = await post(
    page.request,
    "/projects",
    { name: "Other project" },
    csrf,
    other.id,
  );
  await post(
    page.request,
    "/environments",
    { name: "Other world", projectId: otherProject.id, type: "minecraft" },
    csrf,
    other.id,
  );
  await page.reload();
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(other.id);
  await expect(
    page.getByText("No server registered in this world yet."),
  ).toBeVisible();
  await expect(page.getByText("BrowserRequest", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("FixturePlayer", { exact: false })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Family survival", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(org);
  await expect(
    page.getByRole("heading", { name: "Family survival", exact: true }),
  ).toBeVisible();
  await page.getByText("Registration settings", { exact: true }).click();
  const remove = page.getByRole("button", { name: "Remove registration only" });
  await expect(remove).toBeDisabled();
  await page
    .getByLabel("Type Family survival to confirm")
    .fill("Family survival");
  await remove.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Registration removed." }),
  ).toBeVisible();
  await expect(page.locator(".server-detail-heading .server-state")).toHaveText(
    "Registration removed",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account");
  const serversLink = page.getByRole("link", { name: "Servers", exact: true });
  await expect(serversLink).toBeVisible();
  await serversLink.click();
  await expect(
    page.getByRole("heading", { name: "Family survival", exact: true }),
  ).toBeVisible();
  await post(page.request, "/auth/logout", {}, csrf, org);
  // A detail read may detect logout before a manual refresh can be clicked.
  // Otherwise the next 30s metadata poll must clear the session without interaction.
  await expect(
    page.getByRole("heading", { name: "Sign in to see your servers." }),
  ).toBeVisible({ timeout: 35_000 });
  await expect(page.getByText("FixturePlayer", { exact: false })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
