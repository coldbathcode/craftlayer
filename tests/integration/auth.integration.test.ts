import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { Writable } from "node:stream";
import { Queue } from "bullmq";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import { createLogger } from "../../packages/config/src/index.js";
import {
  defaultBudgetLimits,
  defaultInstanceLimits,
  defaultModelPolicy,
  type GenerateRequest,
  type GenerateResult,
  type ModelDescriptor,
} from "../../packages/contracts/src/index.js";
import type { DispatchReference } from "../../packages/contracts/src/runtime.js";
import type { ConnectionRow } from "../../packages/providers/src/connections.js";
import { openCredential } from "../../packages/providers/src/credentials.js";
import {
  FakeProvider,
  fixtureModel,
  fixtureRequest,
} from "../../packages/providers/src/fixtures.js";
import {
  ProviderError,
  ProviderFiles,
  ProviderGateway,
} from "../../packages/providers/src/index.js";
import { BudgetLedger } from "../../packages/providers/src/ledger.js";
import {
  queueName,
  RuntimeService,
  redisConnection,
  redisPublisher,
} from "../../packages/runtime/src/index.js";
import { startSimulationWorker } from "../../packages/runtime/src/worker.js";

const databaseUrl = process.env.TEST_IDENTITY_DATABASE_URL;
if (!databaseUrl) throw new Error("Disposable identity database required");
const bootstrapToken = randomBytes(32).toString("hex"),
  recoveryToken = randomBytes(32).toString("hex"),
  csrfSecret = randomBytes(32).toString("hex");
