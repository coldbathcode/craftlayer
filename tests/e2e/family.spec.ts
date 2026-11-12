import { expect, type Page, type Route, test } from "@playwright/test";
import {
  agentRequestPage,
  agentTokenCreatedSchema,
  agentTokenSchema,
  authoritySchema,
  backupListView,
  backupPolicyView,
  backupRequestAccepted,
  backupStatusView,
  knockAllowed,
  knockPage,
  memberSchema,
  meSchema,
  serverActionAccepted,
  serverActionPage,
  serverActionView,
  serverLiveView,
  serverPage,
} from "../../packages/contracts/src/index.js";

if (process.env.CRAFTLAYER_FAMILY_E2E !== "1")
  throw new Error(
    "Run pnpm test:family-ui: the family screens are tested against a stand-in API.",
  );
/**
 * Family screens (master plan B2) in a real browser against a stand-in API. Every
 * answer the stand-in gives is first checked against the real contract, so a screen
 * that passes here reads what the API really sends. What this does not prove is the
 * API itself: that is covered by the database suite.
 */
const org = "00000000-0000-4000-8000-000000000001",
  project = "00000000-0000-4000-8000-000000000002",
  world = "00000000-0000-4000-8000-000000000003",
  server = "00000000-0000-4000-8000-000000000004",
  knock = "00000000-0000-4000-8000-000000000005",
  user = "00000000-0000-4000-8000-000000000006",
  session = "00000000-0000-4000-8000-000000000007",
  policy = "00000000-0000-4000-8000-000000000008";
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
interface World {
  role: "manager" | "watcher" | "child" | "signed-out";
  power: "on" | "off";
  players: string[];
  allowed: string[];
  knocking: boolean;
  nightly: string | null;
  backupOpen: boolean;
  actions: Array<ReturnType<typeof serverActionView.parse>>;
  helpers: Array<ReturnType<typeof agentTokenSchema.parse>>;
  asking: "pending" | "approved" | "declined";
  calls: string[];
}
const helperKey = `cla_${"k".repeat(43)}`;
function action(kind: string, request: unknown, n: number) {
  const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  return serverActionView.parse({
    id,
    server_id: server,
    operation_id: id,
    kind,
    request,
    state: "succeeded",
    failure_code: "none",
    fence: n,
    evidence: { ok: true, evidence: "ok" },
    created_at: iso(2000),
    expires_at: iso(-600000),
    dispatched_at: iso(1500),
    finished_at: iso(1000),
    awaiting_node: false,
    can_cancel: false,
  });
}
async function standIn(page: Page, start: Partial<World> = {}) {
  const w: World = {
    role: "manager",
    power: "on",
    players: ["Alex", ".Charlie_B"],
    allowed: ["Alex", ".Charlie_B"],
    knocking: true,
    nightly: null,
    backupOpen: false,
    actions: [],
    helpers: [],
    asking: "pending",
    calls: [],
    ...start,
  };
  const manager = () => w.role === "manager";
  const policyView = () =>
    w.nightly
      ? backupPolicyView.parse({
          server_id: server,
          policy_id: policy,
          revision: 1,
          timezone: "Europe/London",
          local_time: w.nightly,
          retention_days: 14,
          offhost_weekday: 0,
          enabled: true,
          created_at: iso(),
          schedule: {
            status: "current",
            due_local_date: null,
            missed: 0,
            next_scheduled_at: null,
          },
          health: {
            local: "none",
            offhost: "none",
            restore: "none",
            last_restore_tested_at: null,
            recovery_point_age_ms: null,
          },
          family_ready: false,
        })
      : null;
  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", ""),
      method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const deny = (status: number, code: string) =>
      json({ error: { code, message: "Denied.", request_id: "test" } }, status);
    if (method !== "GET") {
      w.calls.push(`${method} ${path} ${request.postData() ?? ""}`.trim());
      // The browser must send the session's proof with every change.
      if (!request.headers()["x-csrf-token"]) return deny(403, "CSRF");
      if (!manager()) return deny(403, "FORBIDDEN");
    }
    if (w.role === "signed-out") return deny(401, "UNAUTHENTICATED");
    if (path === "/auth/me")
      return json(
        meSchema.parse({
          user: {
            id: user,
            login: "oli",
            account_type: w.role === "child" ? "child" : "adult",
            email: null,
          },
          organizations: [{ id: org, name: "The Family" }],
          instance_owner: manager(),
          current_session_id: session,
          csrf_token: "c".repeat(43),
          mfa: { enrolled: true, pending: false, required: true },
        }),
      );
    if (path === "/auth/authority")
      return json(
        authoritySchema.parse({
          account_type: "adult",
          membership_version: 1,
          roles: [manager() ? "org_admin" : "viewer"],
          permissions: manager()
            ? ["server:read", "player:manage", "server:control"]
            : ["server:read"],
          can_manage_members: manager(),
          can_manage_roles: manager(),
          can_create_projects: manager(),
          can_manage_environments: manager(),
          can_invite: manager(),
          can_read_audit: manager(),
        }),
      );
    if (path === "/environments")
      return json({
        items: [
          { id: world, name: "Family", project_id: project, type: "minecraft" },
        ],
      });
    if (path === "/servers")
      return json(
        serverPage.parse({
          items: [
            {
              id: server,
              project_id: project,
              environment_id: world,
              name: "Family Survival",
              management_mode: "adopted_read_only",
              registered: true,
              version: 1,
              target_id: "family",
              observation: {
                source: "captured_inventory",
                observed_at: iso(),
                state: "online",
                java: null,
                bedrock: { host: "play.example.invalid", port: 19133 },
                online_authentication: true,
                allowlist_enabled: true,
                enforce_allowlist: true,
                rcon_public: false,
                backup_verified: false,
                identity_verified: false,
                freshness: "fresh",
                player_count: 0,
                family_ready: false,
              },
              can_observe: manager(),
              can_unregister: manager(),
            },
          ],
          next_cursor: null,
        }),
      );
    const base = `/servers/${server}`;
    if (path === `${base}/live`)
      return json(
        serverLiveView.parse({
          server_id: server,
          host_bound: true,
          power: w.power,
          fresh: true,
          reported_at: iso(3000),
          online: w.power === "on" ? w.players.length : null,
          max_players: 5,
          players: w.power === "on" ? w.players : null,
          allowed: w.allowed,
        }),
      );
    const asking = {
      id: knock,
      server_id: server,
      name: ".Big_Crazy_Pickle",
      edition: "bedrock",
      first_at: iso(180000),
      last_at: iso(120000),
      attempts: 2,
      state: "asking",
      can_decide: manager(),
    };
    if (path === `${base}/knocks`)
      return json(
        knockPage.parse({
          server_id: server,
          items: w.knocking ? [asking] : [],
        }),
      );
    if (path === `/server-knocks/${knock}/allow` && method === "POST") {
      w.knocking = false;
      w.allowed.push(".Big_Crazy_Pickle");
      return json(
        knockAllowed.parse({
          knock: { ...asking, state: "allowed", can_decide: false },
          action: {
            action_id: project,
            operation_id: project,
            server_id: server,
            state: "pending",
            awaiting_node: false,
          },
        }),
        202,
      );
    }
    if (path === `${base}/actions` && method === "POST") {
      const body = request.postDataJSON() as { kind: string; name?: string };
      const done = action(body.kind, body, w.actions.length + 1);
      w.actions.unshift(done);
      if (body.kind === "stop") w.power = "off";
      if (body.kind === "start" || body.kind === "restart") w.power = "on";
      if (body.kind === "kick_player")
        w.players = w.players.filter((p) => p !== body.name);
      if (body.kind === "revoke_player")
        w.allowed = w.allowed.filter((p) => p !== body.name);
      return json(
        serverActionAccepted.parse({
          action_id: done.id,
          operation_id: done.operation_id,
          server_id: server,
          state: "pending",
          awaiting_node: false,
        }),
        202,
      );
    }
    if (path === `${base}/actions`)
      return json(
        serverActionPage.parse({ server_id: server, items: w.actions }),
      );
    const one = /^\/server-actions\/([0-9a-f-]+)$/.exec(path);
    if (one) {
      const found = w.actions.find((a) => a.id === one[1]);
      return found ? json(found) : deny(404, "NOT_FOUND");
    }
    if (path === `${base}/backup-status`)
      return json(
        backupStatusView.parse({
          server_id: server,
          policy: policyView(),
          open_occurrence: w.backupOpen ? policy : null,
          can_manage: manager(),
        }),
      );
    if (path === `${base}/backup-policy` && method === "PUT") {
      w.nightly = (request.postDataJSON() as { local_time: string }).local_time;
      return json(policyView());
    }
    if (path === `${base}/backups` && method === "POST") {
      w.backupOpen = true;
      return json(
        backupRequestAccepted.parse({
          operation_id: policy,
          occurrence_id: policy,
          server_id: server,
          state: "pending",
        }),
        202,
      );
    }
    if (path === `${base}/backups`)
      return json(
        backupListView.parse({
          server_id: server,
          items: [],
          retention: { keep: [], expire: [] },
        }),
      );
    const helperRequest = {
      id: knock,
      server_id: server,
      agent_id: policy,
      agent_name: "Claude on the laptop",
      kind: "say",
      request: { kind: "say", message: "Dinner in ten minutes" },
      reason: "<b>You asked me to tell everyone</b>",
      state: w.asking,
      decided_at: w.asking === "pending" ? null : iso(),
      note: null,
      action_id: null,
      created_at: iso(60000),
      expires_at: iso(-600000),
      can_decide: manager() && w.asking === "pending",
    };
    if (path === `${base}/agent-requests`)
      return json(
        agentRequestPage.parse({ server_id: server, items: [helperRequest] }),
      );
    if (path === `/agent-requests/${knock}/decide` && method === "POST") {
      w.asking =
        (request.postDataJSON() as { decision: string }).decision === "approve"
          ? "approved"
          : "declined";
      return json({
        ...helperRequest,
        state: w.asking,
        decided_at: iso(),
        can_decide: false,
      });
    }
    if (path === "/memberships")
      return manager()
        ? json({
            items: [
              ["oli", user, "adult", ["org_admin"]],
              ["gran", session, "adult", ["viewer"]],
              ["alex", project, "child", ["child"]],
            ].map(([login, id, type, roles]) =>
              memberSchema.parse({
                id,
                user_id: id,
                login,
                account_type: type,
                disabled_at: null,
                user_disabled_at: null,
                roles,
              }),
            ),
          })
        : deny(403, "FORBIDDEN");
    if (path === "/agent-tokens" && method === "POST") {
      const body = request.postDataJSON() as {
        name: string;
        permissions: string[];
        mayRequest?: string[];
        expiresInDays?: number;
      };
      const made = agentTokenSchema.parse({
        id: world,
        name: body.name,
        permissions: body.permissions,
        may_request: body.mayRequest ?? [],
        project_id: project,
        environment_id: world,
        created_by: user,
        created_at: iso(),
        expires_at: iso(-(body.expiresInDays ?? 30) * 86400000),
        last_used_at: null,
        revoked_at: null,
        state: "active",
      });
      w.helpers.push(made);
      return json(
        agentTokenCreatedSchema.parse({
          id: made.id,
          name: made.name,
          token: helperKey,
          permissions: made.permissions,
          may_request: made.may_request,
          project_id: project,
          environment_id: world,
          expires_at: made.expires_at,
        }),
      );
    }
    if (path === `/agent-tokens/${world}` && method === "DELETE") {
      w.helpers = [];
      return json({ ok: true });
    }
    if (path === "/agent-tokens")
      return manager() ? json({ items: w.helpers }) : deny(403, "FORBIDDEN");
    return deny(404, "NOT_FOUND");
  });
  return w;
}
/** With CRAFTLAYER_FAMILY_SHOTS set to a folder, keeps a picture of each screen. */
async function shot(page: Page, name: string) {
  const folder = process.env.CRAFTLAYER_FAMILY_SHOTS;
  if (!folder) return;
  const size = page.viewportSize();
  await page.screenshot({
    path: `${folder}/${name}-${size && size.width < 600 ? "phone" : "desktop"}.png`,
    fullPage: true,
  });
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Every button and tab is at least a thumb wide and tall (B1: 44 px).
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll(".fam-button, .fam-tab, .fam-nav a")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44)).length,
  );
  expect(small).toBe(0);
}
test("a manager sees who is playing, lets a knocker in and turns the server off and on", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const w = await standIn(page);
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Family Survival" }),
  ).toBeVisible();
  await expect(page.getByText("2 playing — Alex, Charlie B")).toBeVisible();
  await expect(page.getByText("Last backup: none yet")).toBeVisible();
  await expect(
    page.getByText("Big Crazy Pickle is asking to join Family Survival."),
  ).toBeVisible();
  // Every section is reachable from the menu, on a phone as well.
  for (const name of ["Home", "Family", "AI helpers", "Advanced"])
    await expect(
      page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name }),
    ).toBeVisible();
  await fits(page);
  await shot(page, "home");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(
    page.getByText("Big Crazy Pickle can join Family Survival now."),
  ).toBeVisible();
  expect(w.calls.some((c) => c.includes(`/server-knocks/${knock}/allow`))).toBe(
    true,
  );
  // Turning off asks first, in plain words, and names who will be disconnected.
  await page.getByRole("button", { name: "Turn off" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Turn off Family Survival?");
  await expect(dialog).toContainText(
    "Alex and Charlie B will be disconnected.",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(w.calls.filter((c) => c.includes("/actions"))).toEqual([]);
  await page.getByRole("button", { name: "Turn off" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Turn off" })
    .click();
  await expect(
    page.getByText("Family Survival is off. The world was saved."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Family Survival is on.")).toBeVisible();
  expect(
    w.calls.filter((c) => c.includes("/actions")).map((c) => c.split(" ")[2]),
  ).toEqual(['{"kind":"stop"}', '{"kind":"start"}']);
  expect(errors).toEqual([]);
});
test("the server screen kicks, removes, adds, restarts, backs up and explains how to join", async ({
  page,
}) => {
  const w = await standIn(page, { knocking: false });
  await page.goto(`/home#/server/${server}/players`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Family Survival" }),
  ).toBeVisible();
  await shot(page, "players");
  const playing = page.locator("section", { hasText: "Playing now" });
  await expect(
    playing.locator("strong", { hasText: "Charlie B" }),
  ).toBeVisible();
  await playing.getByRole("button", { name: "Kick Charlie B" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "They stay on the list and can rejoin.",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Kick" }).click();
  await expect(page.getByText("Charlie B was disconnected.")).toBeVisible();
  await expect(playing.locator("strong", { hasText: "Charlie B" })).toHaveCount(
    0,
  );
  const list = page.locator("section", { hasText: "Can join" });
  await list.getByRole("button", { name: "Remove Alex" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText("Alex can no longer join.")).toBeVisible();
  // Adding an iPad player never asks for an account number: they knock instead.
  await page.getByRole("button", { name: "+ Add a player" }).click();
  await expect(page.getByText("Ask them to try joining once.")).toBeVisible();
  await page.getByLabel("Computer (Java)").check();
  await page.getByLabel("Minecraft name").fill("bad name");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("A Minecraft name is up to 16")).toBeVisible();
  await page.getByLabel("Minecraft name").fill("Grandma_42");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Grandma_42 can join now.")).toBeVisible();
  expect(
    w.calls.filter((c) => c.includes("/actions")).map((c) => c.split(" ")[2]),
  ).toEqual([
    '{"kind":"kick_player","name":".Charlie_B"}',
    '{"kind":"revoke_player","name":"Alex"}',
    '{"kind":"allow_player","player":{"edition":"java","name":"Grandma_42"}}',
  ]);
  await fits(page);

  await page.getByRole("button", { name: "Power" }).click();
  await page.getByRole("button", { name: "Restart" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Restart" })
    .click();
  await expect(
    page.getByText("Family Survival restarted and is on."),
  ).toBeVisible();
  await expect(page.getByText("Restarted just now")).toBeVisible();
  await fits(page);

  await page.getByRole("button", { name: "Backups" }).click();
  await expect(
    page.getByText("Nightly backups are not turned on"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back up now" })).toHaveCount(
    0,
  );
  await page.getByLabel("Every night at").fill("03:15");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(
    page.getByText("Nightly backups are on, at 03:15 every night."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("A backup is in progress.")).toBeVisible();
  await shot(page, "backups");
  await expect(
    page.getByRole("button", { name: "Back up now" }),
  ).toBeDisabled();
  await fits(page);

  await page.getByRole("button", { name: "How to join" }).click();
  await expect(
    page.getByText("Server address: play.example.invalid   Port: 19133"),
  ).toBeVisible();
  await expect(
    page.getByText("Not available for this server yet."),
  ).toBeVisible();
  await fits(page);
});
test("a watcher sees the same things with nothing to press", async ({
  page,
}) => {
  const w = await standIn(page, { role: "watcher" });
  await page.goto("/home");
  await expect(page.getByText("2 playing — Alex, Charlie B")).toBeVisible();
  await expect(page.getByText("is asking to join")).toBeVisible();
  for (const name of ["Allow", "Turn off", "Turn on"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page.getByRole("button", { name: "Players" }).click();
  await expect(page.getByText("Asking to join")).toBeVisible();
  for (const name of [
    /^Kick/,
    /^Remove/,
    /^Allow/,
    /^Ignore/,
    "+ Add a player",
  ])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page.getByRole("button", { name: "Power" }).click();
  await expect(page.locator(".fam-power")).toContainText("On");
  await expect(page.getByRole("button", { name: "Restart" })).toHaveCount(0);
  await page.getByRole("button", { name: "Backups" }).click();
  await expect(page.getByText("Last backup: none yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Turn on|Back up/ }),
  ).toHaveCount(0);
  expect(w.calls).toEqual([]);
});
test("a child and a signed-out visitor get a plain page and no server details", async ({
  page,
}) => {
  await standIn(page, { role: "child" });
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "This page is for grown-ups" }),
  ).toBeVisible();
  await expect(page.getByText("Family Survival")).toHaveCount(0);
  await page.unrouteAll();
  await standIn(page, { role: "signed-out" });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to see your servers" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/account",
  );
});
test("keyboard users can reach and use every control, and Advanced is one step away", async ({
  page,
}) => {
  await standIn(page, { knocking: false });
  await page.goto("/home");
  await expect(page.getByText("2 playing")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Turn off" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  // Escape closes the question and nothing is sent.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Advanced" }).click();
  await expect(page).toHaveURL(/\/advanced$/);
  await expect(
    page.getByText("Nothing here is needed day to day."),
  ).toBeVisible();
  for (const name of ["Servers console", "Hosts", "Account and access"])
    await expect(page.getByRole("heading", { name })).toBeVisible();
});
test("a manager sees the family, connects an AI helper with a key shown once, and answers its request", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const w = await standIn(page, { knocking: false });
  await page.goto("/home#/family");
  for (const group of ["Managers", "Watchers", "Children"])
    await expect(page.getByRole("heading", { name: group })).toBeVisible();
  await expect(page.getByText("oli (you)")).toBeVisible();
  await expect(page.getByText("gran")).toBeVisible();
  // Internal role names never reach the screen.
  await expect(page.getByText(/org_admin|viewer/)).toHaveCount(0);
  await fits(page);
  await shot(page, "family");

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "AI helpers" })
    .click();
  // The helper's own words are shown as text, never run as markup.
  await expect(
    page.getByText("Claude on the laptop asks:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("<b>You asked me to tell everyone</b>", { exact: false }),
  ).toBeVisible();
  await shot(page, "helpers");
  await page.getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByText(/^Approved/)).toBeVisible();
  expect(w.asking).toBe("approved");

  await page.getByRole("button", { name: "+ Connect an AI helper" }).click();
  await page.getByLabel("Name").fill("Claude on my phone");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".fam-key")).toHaveText(helperKey);
  const sent = w.calls.find((c) => c.startsWith("POST /agent-tokens"));
  // Read only unless a manager ticks something: nothing it may ask for by default.
  expect(
    JSON.parse(sent?.slice("POST /agent-tokens ".length) ?? "{}"),
  ).toMatchObject({ name: "Claude on my phone", projectId: project });
  expect(sent).not.toContain('"mayRequest":["');
  await fits(page);
  await page.getByRole("button", { name: "I've saved it" }).click();
  await expect(page.locator(".fam-key")).toHaveCount(0);
  expect(await page.content()).not.toContain(helperKey);
  await expect(page.getByText("Claude on my phone").first()).toBeVisible();
  await page.getByRole("button", { name: /^Revoke/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Revoke/ })
    .click();
  expect(w.calls.some((c) => c.startsWith("DELETE /agent-tokens/"))).toBe(true);
  expect(errors).toEqual([]);
});
test("a watcher can see what a helper is asking but cannot answer or connect one", async ({
  page,
}) => {
  const w = await standIn(page, { role: "watcher", knocking: false });
  await page.goto("/home#/helpers");
  await expect(
    page.getByText("Claude on the laptop asks:", { exact: false }),
  ).toBeVisible();
  for (const name of [/^Approve/, /^No/, "+ Connect an AI helper", /^Revoke/])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Family" })
    .click();
  await expect(
    page.getByText("Only a manager can see everyone here."),
  ).toBeVisible();
  expect(w.calls).toEqual([]);
});
