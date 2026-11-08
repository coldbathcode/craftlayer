import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthService } from "../../packages/auth/src/index.js";
import {
  BackupRecords,
  MinecraftControl,
} from "../../packages/minecraft-control/src/index.js";

const identityUrl = process.env.TEST_BACKUPS_IDENTITY_DATABASE_URL;
const runtimeUrl = process.env.TEST_BACKUPS_DATABASE_URL;
if (!identityUrl || !runtimeUrl)
  throw new Error("Disposable database required");
const identity = new pg.Pool({ connectionString: identityUrl, max: 2 });
const runtime = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
const auth = new AuthService({
  databaseUrl: identityUrl,
  bootstrapToken: randomBytes(32).toString("hex"),
  recoveryToken: randomBytes(32).toString("hex"),
  csrfSecret: randomBytes(32).toString("hex"),
});
const org = randomUUID(),
  project = randomUUID(),
  environment = randomUUID(),
  otherEnvironment = randomUUID(),
  server = randomUUID(),
  otherServer = randomUUID();
// 04:00 Europe/London is 04:00Z in November; 30 minutes late is "due", over an hour is "overdue".
let now = Date.parse("2026-11-08T04:30:00Z");
const backups = new BackupRecords({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
const control = new MinecraftControl({
  databaseUrl: runtimeUrl,
  auth,
  clock: () => now,
});
let adult = "",
  viewer = "",
  child = "",
  otherAdult = "",
  agentToken = "";
let app: Awaited<ReturnType<typeof buildApp>>;
async function tx<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
  scope = org,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [scope]);
    const v = await fn(c);
    await c.query("commit");
    return v;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function member(
  role: string,
  type = "adult",
  grants: Array<[string, string | null]> = [],
) {
  const user = randomUUID(),
    membership = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await tx(identity, async (c) => {
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused-hash')",
      [user, `bk-${user}`, type],
    );
    await c.query(
      "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
      [membership, org, user],
    );
    await c.query(
      "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name=$3",
      [org, membership, role],
    );
    await c.query(
      "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",
      [session, user, createHash("sha256").update(token).digest("hex")],
    );
    for (const [permission, env] of grants)
      await c.query(
        "insert into resource_grants(id,organization_id,membership_id,permission,project_id,environment_id) values($1,$2,$3,$4,$5,$6)",
        [randomUUID(), org, membership, permission, project, env],
      );
  });
  return { token, user, membership };
}
const headers = (token: string, bearer = false) => ({
  ...(bearer
    ? { authorization: `Bearer ${token}` }
    : {
        cookie: `craftlayer_session=${token}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": auth.csrfToken(token),
      }),
  "x-craftlayer-organization": org,
  "idempotency-key": randomUUID(),
});
const policy = {
  timezone: "Europe/London",
  local_time: "04:00",
  retention_days: 30,
  offhost_weekday: 0,
};
beforeAll(async () => {
  await auth.initialize();
  await tx(identity, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Backup fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Family')",
      [project, org],
    );
    for (const id of [environment, otherEnvironment])
      await c.query(
        "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'World','minecraft')",
        [id, org, project],
      );
    const roles = (
      await c.query<{ role_name: string }>(
        "select distinct role_name from built_in_role_permissions",
      )
    ).rows;
    for (const role of roles) {
      const id = randomUUID();
      await c.query(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true)",
        [id, org, role.role_name],
      );
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3",
        [org, id, role.role_name],
      );
    }
  });
  adult = (await member("org_admin")).token;
  viewer = (
    await member("viewer", "adult", [
      ["server:read", environment],
      ["backup:read", environment],
    ])
  ).token;
  child = (await member("child", "child")).token;
  otherAdult = (
    await member("operator", "adult", [["backup:read", environment]])
  ).token;
  await tx(runtime, async (c) => {
    for (const [id, env, target] of [
      [server, environment, "family"],
      [otherServer, otherEnvironment, "other"],
    ] as const)
      await c.query(
        "insert into minecraft_servers(id,organization_id,project_id,environment_id,name,target_id,binding_hash) values($1,$2,$3,$4,'Family Survival',$5,$6)",
        [
          id,
          org,
          project,
          env,
          target,
          createHash("sha256").update(target).digest("hex"),
        ],
      );
  });
  app = await buildApp({
    auth,
    backups,
    minecraft: control,
    publicUrl: "http://127.0.0.1:3000",
    readiness: async () => true,
  });
  agentToken = (
    await auth.createAgentToken(adult, org, {
      name: "backup reader",
      permissions: ["organization:read", "backup:read", "server:read"],
      projectId: project,
      environmentId: environment,
    })
  ).token;
});
afterAll(async () => {
  await app?.close();
  await backups.close();
  await control.close();
  await auth.close();
  await identity.end();
  await runtime.end();
});
describe("backup policy revisions", () => {
  it("starts empty, lets an adult manager set a policy, and keeps policy_id across revisions", async () => {
    const empty = await backups.status(adult, org, server);
    expect(empty.policy).toBeNull();
    expect(empty.can_manage).toBe(true);
    const key = randomUUID();
    const first = await backups.setPolicy(adult, org, server, policy, key);
    expect(first.revision).toBe(1);
    expect(first.enabled).toBe(true);
    expect(first.schedule.status).toBe("due");
    expect(first.health).toMatchObject({
      local: "none",
      offhost: "none",
      restore: "none",
    });
    expect(first.family_ready).toBe(false);
    // Replaying the same key returns the same revision; a different body under the same key conflicts.
    expect(
      (await backups.setPolicy(adult, org, server, policy, key)).revision,
    ).toBe(1);
    await expect(
      backups.setPolicy(
        adult,
        org,
        server,
        { ...policy, local_time: "05:00" },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const second = await backups.setPolicy(
      adult,
      org,
      server,
      { ...policy, local_time: "05:00", enabled: false },
      randomUUID(),
    );
    expect(second.revision).toBe(2);
    expect(second.policy_id).toBe(first.policy_id);
    expect(second.schedule.status).toBe("disabled");
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_backup_policies set retention_days=14 where organization_id=$1 and server_id=$2",
          [org, server],
        ),
      ),
      // The runtime role has no UPDATE privilege on policies (42501); the trigger (23514) backs it up.
    ).rejects.toMatchObject({ code: /23514|42501/ });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "insert into minecraft_backup_policies(id,organization_id,project_id,environment_id,server_id,policy_id,revision,timezone,local_time,retention_days,offhost_weekday,enabled,created_by,operation_id,created_at) select $1,organization_id,project_id,environment_id,server_id,$1,9,timezone,local_time,retention_days,offhost_weekday,true,created_by,operation_id,created_at from minecraft_backup_policies where organization_id=$2 and server_id=$3 and revision=1",
          [randomUUID(), org, server],
        ),
      ),
    ).rejects.toMatchObject({ code: /23514|23505/ });
    await backups.setPolicy(adult, org, server, policy, randomUUID());
  });
  it("refuses children, agents, viewers and other environments; lets readers read", async () => {
    await expect(
      backups.setPolicy(child, org, server, policy, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      backups.setPolicy(viewer, org, server, policy, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      backups.setPolicy(agentToken, org, server, policy, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      backups.requestBackup(agentToken, org, server, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    expect((await backups.status(viewer, org, server)).can_manage).toBe(false);
    expect(
      (await backups.status(agentToken, org, server)).policy?.revision,
    ).toBe(3);
    await expect(
      backups.status(viewer, org, otherServer),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      backups.status(adult, randomUUID(), server),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      backups.status(adult, org, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await backups.status(child, org, server).catch((e) => e.status),
    ).toBe(403);
  });
});
describe("occurrences and records", () => {
  let occurrence = "",
    operation = "",
    backupId = "";
  it("records a manual request once, refuses a second while open, and the schedule stays due", async () => {
    const key = randomUUID();
    const accepted = await backups.requestBackup(adult, org, server, key);
    expect(accepted.state).toBe("pending");
    occurrence = accepted.occurrence_id;
    operation = accepted.operation_id;
    expect(
      (await backups.requestBackup(adult, org, server, key)).occurrence_id,
    ).toBe(occurrence);
    await expect(
      backups.requestBackup(adult, org, server, randomUUID()),
    ).rejects.toMatchObject({ code: "BACKUP_IN_PROGRESS" });
    expect((await backups.status(adult, org, server)).open_occurrence).toBe(
      occurrence,
    );
    const op = await control.operation(adult, org, operation);
    expect(op).toMatchObject({
      kind: "backup_request",
      state: "running",
      recovery_required: false,
    });
    const due = await backups.scheduleDue(org, server);
    expect(due).toMatchObject({
      status: "due",
      created: null,
      blocked: "in_progress",
    });
    const http = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${server}/backups`,
      headers: headers(adult),
    });
    expect(http.statusCode).toBe(409);
  });
  it("moves pending → running → complete with evidence, closes the operation and lists the record", async () => {
    await expect(
      backups.recordComplete(org, occurrence, {
        archive_sha256: "a".repeat(64),
        size_bytes: 10,
        manifest_hash: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "OCCURRENCE_NOT_RUNNING" });
    await backups.recordStarted(org, occurrence);
    await expect(backups.recordStarted(org, occurrence)).rejects.toMatchObject({
      code: "OCCURRENCE_NOT_PENDING",
    });
    now += 60000;
    const done = await backups.recordComplete(org, occurrence, {
      archive_sha256: "a".repeat(64),
      size_bytes: 412_000_000,
      manifest_hash: "b".repeat(64),
    });
    backupId = done.backup_id;
    expect((await control.operation(adult, org, operation)).state).toBe(
      "succeeded",
    );
    const list = await backups.list(viewer, org, server);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: backupId,
      state: "complete",
      size_bytes: 412_000_000,
      verified_at: null,
      legal_hold: false,
      occurrence: { id: occurrence, kind: "manual", state: "complete" },
    });
    // Unverified: health still reports none, and retention keeps it because nothing is verified.
    const status = await backups.status(adult, org, server);
    expect(status.open_occurrence).toBeNull();
    expect(status.policy?.health.local).toBe("none");
    // Inside the retention window the window itself is the reason; "no verified backup" applies only beyond it.
    expect(list.retention.keep).toEqual([
      { id: backupId, reason: "within_retention" },
    ]);
    await backups.recordEvidence(org, backupId, "verified_at");
    await expect(
      backups.recordEvidence(org, backupId, "verified_at"),
    ).rejects.toMatchObject({ code: "EVIDENCE_NOT_RECORDABLE" });
    const verified = await backups.status(adult, org, server);
    expect(verified.policy?.health.local).toBe("healthy");
    // Age is measured from the backup's creation, not from the later verification.
    expect(verified.policy?.health.recovery_point_age_ms).toBe(0);
    const bearer = await app.inject({
      url: `/api/v1/servers/${server}/backups`,
      headers: {
        authorization: `Bearer ${agentToken}`,
        "x-craftlayer-organization": org,
      },
    });
    expect(bearer.statusCode).toBe(200);
    expect(bearer.json().items[0].archive_sha256).toBe("a".repeat(64));
  });
  it("protects records in SQL: no delete, no cleared evidence, no backwards state, legal hold needs an author", async () => {
    await expect(
      tx(runtime, (c) =>
        c.query("delete from minecraft_backups where id=$1", [backupId]),
      ),
    ).rejects.toMatchObject({ code: /23514|42501/ });
    await expect(
      tx(runtime, (c) =>
        c.query("update minecraft_backups set verified_at=null where id=$1", [
          backupId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query("update minecraft_backups set state='pending' where id=$1", [
          backupId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_backups set archive_sha256=repeat('c',64) where id=$1",
          [backupId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query("update minecraft_backups set legal_hold=true where id=$1", [
          backupId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query(
          "update minecraft_backup_occurrences set state='pending' where id=$1",
          [occurrence],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, (c) =>
        c.query("delete from minecraft_backup_occurrences where id=$1", [
          occurrence,
        ]),
      ),
    ).rejects.toMatchObject({ code: /23514|42501/ });
  });
  it("lets an adult set and clear a legal hold with audit, and retention honours it", async () => {
    expect(
      await backups.setLegalHold(adult, org, server, backupId, {
        legal_hold: true,
      }),
    ).toEqual({ ok: true, changed: true });
    expect(
      await backups.setLegalHold(adult, org, server, backupId, {
        legal_hold: true,
      }),
    ).toEqual({ ok: true, changed: false });
    await expect(
      backups.setLegalHold(viewer, org, server, backupId, {
        legal_hold: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await backups.list(adult, org, server)).retention.keep).toEqual([
      { id: backupId, reason: "legal_hold" },
    ]);
    const http = await app.inject({
      method: "PUT",
      url: `/api/v1/servers/${server}/backups/${backupId}/legal-hold`,
      headers: headers(adult),
      payload: { legal_hold: false },
    });
    expect(http.statusCode).toBe(200);
    expect(http.json()).toEqual({ ok: true, changed: true });
    const audit = await auth.listAudit(adult, org);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "server.backup_policy_set",
        "server.backup_requested",
        "server.backup_legal_hold_changed",
      ]),
    );
  });
  it("creates exactly one scheduled occurrence when due, never a burst after an outage, and fails it honestly", async () => {
    // Policy: 04:00 Europe/London. Move to 2026-11-10 06:00Z: two days passed, only one occurrence is created.
    now = Date.parse("2026-11-10T04:30:00Z");
    const first = await backups.scheduleDue(org, server);
    expect(first.created).toBeTruthy();
    expect(first.status).toBe("due");
    // Today's occurrence now exists, so the schedule is current: nothing more is created.
    const again = await backups.scheduleDue(org, server);
    expect(again).toEqual({ status: "current", created: null });
    const rows = await tx(runtime, (c) =>
      c.query<{ kind: string; local_date: string; occurrence_key: string }>(
        "select kind,local_date::text as local_date,occurrence_key from minecraft_backup_occurrences where organization_id=$1 and server_id=$2 and kind='scheduled'",
        [org, server],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.local_date).toBe("2026-11-10");
    await backups.recordFailed(org, String(first.created), "node_unavailable");
    expect((await backups.scheduleDue(org, server)).created).toBeNull();
    const list = await backups.list(adult, org, server);
    expect(list.items).toHaveLength(1);
    const outbox = await tx(runtime, (c) =>
      c.query<{ event: string }>(
        "select event from minecraft_backup_outbox where organization_id=$1 order by created_at",
        [org],
      ),
    );
    expect(outbox.rows.map((r) => r.event).sort()).toEqual(
      [
        "occurrence_requested",
        "backup_recorded",
        "occurrence_due",
        "backup_failed",
      ].sort(),
    );
    // Tomorrow is a new logical occurrence; yesterday's failure does not block it.
    now = Date.parse("2026-11-11T04:30:00Z");
    expect((await backups.scheduleDue(org, server)).created).toBeTruthy();
    // A backup on the other server is unaffected and invisible to this scope's viewer.
    await expect(backups.list(viewer, org, otherServer)).rejects.toMatchObject({
      status: 403,
    });
    expect(otherAdult).toBeTruthy();
  });
});