let now = new Date();
const deliveries: Array<{ recipient: string; token: string }> = [];
const auth = new AuthService({
  databaseUrl,
  bootstrapToken,
  recoveryToken,
  csrfSecret,
  clock: () => now,
  deliverReset: async (recipient, token) => {
    deliveries.push({ recipient, token });
  },
});
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const password = "A long fixture password 42!";
let ownerLogin = "",
  ownerToken = "",
  ownerId = "",
  orgId = "",
  counter = 0;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await auth.initialize();
  app = await buildApp({
    auth,
    publicUrl: "http://127.0.0.1:3000",
    readiness: async () => true,
  });
});
beforeEach(async () => {
  if (ownerLogin) {
    now = new Date(now.getTime() + 960000);
    ownerToken = (
      await auth.login({ login: ownerLogin, password }, `case-${counter++}`)
    ).cookieToken;
  }
});
afterAll(async () => {
  await app?.close();
  await auth.close();
  await pool.end();
});
describe("bootstrap and session security", () => {
  it("allows exactly one concurrent bootstrap and stores no raw session token", async () => {
    const attempts = await Promise.allSettled(
      [0, 1].map((i) =>
        auth.bootstrap(
          {
            token: bootstrapToken,
            login: `owner${i}`,
            password,
            email: "owner@example.invalid",
          },
          `bootstrap-${i}`,
        ),
      ),
    );
    const wins = attempts.flatMap((x) =>
      x.status === "fulfilled" ? [x.value] : [],
    );
    expect(wins).toHaveLength(1);
    ownerToken = wins[0]?.cookieToken ?? "";
    ownerLogin = wins[0]?.user.login ?? "";
    ownerId = wins[0]?.user.id ?? "";
    const me = await auth.me(ownerToken);
    orgId = me.organizations[0]?.id;
    expect(orgId).toBeTruthy();
    expect(me.instance_owner).toBe(true);
    expect(await auth.setupStatus()).toEqual({ required: false });
    const row = (
      await pool.query("select password_hash from users where id=$1", [ownerId])
    ).rows[0];
    expect(row.password_hash).toContain("$argon2id$v=19$m=19456,t=2,p=1$");
    expect(row.password_hash).not.toContain(password);
    expect(
      (
        await pool.query("select token_hash from sessions where user_id=$1", [
          ownerId,
        ])
      ).rows.every((r) => r.token_hash !== ownerToken),
    ).toBe(true);
    expect(
      (await pool.query("select count(*)::int as n from instance_owners"))
        .rows[0].n,
    ).toBe(1);
    await expect(
      auth.bootstrap(
        { token: bootstrapToken, login: "otherowner", password },
        "late-setup",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rotates login sessions, blocks fixation and revokes explicitly", async () => {
    const first = await auth.login(
      { login: ownerLogin, password },
      "rotation-a",
    );
    const next = await auth.login(
      { login: ownerLogin, password },
      "rotation-b",
      first.cookieToken,
    );
    expect(next.cookieToken).not.toBe(first.cookieToken);
    await expect(auth.authenticate(first.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
    const principal = await auth.authenticate(next.cookieToken);
    await auth.revokeSession(ownerToken, principal.sessionId);
    await expect(auth.authenticate(next.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
    const listed = await auth.listSessions(ownerToken);
    expect(JSON.stringify(listed)).not.toContain("token_hash");
  });
  it("enforces idle and absolute expiry and logout", async () => {
    const idle = await auth.login({ login: ownerLogin, password }, "idle");
    now = new Date(now.getTime() + 1800001);
    await expect(auth.authenticate(idle.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
    const absolute = await auth.login(
      { login: ownerLogin, password },
      "absolute",
    );
    now = new Date(now.getTime() + 43200001);
    await expect(auth.authenticate(absolute.cookieToken)).rejects.toMatchObject(
      { status: 401 },
    );
    const logout = await auth.login({ login: ownerLogin, password }, "logout");
    await auth.logout(logout.cookieToken);
    await expect(auth.authenticate(logout.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("uses generic credential errors and bounds repeated attempts", async () => {
    await expect(
      auth.login({ login: "unknown-user", password }, "unknown"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    await expect(
      auth.login({ login: ownerLogin, password: "wrong" }, "known"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    for (let i = 0; i < 10; i++)
      await auth
        .login({ login: "limited-user", password: "incorrect" }, "limited-ip")
        .catch(() => {});
    await expect(
      auth.login(
        { login: "limited-user", password: "incorrect" },
        "limited-ip",
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
  it("enforces Origin and CSRF while setting private cookies and ignoring fixation input", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { login: ownerLogin, password },
        })
      ).statusCode,
    ).toBe(403);
    const logged = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        origin: "http://127.0.0.1:3000",
        cookie: "craftlayer_session=attacker-chosen",
      },
      payload: { login: ownerLogin, password },
    });
    expect(logged.statusCode).toBe(200);
    expect(String(logged.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(logged.headers["set-cookie"])).toContain("SameSite=Strict");
    expect(logged.body).not.toContain("cookieToken");
    const cookie = String(logged.headers["set-cookie"]).split(";")[0] ?? "";
    const logout = {
      method: "POST" as const,
      url: "/api/v1/auth/logout",
      headers: { origin: "http://127.0.0.1:3000", cookie },
    };
    expect((await app.inject(logout)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          ...logout,
          headers: {
            ...logout.headers,
            "x-csrf-token": logged.json().csrf_token,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/auth/me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
  it("uses Secure cookies for configured HTTPS origins", async () => {
    const secureApp = await buildApp({
      auth,
      publicUrl: "https://craftlayer.local",
      readiness: async () => true,
    });
    try {
      const r = await secureApp.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "https://craftlayer.local" },
        payload: { login: ownerLogin, password },
      });
      expect(r.statusCode).toBe(200);
      expect(String(r.headers["set-cookie"])).toContain("Secure");
    } finally {
      await secureApp.close();
    }
  });
});
async function fixtureMember(role: string, org = orgId, child = false) {
  const id = randomBytes(16).toString("hex"),
    login = `${role}_${id}`,
    memberId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.organization_id',$1,true)", [
      org,
    ]);
    const passwordHash = (
      await client.query("select password_hash from users where id=$1", [
        ownerId,
      ])
    ).rows[0].password_hash;
    await client.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,$4)",
      [userId, login, child ? "child" : "adult", passwordHash],
    );
    await client.query(
      "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
      [memberId, org, userId],
    );
    await client.query(
      "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name=$3",
      [org, memberId, role],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return {
    userId,
    memberId,
    login,
    token: (await auth.login({ login, password }, login)).cookieToken,
  };
}
async function grantFixture(
  memberId: string,
  permission: string,
  projectId: string,
  environmentId: string | null = null,
  org = orgId,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.organization_id',$1,true)", [
      org,
    ]);
    await client.query(
      "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6)",
      [
        crypto.randomUUID(),
        org,
        memberId,
        permission,
        projectId,
        environmentId,
      ],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
describe("organization/resource authorization", () => {
  it("filters scoped reads and rejects foreign project IDs and org selection", async () => {
    const first = await auth.createProject(ownerToken, orgId, "Visible"),
      hidden = await auth.createProject(ownerToken, orgId, "Hidden");
    const secondOrg = await auth.createOrganization(ownerToken, "Second org"),
      foreign = await auth.createProject(ownerToken, secondOrg.id, "Foreign");
    const viewer = await fixtureMember("viewer");
    await grantFixture(viewer.memberId, "project:read", first.id);
    expect(
      (await auth.listProjects(viewer.token, orgId)).map((x) => x.id),
    ).toEqual([first.id]);
    expect((await auth.getProject(viewer.token, orgId, first.id)).id).toBe(
      first.id,
    );
    await expect(
      auth.getProject(viewer.token, orgId, hidden.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.getProject(viewer.token, orgId, foreign.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      auth.listProjects(viewer.token, secondOrg.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      auth.createProject(viewer.token, orgId, "forbidden"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("keeps instance owner separate from organization admin", async () => {
    const admin = await fixtureMember("org_admin");
    await expect(
      auth.createOrganization(admin.token, "forbidden"),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await auth.createProject(admin.token, orgId, "Allowed admin project"))
        .id,
    ).toBeTruthy();
  });
  it("binds signed execution grants to current authority, session and exact world", async () => {
    const p = await auth.createProject(ownerToken, orgId, "Operator project"),
      world = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "World",
        type: "minecraft",
      });
    const operator = await fixtureMember("operator");
    await expect(
      auth.authorize(operator.token, orgId, "mission:execute", {
        kind: "environment",
        id: world.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await grantFixture(operator.memberId, "mission:execute", p.id, world.id);
    const grant = await auth.issueExecutionGrant(
      operator.token,
      orgId,
      "mission:execute",
      { kind: "environment", id: world.id },
    );
    expect(await auth.revalidateExecutionGrant(grant)).toBe(true);
    await expect(
      auth.revalidateExecutionGrant({
        ...grant,
        permission: "provider:manage",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.authorize(operator.token, orgId, "mission:execute", {
        kind: "project",
        id: p.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await auth.logout(operator.token);
    await expect(auth.revalidateExecutionGrant(grant)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("enforces the child ceiling even with an extra administrator role", async () => {
    const p = await auth.createProject(ownerToken, orgId, "Child project"),
      world = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "Private Minecraft",
        type: "minecraft",
      }),
      code = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "Code",
        type: "coding",
      });
    const child = await fixtureMember("org_admin", orgId, true);
    await grantFixture(child.memberId, "environment:read", p.id, world.id);
    await grantFixture(child.memberId, "environment:read", p.id, code.id);
    expect((await auth.getEnvironment(child.token, orgId, world.id)).id).toBe(
      world.id,
    );
    await expect(
      auth.getEnvironment(child.token, orgId, code.id),
    ).rejects.toMatchObject({ status: 403 });
    for (const permission of [
      "provider:manage",
      "membership:manage",
      "role:manage",
      "budget:manage",
    ] as const)
      await expect(
        auth.authorize(child.token, orgId, permission, {
          kind: "organization",
          id: orgId,
        }),
      ).rejects.toMatchObject({ status: 403 });
  });
});

it("enforces org/resource authorization at the HTTP boundary and rejects extra org claims", async () => {
  const project = await auth.createProject(
      ownerToken,
      orgId,
      "API scoped project",
    ),
    viewer = await fixtureMember("viewer");
  await grantFixture(viewer.memberId, "project:read", project.id);
  const headers = {
    cookie: `craftlayer_session=${viewer.token}`,
    "x-craftlayer-organization": orgId,
  };
  expect(
    (await app.inject({ url: `/api/v1/projects/${project.id}`, headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: "/api/v1/projects",
        headers: {
          ...headers,
          "x-craftlayer-organization": crypto.randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: {
          ...headers,
          origin: "http://127.0.0.1:3000",
          "x-csrf-token": auth.csrfToken(viewer.token),
        },
        payload: { name: "forbidden" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: {
          cookie: `craftlayer_session=${ownerToken}`,
          "x-craftlayer-organization": orgId,
          origin: "http://127.0.0.1:3000",
          "x-csrf-token": auth.csrfToken(ownerToken),
        },
        payload: { name: "forged", organization_id: crypto.randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
});
describe("invitations and identity lifecycle", () => {
  it("consumes an invitation exactly once and keeps its bearer out of lists", async () => {
    const role = (await auth.listRoles(ownerToken, orgId)).find(
      (r) => r.name === "viewer",
    );
    const invite = await auth.createInvitation(ownerToken, orgId, role.id);
    expect(
      JSON.stringify(await auth.listInvitations(ownerToken, orgId)),
    ).not.toContain(invite.token);
    const attempts = await Promise.allSettled(
      [0, 1].map((i) =>
        auth.consumeInvitation(
          { token: invite.token, login: `invite${counter}_${i}`, password },
          `invite-${i}`,
        ),
      ),
    );
    expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await expect(
      auth.consumeInvitation(
        { token: invite.token, login: `reused${counter}`, password },
        "reused",
      ),
    ).rejects.toMatchObject({ status: 400 });
    const revoked = await auth.createInvitation(ownerToken, orgId, role.id);
    await auth.revokeInvitation(ownerToken, orgId, revoked.id);
    await expect(
      auth.consumeInvitation(
        { token: revoked.token, login: `revoked${counter}`, password },
        "revoked",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("allows an authenticated adult to join another org and rotates that session", async () => {
    const person = await fixtureMember("viewer"),
      other = await auth.createOrganization(ownerToken, "Invitation org");
    const role = (await auth.listRoles(ownerToken, other.id)).find(
      (r) => r.name === "viewer",
    );
    const invite = await auth.createInvitation(ownerToken, other.id, role.id);
    const accepted = await auth.consumeInvitation(
      { token: invite.token },
      "existing",
      person.token,
    );
    const me = await auth.me(accepted.cookieToken);
    expect(me.organizations.map((o) => o.id)).toContain(other.id);
    await expect(auth.authenticate(person.token)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects stale-role execution grants and supports world-grant revocation", async () => {
    const project = await auth.createProject(
        ownerToken,
        orgId,
        "Lifecycle scope",
      ),
      world = await auth.createEnvironment(ownerToken, orgId, {
        projectId: project.id,
        name: "World",
        type: "minecraft",
      }),
      operator = await fixtureMember("operator");
    await auth.addResourceGrant(ownerToken, orgId, {
      membershipId: operator.memberId,
      permission: "mission:execute",
      projectId: project.id,
      environmentId: world.id,
    });
    const grant = await auth.issueExecutionGrant(
      operator.token,
      orgId,
      "mission:execute",
      { kind: "environment", id: world.id },
    );
    const roles = await auth.listRoles(ownerToken, orgId);
    await auth.setMemberRoles(ownerToken, orgId, operator.memberId, [
      roles.find((r) => r.name === "viewer").id,
    ]);
    await expect(auth.revalidateExecutionGrant(grant)).rejects.toMatchObject({
      status: 403,
    });
    const saved = (await auth.listResourceGrants(ownerToken, orgId)).find(
      (g) => g.membership_id === operator.memberId,
    );
    await auth.removeResourceGrant(ownerToken, orgId, saved.id);
    await expect(
      auth.getEnvironment(operator.token, orgId, world.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("separates membership suspension from global user disable and revokes sessions", async () => {
    const person = await fixtureMember("viewer"),
      other = await auth.createOrganization(ownerToken, "Second membership"),
      role = (await auth.listRoles(ownerToken, other.id)).find(
        (r) => r.name === "viewer",
      ),
      invite = await auth.createInvitation(ownerToken, other.id, role.id);
    const session = (
      await auth.consumeInvitation(
        { token: invite.token },
        "join-second",
        person.token,
      )
    ).cookieToken;
    await auth.setMembershipDisabled(ownerToken, orgId, person.memberId, true);
    await expect(auth.listProjects(session, orgId)).rejects.toMatchObject({
      status: 404,
    });
    expect(await auth.listProjects(session, other.id)).toEqual([]);
    const admin = await fixtureMember("org_admin");
    await expect(
      auth.setUserDisabled(admin.token, person.userId, true),
    ).rejects.toMatchObject({ status: 403 });
    await auth.setUserDisabled(ownerToken, person.userId, true);
    await expect(auth.authenticate(session)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      auth.login({ login: person.login, password }, "disabled-login"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await auth.setUserDisabled(ownerToken, person.userId, false);
    const restored = (
      await auth.login({ login: person.login, password }, "restored-login")
    ).cookieToken;
    expect(await auth.listProjects(restored, other.id)).toEqual([]);
  });
  it("protects last owners/admins and prevents role delegation beyond the caller", async () => {
    await expect(
      auth.setUserDisabled(ownerToken, ownerId, true),
    ).rejects.toMatchObject({ status: 409 });
    const other = await auth.createOrganization(
        ownerToken,
        "Only administrator",
      ),
      member = (await auth.listMembers(ownerToken, other.id))[0],
      roles = await auth.listRoles(ownerToken, other.id);
    await expect(
      auth.setMembershipDisabled(ownerToken, other.id, member.id, true),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      auth.setMemberRoles(ownerToken, other.id, member.id, [
        roles.find((r) => r.name === "viewer").id,
      ]),
    ).rejects.toMatchObject({ status: 409 });
    const limitedRole = await auth.createRole(ownerToken, orgId, {
        name: `Limited ${counter}`,
        permissions: ["organization:read", "role:manage", "user:invite"],
      }),
      person = await fixtureMember("viewer");
    await auth.setMemberRoles(ownerToken, orgId, person.memberId, [
      limitedRole.id,
    ]);
    await expect(
      auth.createRole(person.token, orgId, {
        name: "escalation",
        permissions: ["provider:manage"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    const admin = (await auth.listRoles(ownerToken, orgId)).find(
      (r) => r.name === "org_admin",
    );
    await expect(
      auth.createInvitation(person.token, orgId, admin.id),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("expires invitations and refuses an invitation after inviter suspension", async () => {
    const admin = await fixtureMember("org_admin"),
      role = (await auth.listRoles(ownerToken, orgId)).find(
        (r) => r.name === "viewer",
      ),
      invite = await auth.createInvitation(admin.token, orgId, role.id);
    await auth.setMembershipDisabled(ownerToken, orgId, admin.memberId, true);
    await expect(
      auth.consumeInvitation(
        { token: invite.token, login: `staleinvite${counter}`, password },
        "stale-inviter",
      ),
    ).rejects.toBeDefined();
    const expiring = await auth.createInvitation(ownerToken, orgId, role.id);
    now = new Date(now.getTime() + 86400001);
    await expect(
      auth.consumeInvitation(
        { token: expiring.token, login: `expired${counter}`, password },
        "expired-invite",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

async function emailFixture() {
  const login = `mail_${randomBytes(6).toString("hex")}`,
    email = `${login}@example.invalid`,
    role = (await auth.listRoles(ownerToken, orgId)).find(
      (r) => r.name === "viewer",
    ),
    invite = await auth.createInvitation(ownerToken, orgId, role.id);
  const user = await auth.consumeInvitation(
    { token: invite.token, login, email, password },
    login,
  );
  return { ...user, login, email };
}
describe("password recovery and child onboarding", () => {
  it("returns generic reset responses, encrypts queued tokens and consumes once", async () => {
    const person = await emailFixture();
    const response = await auth.requestPasswordReset(
      person.login,
      "known-reset",
    );
    expect(response).toEqual(
      await auth.requestPasswordReset("not-a-real-account", "unknown-reset"),
    );
    expect(JSON.stringify(response)).not.toContain("token");
    const payload = (
      await pool.query(
        "select o.payload from identity_mail_outbox o join password_reset_tokens t on t.id=o.token_id where t.user_id=$1 order by t.expires_at desc limit 1",
        [person.user.id],
      )
    ).rows[0].payload as Buffer;
    await auth.flushResetMail();
    const mail = deliveries
      .slice()
      .reverse()
      .find((x) => x.recipient === person.email);
    expect(mail).toBeTruthy();
    const token = mail?.token ?? "";
    expect(payload.includes(Buffer.from(token))).toBe(false);
    const updated = "Another long fixture password 91!";
    const results = await Promise.allSettled(
      [0, 1].map((i) =>
        auth.consumePasswordReset(token, updated, `consume-${i}`),
      ),
    );
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await expect(
      auth.consumePasswordReset(token, updated, "replay-reset"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(auth.authenticate(person.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      auth.login({ login: person.login, password }, "old-password"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      (
        await auth.login(
          { login: person.login, password: updated },
          "new-password",
        )
      ).user.id,
    ).toBe(person.user.id);
  });
  it("rejects expired reset tokens and keeps delivery failures bounded", async () => {
    const person = await emailFixture();
    await auth.requestPasswordReset(person.login, "expiry-reset");
    await auth.flushResetMail();
    const token =
      deliveries
        .slice()
        .reverse()
        .find((x) => x.recipient === person.email)?.token ?? "";
    now = new Date(now.getTime() + 1800001);
    await expect(
      auth.consumePasswordReset(
        token,
        "Expired fixture password 55!",
        "expired",
      ),
    ).rejects.toMatchObject({ status: 400 });
    const failing = new AuthService({
      databaseUrl: databaseUrl as string,
      bootstrapToken,
      recoveryToken,
      csrfSecret,
      clock: () => now,
      deliverReset: async () => {
        throw new Error("synthetic mail outage");
      },
    });
    await failing.initialize();
    try {
      await failing.requestPasswordReset(person.login, "failed-mail");
      for (let i = 0; i < 4; i++) {
        expect(await failing.flushResetMail()).toBe(0);
        now = new Date(now.getTime() + 300001);
      }
      const r = await pool.query(
        "select o.attempts from identity_mail_outbox o join password_reset_tokens t on t.id=o.token_id where t.user_id=$1 and t.consumed_at is null order by t.expires_at desc limit 1",
        [person.user.id],
      );
      expect(r.rows[0].attempts).toBe(3);
    } finally {
      await failing.close();
    }
  });
  it("requires the local recovery credential and revokes sessions without enabling disabled users", async () => {
    const person = await fixtureMember("viewer"),
      updated = "Local recovered fixture password 19!";
    await expect(
      auth.recoverPassword("wrong", person.login, updated),
    ).rejects.toMatchObject({ status: 403 });
    await auth.recoverPassword(recoveryToken, person.login, updated);
    await expect(auth.authenticate(person.token)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (
        await auth.login(
          { login: person.login, password: updated },
          "recovered",
        )
      ).user.id,
    ).toBe(person.userId);
    await auth.setUserDisabled(ownerToken, person.userId, true);
    await auth.recoverPassword(recoveryToken, person.login, password);
    await expect(
      auth.login({ login: person.login, password }, "disabled-recovered"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("creates child accounts without email, restricts worlds and supports adult-managed reset", async () => {
    const p = await auth.createProject(ownerToken, orgId, "Child onboarding"),
      world = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "Approved metadata world",
        type: "minecraft",
      }),
      other = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "Unassigned world",
        type: "minecraft",
      }),
      code = await auth.createEnvironment(ownerToken, orgId, {
        projectId: p.id,
        name: "Forbidden code",
        type: "coding",
      });
    const login = `child_${randomBytes(6).toString("hex")}`;
    await expect(
      auth.createChild(ownerToken, orgId, {
        login,
        password,
        environmentIds: [code.id],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const child = await auth.createChild(ownerToken, orgId, {
        login,
        password,
        environmentIds: [world.id],
      }),
      session = await auth.login({ login, password }, "child-login");
    expect(session.user.email).toBeNull();
    expect(
      (await auth.listEnvironments(session.cookieToken, orgId)).map(
        (x) => x.id,
      ),
    ).toEqual([world.id]);
    await expect(
      auth.getEnvironment(session.cookieToken, orgId, other.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.createChild(session.cookieToken, orgId, {
        login: "forbidden-child",
        password,
        environmentIds: [world.id],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.addResourceGrant(ownerToken, orgId, {
        membershipId: child.membership_id,
        permission: "environment:read",
        projectId: p.id,
        environmentId: code.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const roles = await auth.listRoles(ownerToken, orgId);
    await expect(
      auth.setMemberRoles(ownerToken, orgId, child.membership_id, [
        roles.find((r) => r.name === "org_admin").id,
      ]),
    ).rejects.toMatchObject({ status: 400 });
    const updated = "Adult-managed child password 39!";
    await auth.resetChildPassword(
      ownerToken,
      orgId,
      child.membership_id,
      updated,
    );
    await expect(auth.authenticate(session.cookieToken)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (await auth.login({ login, password: updated }, "child-new-login")).user
        .account_type,
    ).toBe("child");
  });
  it("runs the owner CLI with stdin secrets and emits no credential values", async () => {
    const person = await fixtureMember("viewer"),
      updated = "CLI recovered fixture password 22!";
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "apps/cli/src/main.ts",
        "owner",
        "reset-password",
        person.login,
      ],
      {
        encoding: "utf8",
        input: `${updated}\n`,
        env: {
          PATH: process.env.PATH,
          AUTH_DATABASE_URL: databaseUrl,
          CRAFTLAYER_BOOTSTRAP_TOKEN: bootstrapToken,
          CRAFTLAYER_RECOVERY_TOKEN: recoveryToken,
          CRAFTLAYER_CSRF_SECRET: csrfSecret,
        },
      },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain(updated);
    expect(r.stdout).not.toContain(recoveryToken);
    await expect(auth.authenticate(person.token)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      (
        await auth.login(
          { login: person.login, password: updated },
          "cli-recovered",
        )
      ).user.id,
    ).toBe(person.userId);
  });
});

it("projects strict public identity DTOs and audits allowed and denied actions without credentials", async () => {
  const name = `audit-project-${counter++}`;
  const created = await auth.createProject(ownerToken, orgId, name);
  const viewer = await fixtureMember("viewer");
  const headers = {
    cookie: `craftlayer_session=${ownerToken}`,
    "x-craftlayer-organization": orgId,
  };
  const me = await app.inject({ url: "/api/v1/auth/me", headers });
  expect(me.statusCode).toBe(200);
  expect(me.json().current_session_id).toMatch(/^[a-f0-9-]{36}$/);
  const denied = await app.inject({
    url: "/api/v1/audit",
    headers: { ...headers, cookie: `craftlayer_session=${viewer.token}` },
  });
  expect(denied.statusCode).toBe(403);
  const audit = await app.inject({ url: "/api/v1/audit", headers });
  expect(audit.statusCode).toBe(200);
  expect(audit.headers["cache-control"]).toBe("no-store");
  expect(
    audit
      .json()
      .items.some(
        (e: { target_id: string; outcome: string }) =>
          e.target_id === created.id && e.outcome === "allowed",
      ),
  ).toBe(true);
  const global = (
    await pool.query(
      "select action,outcome from instance_audit_events where actor_id=$1 and outcome='denied'",
      [viewer.userId],
    )
  ).rows;
  expect(global.some((e) => e.action === "http.access_denied")).toBe(true);
  const members = await app.inject({ url: "/api/v1/memberships", headers });
  expect(members.statusCode).toBe(200);
  for (const privateValue of [
    ownerToken,
    password,
    bootstrapToken,
    recoveryToken,
    "password_hash",
    "token_hash",
    "auth_version",
    "ciphertext",
  ])
    expect(
      JSON.stringify([me.json(), members.json(), audit.json()]),
    ).not.toContain(privateValue);
  const doc = await app.inject({ url: "/api/v1/openapi.json" });
  expect(doc.json().paths["/api/v1/auth/me"].get.responses["200"]).toBeTruthy();
});

describe("chapter isolation and revocation review", () => {
  it("serializes concurrent self-demotions so one active adult org admin remains", async () => {
    const org = await auth.createOrganization(
      ownerToken,
      "Concurrent administrator fixture",
    );
    const second = await fixtureMember("org_admin", org.id);
    const ownMember = (await auth.listMembers(ownerToken, org.id)).find(
      (m) => m.user_id === ownerId,
    );
    const viewerRole = (await auth.listRoles(ownerToken, org.id)).find(
      (r) => r.name === "viewer",
    );
    const results = await Promise.allSettled([
      auth.setMemberRoles(ownerToken, org.id, ownMember.id, [viewerRole.id]),
      auth.setMemberRoles(second.token, org.id, second.memberId, [
        viewerRole.id,
      ]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409, code: "LAST_ORG_ADMIN" },
    });
    const survivor =
      results[0].status === "fulfilled" ? second.token : ownerToken;
    expect(
      (await auth.listMembers(survivor, org.id)).filter(
        (m) =>
          m.roles.includes("org_admin") &&
          !m.disabled_at &&
          !m.user_disabled_at,
      ),
    ).toHaveLength(1);
  });
  it("rejects guessed foreign administration IDs and excludes foreign names and totals", async () => {
    const foreign = await auth.createOrganization(
      ownerToken,
      "Foreign identity review fixture",
    );
    const member = await fixtureMember("viewer", foreign.id);
    const role = (await auth.listRoles(ownerToken, foreign.id)).find(
      (r) => r.name === "viewer",
    );
    const invitation = await auth.createInvitation(
      ownerToken,
      foreign.id,
      role.id,
    );
    const project = await auth.createProject(
      ownerToken,
      foreign.id,
      "Foreign secret project title",
    );
    const viewer = await fixtureMember("viewer");
    for (const operation of [
      () => auth.setMemberRoles(ownerToken, orgId, member.memberId, [role.id]),
      () => auth.createInvitation(ownerToken, orgId, role.id),
      () => auth.revokeInvitation(ownerToken, orgId, invitation.id),
      () =>
        auth.addResourceGrant(ownerToken, orgId, {
          membershipId: member.memberId,
          permission: "project:read",
          projectId: project.id,
        }),
    ])
      await expect(operation()).rejects.toMatchObject({ status: 404 });
    for (const url of [
      "memberships",
      "roles",
      "resource-grants",
      "invitations",
      "audit",
      "projects",
      "environments",
    ]) {
      const result = await app.inject({
        url: `/api/v1/${url}`,
        headers: {
          cookie: `craftlayer_session=${ownerToken}`,
          "x-craftlayer-organization": orgId,
        },
      });
      expect(result.statusCode).toBe(200);
      expect(Object.keys(result.json())).toEqual(["items"]);
      expect(result.body).not.toContain(member.login);
      expect(result.body).not.toContain("Foreign secret project title");
      const denied = await app.inject({
        url: `/api/v1/${url}`,
        headers: {
          cookie: `craftlayer_session=${viewer.token}`,
          "x-craftlayer-organization": foreign.id,
        },
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain(foreign.name);
    }
  });
  it("invalidates REST and execution authority after suspension and requires new grants after restoration", async () => {
    const operator = await fixtureMember("operator");
    const project = await auth.createProject(
      ownerToken,
      orgId,
      "Revocation fixture",
    );
    const world = await auth.createEnvironment(ownerToken, orgId, {
      projectId: project.id,
      name: "Revoked world",
      type: "minecraft",
    });
    await auth.addResourceGrant(ownerToken, orgId, {
      membershipId: operator.memberId,
      permission: "mission:execute",
      projectId: project.id,
      environmentId: world.id,
    });
    const grant = await auth.issueExecutionGrant(
      operator.token,
      orgId,
      "mission:execute",
      { kind: "environment", id: world.id },
    );
    expect(await auth.revalidateExecutionGrant(grant)).toBe(true);
    await auth.setMembershipDisabled(
      ownerToken,
      orgId,
      operator.memberId,
      true,
    );
    const response = await app.inject({
      url: `/api/v1/environments/${world.id}`,
      headers: {
        cookie: `craftlayer_session=${operator.token}`,
        "x-craftlayer-organization": orgId,
      },
    });
    expect(response.statusCode).toBe(404);
    await expect(auth.revalidateExecutionGrant(grant)).rejects.toMatchObject({
      status: 404,
    });
    await auth.setMembershipDisabled(
      ownerToken,
      orgId,
      operator.memberId,
      false,
    );
    await expect(auth.revalidateExecutionGrant(grant)).rejects.toMatchObject({
      status: 403,
    });
    const fresh = await auth.issueExecutionGrant(
      operator.token,
      orgId,
      "mission:execute",
      { kind: "environment", id: world.id },
    );
    expect(await auth.revalidateExecutionGrant(fresh)).toBe(true);
    await auth.logout(operator.token);
    await expect(auth.revalidateExecutionGrant(fresh)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("clears identity-role tenant context across pooled commits and rollbacks", async () => {
    const foreign = await auth.createOrganization(
      ownerToken,
      "Identity pool fixture",
    );
    const client = await pool.connect();
    try {
      expect(
        (await client.query("select current_user as role")).rows[0].role,
      ).toBe("craftlayer_identity");
      for (const [org, finish] of [
        [orgId, "commit"],
        [foreign.id, "rollback"],
        [orgId, "commit"],
      ] as const) {
        await client.query("begin");
        await client.query("select set_config('app.organization_id',$1,true)", [
          org,
        ]);
        const rows = (
          await client.query("select organization_id from memberships")
        ).rows;
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.organization_id === org)).toBe(true);
        await client.query(finish);
        for (const table of [
          "memberships",
          "roles",
          "resource_grants",
          "invitations",
          "audit_events",
        ])
          expect((await client.query(`select * from ${table}`)).rows).toEqual(
            [],
          );
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});

it("rejects invalid login syntax at the HTTP schema boundary without invoking setup", async () => {
  const result = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    headers: { origin: "http://127.0.0.1:3000" },
    payload: {
      token: bootstrapToken,
      login: "bad login with spaces",
      password,
    },
  });
  expect(result.statusCode).toBe(400);
  expect(result.body).not.toContain(bootstrapToken);
});

it("serializes concurrent owner disables and preserves a recoverable active owner", async () => {
  const second = await fixtureMember("viewer");
  await pool.query("insert into instance_owners(user_id) values($1)", [
    second.userId,
  ]);
  const attempts = await Promise.allSettled([
    auth.setUserDisabled(ownerToken, ownerId, true),
    auth.setUserDisabled(second.token, second.userId, true),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attempts.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409, code: "LAST_OWNER" },
  });
  expect(
    (
      await pool.query(
        "select count(*)::int as n from instance_owners o join users u on u.id=o.user_id where u.disabled_at is null",
      )
    ).rows[0].n,
  ).toBe(1);
  const firstDisabled = attempts[0].status === "fulfilled";
  await auth.setUserDisabled(
    firstDisabled ? second.token : ownerToken,
    firstDisabled ? ownerId : second.userId,
    false,
  );
  expect(
    (
      await auth.login(
        { login: ownerLogin, password },
        "owner-after-concurrency",
      )
    ).user.id,
  ).toBe(ownerId);
});

describe("provider credential and connection boundary", () => {
  let providerLogs = "";
  let basePolicy = "",
    fakeHostedProof = false;
  let fakeInputPrice: string | undefined;
  let generateHook:
    | ((
        row: ConnectionRow,
        model: ModelDescriptor,
        request: GenerateRequest,
        signal: AbortSignal,
        barrier?: () => Promise<void>,
      ) => Promise<GenerateResult>)
    | undefined;
  const result = (input = 20, output = 3): GenerateResult => ({
    latency_ms: 1,
    text: "Synthetic result",
    tool_calls: [],
    finish_reason: "stop",
    usage: { quality: "observed", input_tokens: input, output_tokens: output },
    provider_request_id: null,
  });

  const fakeFactory = (row: ConnectionRow) => {
    const fake = new FakeProvider([
      fixtureModel(now.getTime(), {
        id: row.kind === "ollama" ? "fixture:local" : "fixture/model:free",
        provider: row.kind,
        classification: row.kind === "ollama" ? "operator_local" : "hosted",
        zero_cost_enforced: row.kind === "ollama" || fakeHostedProof,
      }),
    ]);
    if (fakeInputPrice && fake.models[0]) {
      fake.models[0].pricing.dimensions.input = {
        amount: fakeInputPrice,
        unit: "token",
      };
      fake.models[0].pricing.source_hash = createHash("sha256")
        .update(JSON.stringify(fake.models[0].pricing.dimensions))
        .digest("hex");
    }
    const normal = fake.generate.bind(fake);
    fake.generate = async (model, request, signal, barrier) =>
      generateHook
        ? generateHook(row, model, request, signal, barrier)
        : normal(model, request, signal, barrier);
    return fake;
  };
  let directory = "",
    providers: ProviderGateway,
    providerApp: Awaited<ReturnType<typeof buildApp>>;
  const runtime = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
  });
  const one = randomBytes(32).toString("hex"),
    two = randomBytes(32).toString("hex"),
    canary = "synthetic-provider-credential-canary";
  const keyPath = () => `${directory}/keys`,
    policyPath = () => `${directory}/policy`;
  beforeAll(async () => {
    directory = await mkdtemp(`${tmpdir()}/craftlayer-provider-integration-`);
    await writeFile(
      keyPath(),
      JSON.stringify({ active: "one", keys: { one } }),
      { mode: 0o600 },
    );
    await writeFile(
      policyPath(),
      JSON.stringify({
        version: 1,
        openrouter_enabled: true,
        openrouter_models: ["fixture/model:free"],
        allow_paid: false,
        max_paid_micro_usd: "0",
        stopped: false,
        ollama: [
          {
            id: "fixture-local",
            url: "http://127.0.0.1:11434",
            addresses: ["127.0.0.1"],
            models: ["fixture:local"],
            cloud_disabled: true,
            context_tokens: 32768,
            output_tokens: 1024,
          },
        ],
      }),
      { mode: 0o600 },
    );
    providers = new ProviderGateway({
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      auth,
      files: new ProviderFiles({ keys: keyPath(), policy: policyPath() }),
      clock: () => now.getTime(),
      providerFactory: fakeFactory,
    });
    basePolicy = await readFile(policyPath(), "utf8");
    providerApp = await buildApp({
      auth,
      providers,
      logger: createLogger(
        "info",
        new Writable({
          write(chunk, _encoding, next) {
            providerLogs += chunk.toString();
            next();
          },
        }),
      ),
      readiness: async () => true,
      publicUrl: "http://127.0.0.1:3000",
    });
  });
  beforeEach(async () => {
    generateHook = undefined;
    fakeHostedProof = false;
    fakeInputPrice = undefined;
    if (basePolicy) await writeFile(policyPath(), basePolicy);
  });
  afterAll(async () => {
    await providerApp?.close();
    await providers?.close();
    await runtime.end();
    await rm(directory, { recursive: true, force: true });
  });
  const headers = (token = ownerToken, org = orgId) => ({
    cookie: `craftlayer_session=${token}`,
    origin: "http://127.0.0.1:3000",
    "x-craftlayer-organization": org,
    "x-csrf-token": auth.csrfToken(token),
  });
  it("stores only bound ciphertext and returns strict redacted API projections", async () => {
    const response = await providerApp.inject({
      method: "POST",
      url: "/api/v1/providers",
      headers: headers(),
      payload: {
        kind: "openrouter",
        endpoint_id: "openrouter",
        label: "Synthetic provider",
        secret: canary,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().credential_configured).toBe(true);
    expect(response.body).not.toContain(canary);
    expect(providerLogs).not.toContain(canary);
    const id = response.json().id;
    const client = await runtime.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.organization_id',$1,true)", [
        orgId,
      ]);
      const row = (
        await client.query("select * from provider_connections where id=$1", [
          id,
        ])
      ).rows[0];
      expect(row.credential_payload.includes(Buffer.from(canary))).toBe(false);
      expect(
        openCredential(
          { active: "one", keys: { one } },
          orgId,
          id,
          1,
          "one",
          row.credential_payload,
        ),
      ).toBe(canary);
      expect(() =>
        openCredential(
          { active: "one", keys: { one } },
          crypto.randomUUID(),
          id,
          1,
          "one",
          row.credential_payload,
        ),
      ).toThrow();
      await client.query("commit");
      expect(
        (await client.query("select * from provider_connections")).rows,
      ).toEqual([]);
    } finally {
      await client.query("rollback");
      client.release();
    }
    const list = await providerApp.inject({
      url: "/api/v1/providers",
      headers: headers(),
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toMatch(
      /credential_payload|credential_version|secret|synthetic-provider-credential/,
    );
    expect(
      (
        await providerApp.inject({
          method: "POST",
          url: "/api/v1/providers",
          headers: { ...headers(), origin: "https://evil.invalid" },
          payload: {
            kind: "ollama",
            endpoint_id: "fixture-local",
            label: "denied",
          },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("rejects viewers, child role combinations, body endpoints and foreign connection IDs", async () => {
    const viewer = await fixtureMember("viewer"),
      child = await fixtureMember("org_admin", orgId, true);
    for (const user of [viewer, child])
      expect(
        (
          await providerApp.inject({
            url: "/api/v1/providers",
            headers: headers(user.token),
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await providerApp.inject({
          method: "POST",
          url: "/api/v1/providers",
          headers: headers(),
          payload: {
            kind: "ollama",
            endpoint_id: "fixture-local",
            label: "forbidden",
            url: "http://169.254.169.254",
          },
        })
      ).statusCode,
    ).toBe(400);
    const foreign = await auth.createOrganization(
        ownerToken,
        "Foreign provider fixture",
      ),
      connection = await providers.createConnection(ownerToken, foreign.id, {
        kind: "ollama",
        endpoint_id: "fixture-local",
        label: "Foreign hidden",
      });
    expect(
      (
        await providerApp.inject({
          method: "PUT",
          url: `/api/v1/providers/${connection.id}/status`,
          headers: headers(),
          payload: { expected_version: 1, enabled: false },
        })
      ).statusCode,
    ).toBe(404);
    const list = await providerApp.inject({
      url: "/api/v1/providers",
      headers: headers(),
    });
    expect(list.body).not.toContain("Foreign hidden");
    const client = await runtime.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.organization_id',$1,true)", [
        orgId,
      ]);
      await expect(
        client.query(
          "insert into model_snapshots(organization_id,connection_id,connection_version,model_id,descriptor,fetched_at,expires_at) values($1,$2,1,'fixture',$3,now(),now())",
          [orgId, connection.id, JSON.stringify(fixtureModel(now.getTime()))],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("rotates encrypted key versions, checks optimistic versions and revokes credentials", async () => {
    const connection = await providers.createConnection(ownerToken, orgId, {
      kind: "openrouter",
      endpoint_id: "openrouter",
      label: "Rotation fixture",
      secret: canary,
    });
    await writeFile(
      keyPath(),
      JSON.stringify({ active: "two", keys: { one, two } }),
    );
    const rewrap = await providerApp.inject({
      method: "POST",
      url: `/api/v1/providers/${connection.id}/rewrap`,
      headers: headers(),
      payload: { expected_version: 1 },
    });
    expect(rewrap.statusCode).toBe(200);
    const rotated = rewrap.json();
    expect(rotated.key_id).toBe("two");
    await expect(
      providers.setEnabled(ownerToken, orgId, connection.id, 1, false),
    ).rejects.toMatchObject({ status: 409 });
    await writeFile(
      keyPath(),
      JSON.stringify({ active: "two", keys: { two } }),
    );
    const row = await providers.changeCredential(
      ownerToken,
      orgId,
      connection.id,
      rotated.version,
      "replacement-fixture-credential",
    );
    expect(row.version).toBe(3);
    const revoked = await providerApp.inject({
      method: "DELETE",
      url: `/api/v1/providers/${connection.id}/credential`,
      headers: headers(),
      payload: { expected_version: 3 },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      enabled: false,
      credential_configured: false,
      version: 4,
      key_id: null,
    });
    await writeFile(
      keyPath(),
      JSON.stringify({ active: "one", keys: { one } }),
    );
  });
  it("refreshes only fake approved catalogs with bounded retries and redacted projections", async () => {
    const connection = await providers.createConnection(ownerToken, orgId, {
      kind: "ollama",
      endpoint_id: "fixture-local",
      label: "Catalog fake",
    });
    const models = await providers.refreshModels(
      ownerToken,
      orgId,
      connection.id,
    );
    expect(models.map((m) => m.id)).toEqual(["fixture:local"]);
    await expect(
      providers.refreshModels(ownerToken, orgId, connection.id),
    ).rejects.toMatchObject({ code: "rate_limited", dispatched: false });
    const response = await providerApp.inject({
      url: `/api/v1/providers/${connection.id}/models`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(canary);
    await providers.setEnabled(ownerToken, orgId, connection.id, 1, false);
    expect(
      await providers.listModels(ownerToken, orgId, connection.id),
    ).toEqual([]);
  });
  it("versions scope policy and keeps provider stop latched across policy and connection changes", async () => {
    const previous = await providers.getPolicy(
      ownerToken,
      orgId,
      "organization",
      orgId,
    );
    expect(previous.policy.free_only).toBe(true);
    const next = await providers.setPolicy(
      ownerToken,
      orgId,
      "organization",
      orgId,
      previous.version,
      previous.policy,
    );
    expect(next.version).toBe(previous.version + 1);
    await expect(
      providers.setPolicy(
        ownerToken,
        orgId,
        "organization",
        orgId,
        previous.version,
        previous.policy,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      providers.getPolicy(ownerToken, orgId, "project", crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await providers.setStopped(ownerToken, orgId, true);
    await providers.setPolicy(
      ownerToken,
      orgId,
      "organization",
      orgId,
      next.version,
      next.policy,
    );
    expect((await providers.stopStatus(ownerToken, orgId)).stopped).toBe(true);
    const restarted = new ProviderGateway({
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      auth,
      files: new ProviderFiles({ keys: keyPath(), policy: policyPath() }),
    });
    try {
      expect((await restarted.stopStatus(ownerToken, orgId)).stopped).toBe(
        true,
      );
    } finally {
      await restarted.close();
    }
    const child = await fixtureMember("org_admin", orgId, true);
    await expect(
      providers.setStopped(child.token, orgId, false),
    ).rejects.toMatchObject({ status: 403 });
    await providers.setStopped(ownerToken, orgId, false);
    expect((await providers.stopStatus(ownerToken, orgId)).stopped).toBe(false);
  });
  async function inferenceFixture(
    label: string,
    kind: "ollama" | "openrouter" = "ollama",
  ) {
    const org = await auth.createOrganization(ownerToken, label),
      project = await auth.createProject(ownerToken, org.id, label);
    const connection = await providers.createConnection(ownerToken, org.id, {
      kind,
      endpoint_id: kind === "ollama" ? "fixture-local" : "openrouter",
      label,
      ...(kind === "openrouter" ? { secret: canary } : {}),
    });
    await providers.refreshModels(ownerToken, org.id, connection.id);
    const grant = await auth.issueExecutionGrant(
      ownerToken,
      org.id,
      "mission:execute",
      { kind: "project", id: project.id },
    );
    return { org: org.id, project: project.id, connection, grant };
  }
  async function scoped<T>(
    org: string,
    operation: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await runtime.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.organization_id',$1,true)", [
        org,
      ]);
      const value = await operation(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  it("settles hierarchical reservations exactly once and keeps prompts out of storage and reports", async () => {
    const f = await inferenceFixture("Ledger identity fixture"),
      request = fixtureRequest({
        messages: [
          { role: "user", content: "private-prompt-canary-for-ledger" },
        ],
      });
    let calls = 0;
    generateHook = async (_row, _model, _request, _signal, barrier) => {
      await barrier?.();
      calls++;
      return result();
    };
    await providers.generate(f.grant, request, {
      mission_id: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
    });
    expect(calls).toBe(1);
    const budget = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(budget).toMatchObject({
      active: 0,
      reserved: { calls: "0", input_tokens: "0" },
      used: {
        calls: "1",
        input_tokens: "20",
        output_tokens: "3",
        total_tokens: "23",
        micro_usd: "0",
      },
    });
    const usage = await providers.usage(ownerToken, f.org),
      reservation = usage.reservations[0];
    expect(reservation.state).toBe("settled");
    const ledger = new BudgetLedger(() => now.getTime());
    await scoped(f.org, (client) =>
      ledger.complete(
        client,
        f.org,
        { id: reservation.id },
        { result: result(), dispatched: true },
      ),
    );
    expect((await providers.usage(ownerToken, f.org)).ledger).toHaveLength(3);
    const links = await scoped(
      f.org,
      async (client) =>
        (
          await client.query(
            "select scope_kind from reservation_budget_links where reservation_id=$1",
            [reservation.id],
          )
        ).rows,
    );
    expect(links.map((r) => r.scope_kind).sort()).toEqual([
      "mission",
      "organization",
      "project",
      "task",
      "user",
    ]);
    await expect(providers.generate(f.grant, request)).rejects.toBeDefined();
    await expect(
      providers.generate(f.grant, {
        ...request,
        messages: [{ role: "user", content: "changed" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(1);
    expect(JSON.stringify(usage)).not.toContain("private-prompt-canary");
    const persisted = await scoped(
      f.org,
      async (client) =>
        (
          await client.query(
            "select row_to_json(q)::text as value from provider_requests q where organization_id=$1",
            [f.org],
          )
        ).rows,
    );
    expect(persisted[0].value).not.toContain("private-prompt-canary");
    const response = await providerApp.inject({
      url: "/api/v1/usage",
      headers: headers(ownerToken, f.org),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(
      /credential_payload|private-prompt-canary/,
    );
  });
  it("atomically intersects concurrent organization/user/project quotas without partial debits", async () => {
    const f = await inferenceFixture("Concurrent budget fixture");
    for (const [kind, id, calls] of [
      ["organization", f.org, 3],
      ["user", ownerId, 1],
      ["project", f.project, 2],
    ] as const)
      await providers.setBudget(ownerToken, f.org, kind, id, 0, {
        ...defaultBudgetLimits,
        calls,
      });
    let dispatches = 0;
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      dispatches++;
      return result();
    };
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        providers.generate(f.grant, fixtureRequest()),
      ),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(dispatches).toBe(1);
    for (const [kind, id] of [
      ["organization", f.org],
      ["user", ownerId],
      ["project", f.project],
    ] as const) {
      const view = await providers.getBudget(ownerToken, f.org, kind, id);
      expect(view.used.calls).toBe("1");
      expect(view.reserved.calls).toBe("0");
      expect(view.active).toBe(0);
    }
  });
  it("retains timeout holds across restart and reconciles only with conservative quiescent acknowledgement", async () => {
    const f = await inferenceFixture("Uncertain budget fixture");
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      throw new ProviderError("timeout", true);
    };
    await expect(
      providers.generate(f.grant, fixtureRequest()),
    ).rejects.toBeDefined();
    let view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.active).toBe(1);
    expect(view.reserved.calls).toBe("1");
    const usage = await providers.usage(ownerToken, f.org),
      id = usage.reservations[0].id;
    expect(usage.reservations[0].state).toBe("uncertain");
    const restarted = new ProviderGateway({
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      auth,
      files: new ProviderFiles({ keys: keyPath(), policy: policyPath() }),
      clock: () => now.getTime(),
    });
    try {
      expect(
        (await restarted.getBudget(ownerToken, f.org, "organization", f.org))
          .active,
      ).toBe(1);
    } finally {
      await restarted.close();
    }
    await expect(
      providers.reconcile(ownerToken, f.org, id, "b".repeat(64), false),
    ).rejects.toMatchObject({ status: 400 });
    await providers.reconcile(ownerToken, f.org, id, "b".repeat(64), true);
    await expect(
      providers.reconcile(ownerToken, f.org, id, "b".repeat(64), true),
    ).rejects.toMatchObject({ status: 409 });
    view = await providers.getBudget(ownerToken, f.org, "organization", f.org);
    expect(view.active).toBe(0);
    expect(view.reserved.calls).toBe("0");
    expect(view.used).toMatchObject({
      calls: "1",
      input_tokens: "1024",
      output_tokens: "64",
      total_tokens: "1088",
      micro_usd: "0",
    });
    expect(
      (await providers.usage(ownerToken, f.org)).reservations[0].usage_quality,
    ).toBe("estimated");
  });
  it("blocks policy or credential changes between reservation and dispatch without spending", async () => {
    for (const action of ["policy", "credential", "stop"] as const) {
      fakeHostedProof = action === "credential";
      const f = await inferenceFixture(
        `Dispatch race ${action}`,
        action === "credential" ? "openrouter" : "ollama",
      );
      if (action === "credential")
        await providers.setPolicy(ownerToken, f.org, "organization", f.org, 0, {
          ...defaultModelPolicy,
          allow_hosted: true,
        });
      let calls = 0;
      generateHook = async (_r, _m, _q, _s, barrier) => {
        if (action === "policy")
          await providers.setPolicy(
            ownerToken,
            f.org,
            "organization",
            f.org,
            0,
            { ...defaultModelPolicy, allowed_models: [] },
          );
        else if (action === "credential")
          await providers.changeCredential(
            ownerToken,
            f.org,
            f.connection.id,
            1,
            "rotated-synthetic-credential",
          );
        else await providers.setStopped(ownerToken, f.org, true);
        await barrier?.();
        calls++;
        return result();
      };
      await expect(
        providers.generate(f.grant, fixtureRequest()),
      ).rejects.toBeDefined();
      expect(calls).toBe(0);
      const view = await providers.getBudget(
        ownerToken,
        f.org,
        "organization",
        f.org,
      );
      expect(view.reserved.calls).toBe("0");
      expect(view.used.calls).toBe("0");
      expect(view.active).toBe(0);
    }
  });
  it("never hides higher repeated receipts and latches stop on provider overrun", async () => {
    const f = await inferenceFixture("Receipt overrun fixture");
    await providers.generate(f.grant, fixtureRequest());
    const id = (await providers.usage(ownerToken, f.org)).reservations[0].id,
      ledger = new BudgetLedger(() => now.getTime());
    await scoped(f.org, (client) =>
      ledger.complete(
        client,
        f.org,
        { id },
        { result: result(10, 60), dispatched: true },
      ),
    );
    let view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.used).toMatchObject({
      input_tokens: "20",
      output_tokens: "60",
      total_tokens: "80",
    });
    await scoped(f.org, (client) =>
      ledger.complete(
        client,
        f.org,
        { id },
        { result: result(2048, 65), dispatched: true },
      ),
    );
    view = await providers.getBudget(ownerToken, f.org, "organization", f.org);
    expect(view.used).toMatchObject({
      input_tokens: "2048",
      output_tokens: "65",
      total_tokens: "2113",
      calls: "1",
    });
    expect((await providers.stopStatus(ownerToken, f.org)).stopped).toBe(true);
    await expect(
      providers.generate(f.grant, fixtureRequest()),
    ).rejects.toMatchObject({ reasons: ["stopped"] });
    await expect(
      scoped(f.org, (client) =>
        client.query("delete from usage_ledger where organization_id=$1", [
          f.org,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(
      await scoped(
        f.org,
        async (client) =>
          (await client.query("select * from provider_instance_windows")).rows,
      ),
    ).toEqual([]);
  });
  it("enforces the instance ceiling across organizations without exposing aggregate counters", async () => {
    const first = await inferenceFixture("Global budget first"),
      second = await inferenceFixture("Global budget second");
    const total = await scoped(first.org, async (client) => {
      await client.query(
        "select set_config('app.provider_budget','enabled',true)",
      );
      return (
        (
          await client.query(
            "select used_calls+reserved_calls as total from provider_instance_windows where window_start=$1",
            [new BudgetLedger(() => now.getTime()).window()],
          )
        ).rows[0]?.total ?? "0"
      );
    });
    const policy = JSON.parse(basePolicy);
    policy.version++;
    policy.limits = { ...defaultInstanceLimits, calls: Number(total) + 1 };
    await writeFile(policyPath(), JSON.stringify(policy));
    let calls = 0;
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      calls++;
      return result();
    };
    const outcomes = await Promise.allSettled([
      providers.generate(first.grant, fixtureRequest()),
      providers.generate(second.grant, fixtureRequest()),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(calls).toBe(1);
    const firstUsage = await providers.usage(ownerToken, first.org),
      secondUsage = await providers.usage(ownerToken, second.org);
    expect(
      firstUsage.reservations.length + secondUsage.reservations.length,
    ).toBe(1);
    const winner = firstUsage.reservations[0] ?? secondUsage.reservations[0],
      foreign = firstUsage.reservations.length ? second.org : first.org;
    await expect(
      providers.reconcile(ownerToken, foreign, winner.id, "a".repeat(64), true),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await scoped(
        first.org,
        async (client) =>
          (await client.query("select * from provider_instance_windows")).rows,
      ),
    ).toEqual([]);
  });
  it("persists a synthetic 429 cooldown across restart and accounts every fallback", async () => {
    fakeHostedProof = true;
    const f = await inferenceFixture(
      "Persisted cooldown fixture",
      "openrouter",
    );
    const local = await providers.createConnection(ownerToken, f.org, {
      kind: "ollama",
      endpoint_id: "fixture-local",
      label: "Eligible local fallback",
    });
    await providers.refreshModels(ownerToken, f.org, local.id);
    await providers.setPolicy(ownerToken, f.org, "organization", f.org, 0, {
      ...defaultModelPolicy,
      allow_hosted: true,
    });
    let hosted = 0,
      localCalls = 0;
    generateHook = async (row, _m, _q, _s, barrier) => {
      await barrier?.();
      if (row.kind === "openrouter") {
        hosted++;
        throw new ProviderError("rate_limited", true, 30000);
      }
      localCalls++;
      return result();
    };
    expect((await providers.generate(f.grant, fixtureRequest())).attempts).toBe(
      2,
    );
    expect(hosted).toBe(1);
    expect(localCalls).toBe(1);
    const restarted = new ProviderGateway({
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      auth,
      files: new ProviderFiles({ keys: keyPath(), policy: policyPath() }),
      clock: () => now.getTime(),
      providerFactory: fakeFactory,
    });
    try {
      expect(
        (await restarted.generate(f.grant, fixtureRequest())).attempts,
      ).toBe(1);
    } finally {
      await restarted.close();
    }
    expect(hosted).toBe(1);
    expect(localCalls).toBe(2);
    const held = (await providers.usage(ownerToken, f.org)).reservations.find(
      (r) => r.state === "uncertain",
    );
    expect(held.connection_id).toBe(f.connection.id);
    await providers.reconcile(ownerToken, f.org, held.id, "c".repeat(64), true);
    expect(
      (await providers.getBudget(ownerToken, f.org, "organization", f.org)).used
        .calls,
    ).toBe("3");
  });
  it("does not dispatch a reservation across an hourly window boundary", async () => {
    now = new Date(Math.floor(now.getTime() / 3600000) * 3600000 + 3599000);
    ownerToken = (
      await auth.login({ login: ownerLogin, password }, "window-boundary-login")
    ).cookieToken;
    const f = await inferenceFixture("Window boundary fixture");
    let calls = 0;
    generateHook = async (_r, _m, _q, _s, barrier) => {
      now = new Date(now.getTime() + 2000);
      await barrier?.();
      calls++;
      return result();
    };
    await expect(
      providers.generate(f.grant, fixtureRequest()),
    ).rejects.toBeDefined();
    expect(calls).toBe(0);
    const view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.active).toBe(0);
    expect(view.reserved.calls).toBe("0");
    expect(view.used.calls).toBe("0");
    expect(
      (await providers.usage(ownerToken, f.org)).reservations[0].state,
    ).toBe("released");
  });
  it("keeps uncertain concurrency held across hourly rollover until acknowledged", async () => {
    const f = await inferenceFixture("Cross-window active fixture");
    await providers.setBudget(ownerToken, f.org, "organization", f.org, 0, {
      ...defaultBudgetLimits,
      concurrent: 1,
    });
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      throw new ProviderError("timeout", true);
    };
    await expect(
      providers.generate(f.grant, fixtureRequest()),
    ).rejects.toBeDefined();
    const held = (await providers.usage(ownerToken, f.org)).reservations[0];
    now = new Date(now.getTime() + 3600001);
    ownerToken = (
      await auth.login({ login: ownerLogin, password }, "cross-window-login")
    ).cookieToken;
    await providers.refreshModels(ownerToken, f.org, f.connection.id);
    const grant = await auth.issueExecutionGrant(
      ownerToken,
      f.org,
      "mission:execute",
      { kind: "project", id: f.project },
    );
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      return result();
    };
    await expect(
      providers.generate(grant, fixtureRequest()),
    ).rejects.toMatchObject({ reasons: ["budget_concurrency_exhausted"] });
    let view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.active).toBe(1);
    expect(view.used.calls).toBe("0");
    await providers.reconcile(ownerToken, f.org, held.id, "d".repeat(64), true);
    view = await providers.getBudget(ownerToken, f.org, "organization", f.org);
    expect(view.active).toBe(0);
    expect(view.used.calls).toBe("0");
  });
  it("settles already-dispatched work after membership revocation while rejecting future authority", async () => {
    const f = await inferenceFixture("Revoked settlement fixture"),
      admin = await fixtureMember("org_admin", f.org);
    const grant = await auth.issueExecutionGrant(
      admin.token,
      f.org,
      "mission:execute",
      { kind: "project", id: f.project },
    );
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      await auth.setMembershipDisabled(ownerToken, f.org, admin.memberId, true);
      return result();
    };
    expect(
      (await providers.generate(grant, fixtureRequest())).result.text,
    ).toBe("Synthetic result");
    expect(
      (await providers.getBudget(ownerToken, f.org, "organization", f.org)).used
        .calls,
    ).toBe("1");
    await expect(
      providers.generate(grant, fixtureRequest()),
    ).rejects.toBeDefined();
  });
  it("charges missing observed usage conservatively and distinguishes it from observed zero", async () => {
    const f = await inferenceFixture("Unknown usage fixture");
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      return {
        ...result(),
        usage: { quality: "unknown", input_tokens: null, output_tokens: null },
      };
    };
    expect(
      (await providers.generate(f.grant, fixtureRequest())).result.usage
        .quality,
    ).toBe("unknown");
    const view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.used).toMatchObject({
      calls: "1",
      input_tokens: "1024",
      output_tokens: "64",
      total_tokens: "1088",
    });
    expect(
      (await providers.usage(ownerToken, f.org)).reservations[0].usage_quality,
    ).toBe("estimated");
  });
  it("recovers crash-like reserved/dispatch checkpoints conservatively and fences late dispatch", async () => {
    for (const phase of ["reserved", "dispatched"] as const) {
      const f = await inferenceFixture(`Orphan ${phase} fixture`),
        ledger = new BudgetLedger(() => now.getTime()),
        request = fixtureRequest(),
        epoch = "d".repeat(64),
        context = { org: f.org, user: ownerId, project: f.project };
      const policy = { ...defaultModelPolicy },
        configuration = {
          instance: { ...defaultInstanceLimits },
          instance_paid_cap: "0",
          policies: { [`organization/${f.org}`]: policy },
        };
      const reservation = await scoped(f.org, async (client) => {
        await ledger.begin(client, context, request);
        const row = await ledger.reserve(
          client,
          context,
          request,
          {
            connection_id: f.connection.id,
            version: 1,
            model: fixtureModel(now.getTime(), { id: "fixture:local" }),
            cooldown_until: 0,
          },
          0,
          epoch,
          0n,
          configuration,
        );
        if (phase === "dispatched")
          await ledger.dispatch(client, context, row, epoch, configuration);
        return row;
      });
      await providers.reconcile(
        ownerToken,
        f.org,
        reservation.id,
        "e".repeat(64),
        true,
      );
      const view = await providers.getBudget(
        ownerToken,
        f.org,
        "organization",
        f.org,
      );
      expect(view.active).toBe(0);
      expect(view.reserved.calls).toBe("0");
      expect(view.used.calls).toBe(phase === "dispatched" ? "1" : "0");
      await expect(
        scoped(f.org, (client) =>
          ledger.dispatch(client, context, reservation, epoch, configuration),
        ),
      ).rejects.toMatchObject({ reasons: ["reservation_changed"] });
    }
  });
  it("uses integer monetary reservations and never discounts uncertain invoice components", async () => {
    fakeInputPrice = "0.0000001";
    const f = await inferenceFixture(
      "Synthetic nonzero pricing fixture",
      "openrouter",
    );
    const policy = JSON.parse(basePolicy);
    policy.version++;
    policy.allow_paid = true;
    policy.max_paid_micro_usd = "1024";
    policy.limits = { ...defaultInstanceLimits, micro_usd: "1024" };
    await writeFile(policyPath(), JSON.stringify(policy));
    await providers.setPolicy(ownerToken, f.org, "organization", f.org, 0, {
      ...defaultModelPolicy,
      free_only: false,
      allow_hosted: true,
      max_paid_micro_usd: "1024",
    });
    for (const [kind, id] of [
      ["organization", f.org],
      ["user", ownerId],
      ["project", f.project],
    ] as const)
      await providers.setBudget(ownerToken, f.org, kind, id, 0, {
        ...defaultBudgetLimits,
        micro_usd: "1024",
      });
    let calls = 0;
    generateHook = async (_r, _m, _q, _s, barrier) => {
      await barrier?.();
      calls++;
      return result();
    };
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        providers.generate(f.grant, fixtureRequest()),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls).toBe(1);
    const view = await providers.getBudget(
      ownerToken,
      f.org,
      "organization",
      f.org,
    );
    expect(view.reserved.micro_usd).toBe("0");
    expect(view.used.micro_usd).toBe("1024");
    expect(view.used.calls).toBe("1");
    const report = await providers.usage(ownerToken, f.org);
    expect(report.reservations[0].charged_cost).toBe("1024");
    expect(report.ledger.find((e) => e.event === "settle").spend_quality).toBe(
      "estimated",
    );
    now = new Date((Math.floor(now.getTime() / 3600000) + 1) * 3600000);
  });
  it("holds current authority across bounded provider SQL mutations and denies after revocation", async () => {
    const admin = await fixtureMember("org_admin");
    let release = () => {},
      reached = () => {};
    const entered = new Promise<void>((resolve) => {
        reached = resolve;
      }),
      finish = new Promise<void>((resolve) => {
        release = resolve;
      });
    const guarded = auth.guardOrganization(
      admin.token,
      orgId,
      "provider:manage",
      async () => {
        reached();
        await finish;
        return true;
      },
    );
    await entered;
    let committed = false;
    const revoke = auth
      .setMembershipDisabled(ownerToken, orgId, admin.memberId, true)
      .then(() => {
        committed = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(committed).toBe(false);
    } finally {
      release();
    }
    expect(await guarded).toBe(true);
    await revoke;
    await expect(
      providers.listConnections(admin.token, orgId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// CHAPTER_TESTS

describe("runtime domain persistence", () => {
  const runtime = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
  });
  afterAll(() => runtime.end());
  async function scoped<T>(
    org: string,
    operation: (client: pg.PoolClient) => Promise<T>,
  ) {
    const c = await runtime.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.organization_id',$1,true)", [org]);
      const value = await operation(c);
      await c.query("commit");
      return value;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  it("enforces immutable snapshots, state transitions, tenant and same-mission edges in PostgreSQL", async () => {
    const project = await auth.createProject(
      ownerToken,
      orgId,
      "Runtime domain fixture",
    );
    const environment = await auth.createEnvironment(ownerToken, orgId, {
      projectId: project.id,
      name: "Simulation only",
      type: "simulation",
    });
    const agent = crypto.randomUUID(),
      group = crypto.randomUUID(),
      template = crypto.randomUUID(),
      mission = crypto.randomUUID(),
      otherMission = crypto.randomUUID(),
      task = crypto.randomUUID(),
      otherTask = crypto.randomUUID();
    const graph = {
      schema_version: 1,
      nodes: [
        {
          key: "echo",
          required: true,
          dependencies: [],
          action: { kind: "fixture.echo", value: "verified" },
          max_attempts: 3,
          timeout_ms: 5000,
        },
      ],
    };
    await scoped(orgId, async (c) => {
      await c.query(
        "insert into runtime_agents(id,organization_id,project_id,environment_id,name,adapter) values($1,$2,$3,$4,'Fixture','simulation')",
        [agent, orgId, project.id, environment.id],
      );
      await c.query(
        "insert into runtime_groups(id,organization_id,project_id,environment_id,name) values($1,$2,$3,$4,'Fixture')",
        [group, orgId, project.id, environment.id],
      );
      await c.query(
        "insert into runtime_templates(id,organization_id,family_id,version,name,adapter,hash,graph,created_by,project_id,environment_id) values($1,$2,$1,1,'Fixture','simulation',$3,$4,$5,$6,$7)",
        [
          template,
          orgId,
          "a".repeat(64),
          graph,
          ownerId,
          project.id,
          environment.id,
        ],
      );
      for (const id of [mission, otherMission])
        await c.query(
          "insert into runtime_missions(id,organization_id,project_id,environment_id,group_id,template_id,name,template_hash,snapshot,created_by) values($1,$2,$3,$4,$5,$6,'Fixture',$7,$8,$9)",
          [
            id,
            orgId,
            project.id,
            environment.id,
            group,
            template,
            "a".repeat(64),
            graph,
            ownerId,
          ],
        );
      for (const [id, m] of [
        [task, mission],
        [otherTask, otherMission],
      ])
        await c.query(
          "insert into runtime_tasks(id,organization_id,mission_id,node_key,definition,required) values($1,$2,$3,'echo',$4,true)",
          [id, orgId, m, graph.nodes[0]],
        );
    });
    await expect(
      scoped(orgId, (c) =>
        c.query(
          "insert into runtime_dependencies(organization_id,mission_id,task_id,prerequisite_id,required) values($1,$2,$3,$4,true)",
          [orgId, mission, task, otherTask],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      scoped(orgId, (c) =>
        c.query("update runtime_templates set name='Changed' where id=$1", [
          template,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      scoped(orgId, (c) =>
        c.query("update runtime_missions set snapshot='{}' where id=$1", [
          mission,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      scoped(orgId, (c) =>
        c.query("update runtime_tasks set state='succeeded' where id=$1", [
          task,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await scoped(orgId, async (c) => {
      for (const state of ["ready", "leased", "running"])
        await c.query("update runtime_tasks set state=$2 where id=$1", [
          task,
          state,
        ]);
      await c.query(
        "update runtime_tasks set state='succeeded',verified=true,result=$2 where id=$1",
        [task, { value: "verified" }],
      );
      for (const state of ["queued", "running", "succeeded"])
        await c.query(
          "update runtime_missions set state=$2,version=version+1 where id=$1",
          [mission, state],
        );
    });
    await expect(
      scoped(orgId, (c) =>
        c.query("update runtime_tasks set state='ready' where id=$1", [task]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await scoped(crypto.randomUUID(), (c) =>
          c.query("select id from runtime_tasks where id=$1", [task]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await runtime.query("select id from runtime_missions")).rows,
    ).toHaveLength(0);
  });
});

describe("scoped runtime command API and CLI", () => {
  const runtime = new RuntimeService({
    databaseUrl: process.env.TEST_DATABASE_URL ?? "",
    auth,
    cursorSecret: csrfSecret,
    clock: () => now.getTime(),
  });
  let api: Awaited<ReturnType<typeof buildApp>>;
  const headers = (
    token = ownerToken,
    org = orgId,
    key = crypto.randomUUID(),
  ) => ({
    cookie: `craftlayer_session=${token}`,
    origin: "http://127.0.0.1:3000",
    "x-csrf-token": auth.csrfToken(token),
    "x-craftlayer-organization": org,
    "idempotency-key": key,
  });
  beforeAll(async () => {
    api = await buildApp({ auth, runtime, readiness: async () => true });
  });
  afterAll(async () => {
    await api?.close();
    await runtime.close();
  });
  async function fixture() {
    const project = await auth.createProject(
      ownerToken,
      orgId,
      "Command project",
    );
    const env = await auth.createEnvironment(ownerToken, orgId, {
      projectId: project.id,
      name: "Command simulation",
      type: "simulation",
    });
    const agent = await runtime.createAgent(ownerToken, orgId, {
      environment_id: env.id,
      name: "Fixture agent",
      adapter: "simulation",
    });
    const group = await runtime.createGroup(ownerToken, orgId, {
      environment_id: env.id,
      name: "Fixture group",
      agent_ids: [agent.id],
    });
    const template = await runtime.createTemplate(ownerToken, orgId, {
      environment_id: env.id,
      name: "Finite fixture",
      adapter: "simulation",
      graph: {
        schema_version: 1,
        nodes: [
          {
            key: "observe",
            action: { kind: "fixture.echo", value: "observed" },
          },
          {
            key: "build",
            dependencies: [{ key: "observe" }],
            action: { kind: "fixture.echo", value: "verified" },
          },
        ],
      },
    });
    return { project, env, agent, group, template };
  }
  it("creates immutable scoped snapshots and executes one logical generation under concurrent HTTP replay", async () => {
    const f = await fixture(),
      key = crypto.randomUUID(),
      body = {
        group_id: f.group.id,
        template_id: f.template.id,
        name: "Idempotent fixture",
      };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        api.inject({
          method: "POST",
          url: "/api/v1/missions",
          headers: headers(ownerToken, orgId, key),
          payload: body,
        }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    const mission = responses[0]?.json();
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    expect(mission.tasks).toHaveLength(2);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/api/v1/missions",
          headers: headers(ownerToken, orgId, key),
          payload: { ...body, name: "Changed" },
        })
      ).statusCode,
    ).toBe(409);
    const executionKey = crypto.randomUUID(),
      executions = await Promise.all(
        Array.from({ length: 8 }, () =>
          api.inject({
            method: "POST",
            url: `/api/v1/missions/${mission.id}/execute`,
            headers: headers(ownerToken, orgId, executionKey),
            payload: { expected_version: 1 },
          }),
        ),
      );
    expect(executions.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    expect(new Set(executions.map((r) => r.json().version)).size).toBe(1);
    expect(executions[0]?.json().state).toBe("queued");
    const revised = await runtime.createTemplate(ownerToken, orgId, {
      environment_id: f.env.id,
      name: "Version two",
      adapter: "simulation",
      supersedes: f.template.id,
      graph: {
        schema_version: 1,
        nodes: [{ key: "new", action: { kind: "fixture.echo", value: "new" } }],
      },
    });
    expect(revised.version).toBe(2);
    expect(revised.family_id).toBe(f.template.family_id);
    expect(
      (await runtime.getMission(ownerToken, orgId, mission.id)).template_hash,
    ).toBe(f.template.hash);
    expect(responses[0]?.body).not.toMatch(
      /execution_grant|signature|cookieToken|password_hash/,
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.organization_id',$1,true)", [
        orgId,
      ]);
      const rows = await client.query(
        "select count(*)::int as n from audit_events where organization_id=$1 and action='runtime.mission_executed' and target_id=$2",
        [orgId, mission.id],
      );
      expect(rows.rows[0].n).toBe(1);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
  it("rejects cycles, foreign resources, wrong environments, viewers and children without broader lists", async () => {
    const f = await fixture(),
      foreign = await auth.createOrganization(
        ownerToken,
        "Foreign runtime scope",
      );
    await expect(
      runtime.createGroup(ownerToken, foreign.id, {
        environment_id: f.env.id,
        name: "Wrong",
        agent_ids: [f.agent.id],
      }),
    ).rejects.toBeDefined();
    const second = await auth.createEnvironment(ownerToken, orgId, {
      projectId: f.project.id,
      name: "Other simulation",
      type: "simulation",
    });
    await expect(
      runtime.createGroup(ownerToken, orgId, {
        environment_id: second.id,
        name: "Wrong world",
        agent_ids: [f.agent.id],
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      runtime.createTemplate(ownerToken, orgId, {
        environment_id: f.env.id,
        name: "Cycle",
        adapter: "simulation",
        graph: {
          schema_version: 1,
          nodes: [
            {
              key: "a",
              dependencies: [{ key: "a" }],
              action: { kind: "fixture.echo", value: "bad" },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
    const viewer = await fixtureMember("viewer"),
      child = await fixtureMember("child", orgId, true);
    for (const member of [viewer, child]) {
      await expect(
        runtime.createAgent(member.token, orgId, {
          environment_id: f.env.id,
          name: "Denied",
          adapter: "simulation",
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        runtime.listMissions(member.token, orgId, f.env.id),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      (await api.inject({ url: "/api/v1/missions", headers: headers() }))
        .statusCode,
    ).toBe(400);
  });
  it("persists revocable initiating authority and serves actual CLI requests with the same permissions", async () => {
    const f = await fixture(),
      mission = await runtime.createMission(
        ownerToken,
        orgId,
        crypto.randomUUID(),
        {
          name: "CLI fixture",
          group_id: f.group.id,
          template_id: f.template.id,
        },
      );
    const directory = await mkdtemp(`${tmpdir()}/craftlayer-cli-runtime-`),
      socket = createServer();
    await new Promise<void>((accept) => socket.listen(0, "127.0.0.1", accept));
    const address = socket.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    const port = address.port;
    await new Promise<void>((accept) => socket.close(() => accept()));
    const server = await buildApp({
      auth,
      runtime,
      readiness: async () => true,
      publicUrl: `http://127.0.0.1:${port}`,
    });
    await server.listen({ host: "127.0.0.1", port });
    async function cli(args: string[], input = "") {
      return new Promise<{ code: number | null; output: string }>((accept) => {
        const c = spawn(
          process.execPath,
          ["--import", "tsx", "apps/cli/src/main.ts", ...args],
          {
            env: {
              ...process.env,
              CRAFTLAYER_CLI_SESSION_FILE: `${directory}/session`,
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let output = "";
        c.stdout.on("data", (x) => {
          output += x;
        });
        c.stderr.on("data", (x) => {
          output += x;
        });
        c.stdin.end(input);
        c.on("close", (code) => accept({ code, output }));
      });
    }
    try {
      expect(
        (await cli(["login", `http://127.0.0.1:${port}`, ownerLogin], password))
          .code,
      ).toBe(0);
      const get = await cli(["mission", "get", orgId, mission.id]);
      expect(get.code).toBe(0);
      expect(JSON.parse(get.output).state).toBe("draft");
      expect(get.output).not.toMatch(/execution_grant|csrf|cookie/);
      const execute = await cli([
        "mission",
        "execute",
        orgId,
        mission.id,
        "1",
        crypto.randomUUID(),
      ]);
      expect(execute.code).toBe(0);
      expect(JSON.parse(execute.output).state).toBe("queued");
      const enrolled = await cli([
        "worker",
        "enroll",
        orgId,
        f.env.id,
        `${directory}/worker.json`,
      ]);
      expect(enrolled.code).toBe(0);
      const workerCredential = JSON.parse(
        await readFile(`${directory}/worker.json`, "utf8"),
      );
      expect(enrolled.output).not.toContain(workerCredential.token);
      const workers = await cli(["worker", "list", orgId, f.env.id]);
      expect(workers.code).toBe(0);
      expect(workers.output).not.toContain(workerCredential.token);
      expect(
        (
          await cli([
            "worker",
            "revoke",
            orgId,
            workerCredential.worker_id,
            "1",
          ])
        ).code,
      ).toBe(0);
      expect((await cli(["logout"])).code).toBe(0);
      const client = new pg.Client({
        connectionString: process.env.TEST_DATABASE_URL,
      });
      await client.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.organization_id',$1,true)", [
          orgId,
        ]);
        const grant = (
          await client.query(
            "select execution_grant from runtime_missions where id=$1",
            [mission.id],
          )
        ).rows[0].execution_grant;
        await expect(
          auth.revalidateExecutionGrant(grant),
        ).rejects.toMatchObject({ status: 403 });
        await client.query("rollback");
      } finally {
        await client.end();
      }
      const viewer = await fixtureMember("viewer");
      expect(
        (
          await cli(
            ["login", `http://127.0.0.1:${port}`, viewer.login],
            password,
          )
        ).code,
      ).toBe(0);
      const denied = await cli([
        "mission",
        "execute",
        orgId,
        mission.id,
        "2",
        crypto.randomUUID(),
      ]);
      expect(denied.code).toBe(1);
      expect(denied.output).toContain("API denied (403)");
      expect((await cli(["logout"])).code).toBe(0);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("durable fair scheduler and runtime quotas", () => {
  class Harness extends RuntimeService {
    async reference(
      ref: DispatchReference,
      outcome: "succeeded" | "failed" = "succeeded",
    ) {
      return this.tx(ref.organization_id, async (c) => {
        const task = (
          await c.query(
            "select t.*,m.generation,m.state as mission_state from runtime_tasks t join runtime_missions m on m.organization_id=t.organization_id and m.id=t.mission_id where t.organization_id=$1 and t.id=$2 and t.state='ready' and m.generation=$3 and m.state in ('queued','running') for update of t,m",
            [ref.organization_id, ref.task_id, ref.execution_generation],
          )
        ).rows[0];
        if (!task) return false;
        await c.query(
          "update runtime_missions set state='running',version=version+1 where organization_id=$1 and id=$2 and state='queued'",
          [ref.organization_id, task.mission_id],
        );
        for (const state of ["leased", "running"])
          await c.query(
            "update runtime_tasks set state=$3 where organization_id=$1 and id=$2",
            [ref.organization_id, task.id, state],
          );
        await c.query(
          "update runtime_tasks set state=$3,verified=$4,result=$5 where organization_id=$1 and id=$2",
          [
            ref.organization_id,
            task.id,
            outcome,
            outcome === "succeeded",
            { value: "verified" },
          ],
        );
        await this.progress(
          c,
          await this.mission(c, ref.organization_id, task.mission_id),
        );
        return true;
      });
    }
    async cleanup(org: string) {
      await this.tx(org, async (c) => {
        const missions = (
          await c.query<{ id: string }>(
            "select id from runtime_missions where organization_id=$1 and state in ('queued','running','blocked','paused')",
            [org],
          )
        ).rows;
        for (const m of missions) {
          await c.query(
            "update runtime_tasks set state='cancelled' where organization_id=$1 and mission_id=$2 and state in ('pending','ready','retry_wait','blocked')",
            [org, m.id],
          );
          const row = await this.mission(c, org, m.id);
          await c.query(
            "update runtime_missions set state='cancelled',version=version+1 where organization_id=$1 and id=$2 and state<>'running'",
            [org, m.id],
          );
          await this.releaseMission(c, row);
        }
      });
    }
  }
  const runtime = new Harness({
    databaseUrl: process.env.TEST_DATABASE_URL ?? "",
    auth,
    cursorSecret: csrfSecret,
    clock: () => now.getTime(),
  });
  afterAll(() => runtime.close());
  async function fixture(name: string) {
    const org = (await auth.createOrganization(ownerToken, name)).id,
      project = await auth.createProject(ownerToken, org, "Scheduler project"),
      env = await auth.createEnvironment(ownerToken, org, {
        projectId: project.id,
        name: "Scheduler simulation",
        type: "simulation",
      }),
      agent = await runtime.createAgent(ownerToken, org, {
        environment_id: env.id,
        name: "Agent",
        adapter: "simulation",
      }),
      group = await runtime.createGroup(ownerToken, org, {
        environment_id: env.id,
        name: "Group",
        agent_ids: [agent.id],
      }),
      template = await runtime.createTemplate(ownerToken, org, {
        environment_id: env.id,
        name: "One task",
        adapter: "simulation",
        graph: {
          schema_version: 1,
          nodes: [
            {
              key: "echo",
              action: { kind: "fixture.echo", value: "verified" },
            },
          ],
        },
      });
    return { org, env, group, template };
  }
  async function mission(f: Awaited<ReturnType<typeof fixture>>) {
    const draft = await runtime.createMission(
      ownerToken,
      f.org,
      crypto.randomUUID(),
      {
        name: "Scheduler mission",
        group_id: f.group.id,
        template_id: f.template.id,
      },
    );
    return runtime.executeMission(
      ownerToken,
      f.org,
      draft.id,
      crypto.randomUUID(),
      1,
    );
  }
  it("gives active organizations bounded fair turns and rejects concurrent over-admission", async () => {
    const a = await fixture("Fair A"),
      b = await fixture("Fair B");
    try {
      await mission(a);
      await mission(b);
      const seen: string[] = [];
      for (let i = 0; i < 8; i++) {
        const org = await runtime.schedulerTick(async () => {});
        if (org) seen.push(org);
      }
      expect(seen).toContain(a.org);
      expect(seen).toContain(b.org);
      expect(
        Math.abs(
          seen.filter((x) => x === a.org).length -
            seen.filter((x) => x === b.org).length,
        ),
      ).toBeLessThanOrEqual(1);
    } finally {
      await runtime.cleanup(a.org);
      await runtime.cleanup(b.org);
    }
    const c = await fixture("Capacity race");
    try {
      const q = await runtime.runtimeBudget(
        ownerToken,
        c.org,
        "organization",
        c.org,
      );
      await runtime.setRuntimeBudget(
        ownerToken,
        c.org,
        "organization",
        c.org,
        q.version,
        { ...q.limits, active_missions: 1 },
      );
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () => mission(c)),
      );
      expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (await runtime.runtimeBudget(ownerToken, c.org, "organization", c.org))
          .active_missions,
      ).toBe(1);
      const budget = await runtime.runtimeBudget(
        ownerToken,
        c.org,
        "organization",
        c.org,
      );
      await runtime.setRuntimeBudget(
        ownerToken,
        c.org,
        "organization",
        c.org,
        budget.version,
        { ...budget.limits, storage_bytes: budget.storage_bytes + 1024 },
      );
      await expect(
        runtime.createTemplate(ownerToken, c.org, {
          environment_id: c.env.id,
          name: "Over storage",
          adapter: "simulation",
          graph: {
            schema_version: 1,
            nodes: [
              { key: "echo", action: { kind: "fixture.echo", value: "x" } },
            ],
          },
        }),
      ).rejects.toMatchObject({ status: 429 });
    } finally {
      await runtime.cleanup(c.org);
    }
  });
  it("replays a commit/publish crash safely and repairs Redis queue loss from durable ready state", async () => {
    const f = await fixture("Outbox fault"),
      url = process.env.TEST_REDIS_URL;
    if (!url) throw new Error("Disposable Redis required");
    const queue = new Queue(queueName(f.org, f.env.id), {
        connection: redisConnection(url),
      }),
      publish = redisPublisher(url);
    queue.on("error", () => {});
    const refs: DispatchReference[] = [];
    try {
      const m = await mission(f);
      for (let i = 0; i < 8 && !refs.length; i++)
        await runtime.schedulerTick(async (ref, environment) => {
          if (ref.organization_id !== f.org) return;
          await publish(ref, environment);
          refs.push(ref);
          throw new Error("Simulated death before ack");
        });
      expect(refs).toHaveLength(1);
      expect(await queue.getWaitingCount()).toBe(1);
      now = new Date(now.getTime() + 2500);
      for (let i = 0; i < 8 && refs.length < 2; i++)
        await runtime.schedulerTick(async (ref, environment) => {
          if (ref.organization_id !== f.org) return;
          await publish(ref, environment);
          refs.push(ref);
        });
      expect(refs[1]?.event_id).toBe(refs[0]?.event_id);
      expect(await queue.getWaitingCount()).toBe(1);
      await queue.obliterate({ force: true });
      now = new Date(now.getTime() + 6000);
      for (let i = 0; i < 8 && refs.length < 3; i++)
        await runtime.schedulerTick(async (ref, environment) => {
          if (ref.organization_id !== f.org) return;
          await publish(ref, environment);
          refs.push(ref);
        });
      expect(refs[2]?.event_id).not.toBe(refs[0]?.event_id);
      expect(await queue.getWaitingCount()).toBe(1);
      const duplicate = refs[0];
      if (!duplicate) throw new Error("Missing dispatch");
      const results = await Promise.all(
        Array.from({ length: 20 }, () => runtime.reference(duplicate)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await runtime.getMission(ownerToken, f.org, m.id)).state).toBe(
        "succeeded",
      );
    } finally {
      await runtime.cleanup(f.org);
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.disconnect();
    }
  });
  it("fails required dependents in topological order while skipping optional dependents", async () => {
    const f = await fixture("Dependency outcomes");
    try {
      const template = await runtime.createTemplate(ownerToken, f.org, {
        environment_id: f.env.id,
        name: "Dependent failure",
        adapter: "simulation",
        graph: {
          schema_version: 1,
          nodes: [
            {
              key: "z_source",
              required: false,
              action: {
                kind: "fixture.fail",
                failure: "permanent",
                failures: 1,
              },
            },
            {
              key: "a_required",
              dependencies: [{ key: "z_source" }],
              action: { kind: "fixture.echo", value: "must not run" },
            },
            {
              key: "b_optional",
              required: false,
              dependencies: [{ key: "z_source" }],
              action: { kind: "fixture.echo", value: "skip" },
            },
          ],
        },
      });
      const draft = await runtime.createMission(
        ownerToken,
        f.org,
        crypto.randomUUID(),
        {
          name: "Failure propagation",
          group_id: f.group.id,
          template_id: template.id,
        },
      );
      await runtime.executeMission(
        ownerToken,
        f.org,
        draft.id,
        crypto.randomUUID(),
        1,
      );
      let reference: DispatchReference | undefined;
      for (let i = 0; i < 12 && !reference; i++)
        await runtime.schedulerTick(async (r) => {
          if (r.organization_id === f.org) reference = r;
        });
      if (!reference) throw new Error("Missing reference");
      await runtime.reference(reference, "failed");
      const view = await runtime.getMission(ownerToken, f.org, draft.id);
      expect(view.state).toBe("failed");
      expect(view.tasks.find((t) => t.key === "a_required")?.state).toBe(
        "failed",
      );
      expect(view.tasks.find((t) => t.key === "b_optional")?.state).toBe(
        "skipped",
      );
    } finally {
      await runtime.cleanup(f.org);
    }
  });
});

describe("registered worker authority and fenced effects", () => {
  class Harness extends RuntimeService {
    async cleanup(org: string) {
      await this.tx(org, async (c) => {
        const attempts = (
          await c.query<{ id: string }>(
            "select id from runtime_attempts where organization_id=$1 and state in ('leased','running','cancel_requested','uncertain')",
            [org],
          )
        ).rows;
        for (const a of attempts) {
          await c.query(
            "update runtime_attempts set state='failed' where organization_id=$1 and id=$2",
            [org, a.id],
          );
          await this.releaseAttempt(c, org, a.id);
        }
        await c.query(
          "update runtime_tasks set state='cancel_requested' where organization_id=$1 and state in ('leased','running')",
          [org],
        );
        await c.query(
          "update runtime_tasks set state='cancelled' where organization_id=$1 and state in ('pending','ready','retry_wait','blocked','cancel_requested')",
          [org],
        );
        const missions = (
          await c.query<{ id: string; state: string }>(
            "select id,state from runtime_missions where organization_id=$1 and state not in ('succeeded','failed','cancelled')",
            [org],
          )
        ).rows;
        for (const m of missions) {
          if (m.state === "running")
            await c.query(
              "update runtime_missions set state='cancelling',version=version+1 where organization_id=$1 and id=$2",
              [org, m.id],
            );
          await c.query(
            "update runtime_missions set state='cancelled',version=version+1 where organization_id=$1 and id=$2",
            [org, m.id],
          );
          await this.releaseMission(c, await this.mission(c, org, m.id));
        }
      });
    }
  }
  const runtime = new Harness({
    databaseUrl: process.env.TEST_DATABASE_URL ?? "",
    auth,
    cursorSecret: csrfSecret,
    clock: () => now.getTime(),
  });
  let api: Awaited<ReturnType<typeof buildApp>>,
    logs = "";
  beforeAll(async () => {
    api = await buildApp({
      auth,
      runtime,
      readiness: async () => true,
      logger: createLogger(
        "info",
        new Writable({
          write(chunk, _encoding, done) {
            logs += chunk.toString();
            done();
          },
        }),
      ),
    });
  });
  afterAll(async () => {
    await api.close();
    await runtime.close();
  });
  async function fixture(
    action: unknown = { kind: "fixture.echo", value: "verified" },
  ) {
    const org = (await auth.createOrganization(ownerToken, "Worker fixture"))
        .id,
      project = await auth.createProject(ownerToken, org, "Worker project"),
      env = await auth.createEnvironment(ownerToken, org, {
        projectId: project.id,
        name: "Worker simulation",
        type: "simulation",
      }),
      agent = await runtime.createAgent(ownerToken, org, {
        environment_id: env.id,
        name: "Worker agent",
        adapter: "simulation",
      }),
      group = await runtime.createGroup(ownerToken, org, {
        environment_id: env.id,
        name: "Worker group",
        agent_ids: [agent.id],
      }),
      template = await runtime.createTemplate(ownerToken, org, {
        environment_id: env.id,
        name: "Worker task",
        adapter: "simulation",
        graph: {
          schema_version: 1,
          nodes: [{ key: "work", action, timeout_ms: 10000 }],
        },
      }),
      draft = await runtime.createMission(
        ownerToken,
        org,
        crypto.randomUUID(),
        {
          name: "Worker mission",
          group_id: group.id,
          template_id: template.id,
        },
      );
    await runtime.executeMission(
      ownerToken,
      org,
      draft.id,
      crypto.randomUUID(),
      1,
    );
    const enrolled = await runtime.enrollWorker(ownerToken, org, {
      environment_id: env.id,
      name: "Worker",
      protocol: 1,
    });
    let reference: DispatchReference | undefined;
    for (let i = 0; i < 20 && !reference; i++)
      await runtime.schedulerTick(async (ref) => {
        if (ref.organization_id === org) reference = ref;
      });
    if (!reference) throw new Error("Missing worker reference");
    return { org, project, env, mission: draft.id, enrolled, reference };
  }
  const handle = (c: {
    attempt_id: string;
    task_id: string;
    fence: number;
    generation: number;
  }) => ({
    attempt_id: c.attempt_id,
    task_id: c.task_id,
    fence: c.fence,
    generation: c.generation,
  });
  it("allows one claim/result across 100 HTTP replays and rejects stale fences, forged results and cookie-only worker calls", async () => {
    const f = await fixture(),
      token = f.enrolled.credential.token,
      headers = {
        authorization: `Bearer ${token}`,
        "x-craftlayer-worker-protocol": "1",
      };
    try {
      const claims = await Promise.all(
        Array.from({ length: 100 }, () =>
          api.inject({
            method: "POST",
            url: "/api/v1/worker/claim",
            headers,
            payload: f.reference,
          }),
        ),
      );
      expect(claims.every((r) => r.statusCode === 200)).toBe(true);
      const winners = claims.flatMap((r) =>
        r.json().claim ? [r.json().claim] : [],
      );
      expect(winners).toHaveLength(1);
      const h = handle(winners[0]);
      expect(
        (await runtime.runtimeBudget(ownerToken, f.org, "organization", f.org))
          .active_agents,
      ).toBe(1);
      expect(
        (
          await api.inject({
            method: "POST",
            url: "/api/v1/worker/heartbeat",
            headers: { cookie: `craftlayer_session=${ownerToken}` },
            payload: h,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await api.inject({
            method: "POST",
            url: "/api/v1/worker/prepare",
            headers,
            payload: { ...h, fence: h.fence + 1 },
          })
        ).statusCode,
      ).toBe(409);
      const permit = await api.inject({
        method: "POST",
        url: "/api/v1/worker/prepare",
        headers,
        payload: h,
      });
      expect(permit.statusCode).toBe(200);
      expect(
        (
          await api.inject({
            method: "POST",
            url: "/api/v1/worker/finish",
            headers,
            payload: { ...h, outcome: "succeeded", value: "forged" },
          })
        ).statusCode,
      ).toBe(403);
      const done = await api.inject({
        method: "POST",
        url: "/api/v1/worker/finish",
        headers,
        payload: { ...h, outcome: "succeeded", value: "verified" },
      });
      expect(done.statusCode).toBe(200);
      expect(
        (await runtime.getMission(ownerToken, f.org, f.mission)).state,
      ).toBe("succeeded");
      expect(
        (await runtime.runtimeBudget(ownerToken, f.org, "organization", f.org))
          .active_agents,
      ).toBe(0);
      expect(claims[0]?.body).not.toMatch(
        /execution_grant|token_hash|signature|cookieToken/,
      );
      expect(logs).not.toContain(token);
      expect(JSON.stringify(f.reference)).not.toContain(token);
      expect(
        JSON.stringify(await runtime.listWorkers(ownerToken, f.org, f.env.id)),
      ).not.toContain(token);
    } finally {
      await runtime.cleanup(f.org);
    }
  }, 30000);
  it("denies queue tampering, foreign environments, old protocol and revoked worker credentials", async () => {
    const f = await fixture(),
      token = f.enrolled.credential.token;
    try {
      await expect(runtime.claim(token, 0, f.reference)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        runtime.claim(token, 1, {
          ...f.reference,
          organization_id: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        runtime.claim(token, 1, {
          ...f.reference,
          event_id: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 });
      const other = await auth.createEnvironment(ownerToken, f.org, {
          projectId: f.project.id,
          name: "Wrong worker world",
          type: "simulation",
        }),
        foreignWorker = await runtime.enrollWorker(ownerToken, f.org, {
          environment_id: other.id,
          name: "Other worker",
          protocol: 1,
        });
      await expect(
        runtime.claim(foreignWorker.credential.token, 1, f.reference),
      ).rejects.toMatchObject({ status: 404 });
      const claim = (await runtime.claim(token, 1, f.reference)).claim;
      if (!claim) throw new Error("Missing claim");
      await runtime.revokeWorker(
        ownerToken,
        f.org,
        f.enrolled.registration.id,
        1,
      );
      await expect(
        runtime.prepareAction(token, 1, handle(claim)),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      await runtime.cleanup(f.org);
    }
  });
  it("fences retries and retains an expired prepared effect as uncertain until operator reconciliation", async () => {
    const f = await fixture({
        kind: "fixture.fail",
        failure: "transient",
        failures: 1,
      }),
      token = f.enrolled.credential.token;
    try {
      const first = (await runtime.claim(token, 1, f.reference)).claim;
      if (!first) throw new Error("Missing claim");
      expect(
        (
          await runtime.finish(token, 1, {
            ...handle(first),
            outcome: "transient",
          })
        ).state,
      ).toBe("retry_wait");
      now = new Date(now.getTime() + 2000);
      let reference: DispatchReference | undefined;
      for (let i = 0; i < 20 && !reference; i++)
        await runtime.schedulerTick(async (r) => {
          if (r.organization_id === f.org) reference = r;
        });
      if (!reference) throw new Error("Missing retry");
      const second = (await runtime.claim(token, 1, reference)).claim;
      if (!second) throw new Error("Missing retry claim");
      expect(second.fence).toBe(first.fence + 1);
      await expect(
        runtime.finish(token, 1, {
          ...handle(first),
          outcome: "succeeded",
          value: "recovered",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await runtime.prepareAction(token, 1, handle(second));
      now = new Date(now.getTime() + 11000);
      await expect(
        runtime.finish(token, 1, {
          ...handle(second),
          outcome: "succeeded",
          value: "recovered",
        }),
      ).rejects.toMatchObject({ status: 409 });
      await runtime.acknowledgeStopped(token, 1, handle(second));
      expect(
        (await runtime.getMission(ownerToken, f.org, f.mission)).reason,
      ).toBe("uncertain");
      expect(
        (await runtime.runtimeBudget(ownerToken, f.org, "organization", f.org))
          .active_agents,
      ).toBe(1);
    } finally {
      await runtime.cleanup(f.org);
    }
  });
  it("revalidates the initiating session immediately before tool authorization", async () => {
    const f = await fixture(),
      token = f.enrolled.credential.token;
    try {
      const claimed = (await runtime.claim(token, 1, f.reference)).claim;
      if (!claimed) throw new Error("Missing claim");
      await auth.logout(ownerToken);
      await expect(
        runtime.prepareAction(token, 1, handle(claimed)),
      ).rejects.toMatchObject({ status: 403 });
      await runtime.acknowledgeStopped(token, 1, handle(claimed));
      const fresh = (
        await auth.login(
          { login: ownerLogin, password },
          "worker-revocation-inspection",
        )
      ).cookieToken;
      expect((await runtime.getMission(fresh, f.org, f.mission)).state).toBe(
        "blocked",
      );
      expect(
        (await runtime.runtimeBudget(fresh, f.org, "organization", f.org))
          .active_agents,
      ).toBe(0);
    } finally {
      await runtime.cleanup(f.org);
    }
  });
  it("runs a real BullMQ consumer through bearer-only HTTP without database or provider credentials", async () => {
    const f = await fixture();
    if (!process.env.TEST_REDIS_URL)
      throw new Error("Disposable Redis required");
    if (!api.server.listening) await api.listen({ host: "127.0.0.1", port: 0 });
    const address = api.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing HTTP address");
    const loop = startSimulationWorker({
      redisUrl: process.env.TEST_REDIS_URL,
      apiOrigin: `http://127.0.0.1:${address.port}`,
      credential: f.enrolled.credential,
    });
    const queue = new Queue(queueName(f.org, f.env.id), {
      connection: redisConnection(process.env.TEST_REDIS_URL),
    });
    queue.on("error", () => {});
    try {
      await loop.ready();
      const started = performance.now();
      await redisPublisher(process.env.TEST_REDIS_URL)(f.reference, f.env.id);
      let view = await runtime.getMission(ownerToken, f.org, f.mission);
      for (let i = 0; i < 100 && view.state !== "succeeded"; i++) {
        await new Promise((accept) => setTimeout(accept, 50));
        view = await runtime.getMission(ownerToken, f.org, f.mission);
      }
      expect(view.state).toBe("succeeded");
      expect(performance.now() - started).toBeLessThan(10000);
      expect(logs).not.toContain(f.enrolled.credential.token);
      const job = await queue.getJob(f.reference.event_id);
      expect(JSON.stringify(job?.returnvalue)).not.toContain("verified");
    } finally {
      await loop.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.disconnect();
      await runtime.cleanup(f.org);
    }
  });
});
