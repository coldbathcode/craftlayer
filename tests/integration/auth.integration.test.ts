import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";

const databaseUrl = process.env.TEST_IDENTITY_DATABASE_URL;
if (!databaseUrl) throw new Error("Disposable identity database required");
const bootstrapToken = randomBytes(32).toString("hex"),
  recoveryToken = randomBytes(32).toString("hex"),
  csrfSecret = randomBytes(32).toString("hex");
let now = new Date();
const auth = new AuthService({
  databaseUrl,
  bootstrapToken,
  recoveryToken,
  csrfSecret,
  clock: () => now,
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
// CHAPTER_TESTS
