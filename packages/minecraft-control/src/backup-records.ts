import { createHash, randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  type BackupPolicy,
  type BackupRecord,
  backupListView,
  backupPolicyInput,
  backupPolicyView,
  backupRequestAccepted,
  backupStatusView,
  legalHoldRequest,
  nodeBackupOffer,
  nodeBackupOutcome,
} from "@craftlayer/contracts";
import { type Authority, canAccess } from "@craftlayer/core";
import pg from "pg";
import { z } from "zod";
import {
  backupHealth,
  backupOccurrence,
  planBackupRetention,
  reconcileBackupSchedule,
} from "./backup-schedule.js";

/**
 * Master plan D1 / CL-F2-03 checkpoint B. Durable backup policy revisions, schedule
 * occurrences and backup records with adult-scoped permissions. This service stores and
 * decides; it never saves, archives, copies, restores or deletes anything. The effect
 * side (node agent) writes its evidence through the `record*` methods and the node
 * dispatch methods at the end, which are composition-trusted and deliberately not
 * reachable over the public API (ADR 0045).
 */
/** How long a node may hold a started backup before it is recorded as interrupted. */
const RUNNING_LEASE_MS = 2 * 3600_000;
/** How long "Back up now" waits for a host before it is recorded as not carried out. */
const MANUAL_WAIT_MS = 3600_000;
type FailureCode =
  | "node_unavailable"
  | "save_failed"
  | "archive_failed"
  | "verification_failed"
  | "cancelled"
  | "interrupted";
function denied(code = "BACKUP_CONFLICT", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Backup request denied; refresh your authorized selection.",
  );
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface ServerRow {
  id: string;
  project_id: string;
  environment_id: string;
  registered: boolean;
}
interface PolicyRow {
  id: string;
  policy_id: string;
  revision: number;
  timezone: string;
  local_time: string;
  retention_days: number;
  offhost_weekday: number;
  enabled: boolean;
  created_at: Date;
}
interface OccurrenceRow {
  id: string;
  policy_id: string;
  policy_revision: number;
  occurrence_key: string;
  kind: "scheduled" | "manual";
  local_date: string | null;
  scheduled_at: Date;
  offhost_copy: boolean;
  state: "pending" | "running" | "complete" | "failed";
  failure_code: string;
  operation_id: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}
interface BackupRow {
  id: string;
  occurrence_id: string;
  state: "pending" | "complete" | "failed";
  archive_sha256: string | null;
  size_bytes: string | null;
  manifest_hash: string | null;
  created_at: Date;
  completed_at: Date | null;
  verified_at: Date | null;
  offhost_verified_at: Date | null;
  restore_tested_at: Date | null;
  legal_hold: boolean;
  archive_removed_at: Date | null;
}
const iso = (d: Date | null) => d?.toISOString() ?? null;
export class BackupRecords {
  #pool: pg.Pool;
  #identity: IdentityService | undefined;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    /** Absent on the private node gateway, which holds no identity service. */
    auth?: IdentityService;
    clock?: () => number;
  }) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    this.#identity = options.auth;
    this.#now = options.clock ?? Date.now;
  }
  get #auth() {
    if (!this.#identity) denied("BACKUP_USER_API_UNAVAILABLE", 503);
    return this.#identity;
  }
  async close() {
    await this.#pool.end();
  }
  async #tx<T>(org: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    z.uuid().parse(org);
    const c = await this.#pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.organization_id',$1,true)", [org]);
      await c.query(
        "select pg_advisory_xact_lock(hashtextextended($1,74618029))",
        [org],
      );
      const value = await fn(c);
      await c.query("commit");
      return value;
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
  async #server(c: pg.PoolClient, org: string, id: string) {
    const row = (
      await c.query<ServerRow>(
        "select id,project_id,environment_id,registered from minecraft_servers where organization_id=$1 and id=$2 for share",
        [org, id],
      )
    ).rows[0];
    if (!row) denied("NOT_FOUND", 404);
    return row;
  }
  /** Locate the server with a cheap organization read, then re-check the real permission in its environment. */
  async #scoped<T>(
    token: string,
    org: string,
    serverId: string,
    permission: "backup:read" | "backup:manage",
    fn: (
      c: pg.PoolClient,
      p: Principal,
      a: Authority,
      server: ServerRow,
    ) => Promise<T>,
  ) {
    z.uuid().parse(serverId);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#server(c, org, serverId)),
    );
    return this.#auth.guardResource(
      token,
      org,
      permission,
      { kind: "environment", id: located.environment_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const server = await this.#server(c, org, serverId);
          if (permission === "backup:manage" && p.user.account_type !== "adult")
            denied("BACKUP_ADULT_ONLY", 403);
          if (permission === "backup:manage" && p.agent)
            denied("AGENT_DENIED", 403);
          return fn(c, p, a, server);
        }),
    );
  }
  async #latestPolicy(c: pg.PoolClient, org: string, serverId: string) {
    return (
      await c.query<PolicyRow>(
        "select id,policy_id,revision,timezone,local_time,retention_days,offhost_weekday,enabled,created_at from minecraft_backup_policies where organization_id=$1 and server_id=$2 order by revision desc limit 1",
        [org, serverId],
      )
    ).rows[0];
  }
  #policy(row: PolicyRow): BackupPolicy {
    return {
      policy_id: row.policy_id,
      timezone: row.timezone,
      local_time: row.local_time,
      retention_days: row.retention_days,
      offhost_weekday: row.offhost_weekday,
    };
  }
  async #records(c: pg.PoolClient, org: string, serverId: string) {
    return (
      await c.query<BackupRow>(
        "select id,occurrence_id,state,archive_sha256,size_bytes::text,manifest_hash,created_at,completed_at,verified_at,offhost_verified_at,restore_tested_at,legal_hold,archive_removed_at from minecraft_backups where organization_id=$1 and server_id=$2 order by created_at desc,id limit 200",
        [org, serverId],
      )
    ).rows;
  }
  #record(row: BackupRow): BackupRecord {
    return {
      id: row.id,
      state: row.state,
      created_at: row.created_at.toISOString(),
      verified_at: iso(row.verified_at),
      restore_tested_at: iso(row.restore_tested_at),
      offhost_verified_at: iso(row.offhost_verified_at),
      legal_hold: row.legal_hold,
    };
  }
  async #lastScheduledDate(c: pg.PoolClient, org: string, serverId: string) {
    const row = (
      await c.query<{ local_date: string }>(
        "select local_date::text as local_date from minecraft_backup_occurrences where organization_id=$1 and server_id=$2 and kind='scheduled' order by local_date desc limit 1",
        [org, serverId],
      )
    ).rows[0];
    return row?.local_date ?? null;
  }
  async #policyView(
    c: pg.PoolClient,
    org: string,
    serverId: string,
    row: PolicyRow,
  ) {
    const policy = this.#policy(row),
      now = this.#now(),
      // A backup whose archive is gone is history, not a recovery point.
      records = (await this.#records(c, org, serverId))
        .filter((r) => !r.archive_removed_at)
        .map((r) => this.#record(r));
    const reconciled = row.enabled
      ? reconcileBackupSchedule(
          policy,
          await this.#lastScheduledDate(c, org, serverId),
          now,
        )
      : null;
    const health = backupHealth(policy, records, now);
    return backupPolicyView.parse({
      server_id: serverId,
      policy_id: row.policy_id,
      revision: row.revision,
      timezone: row.timezone,
      local_time: row.local_time,
      retention_days: row.retention_days,
      offhost_weekday: row.offhost_weekday,
      enabled: row.enabled,
      created_at: row.created_at.toISOString(),
      schedule: reconciled
        ? {
            status: reconciled.status,
            due_local_date: reconciled.due?.local_date ?? null,
            missed: reconciled.missed,
            next_scheduled_at: reconciled.next.scheduled_at,
          }
        : {
            status: "disabled",
            due_local_date: null,
            missed: 0,
            next_scheduled_at: null,
          },
      health: {
        local: health.local,
        offhost: health.offhost,
        restore: health.restore,
        last_restore_tested_at: health.last_restore_tested_at,
        recovery_point_age_ms:
          health.recovery_point_age_ms === null
            ? null
            : Math.max(0, Math.round(health.recovery_point_age_ms)),
      },
      family_ready: false,
    });
  }
  async #open(c: pg.PoolClient, org: string, serverId: string) {
    return (
      await c.query<{ id: string }>(
        "select id from minecraft_backup_occurrences where organization_id=$1 and server_id=$2 and state in ('pending','running') order by created_at limit 1",
        [org, serverId],
      )
    ).rows[0];
  }
  async #event(
    c: pg.PoolClient,
    org: string,
    p: Principal,
    action: string,
    serverId: string,
    details: Record<string, string | boolean>,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        org,
        p.user.id,
        action,
        serverId,
        { ...details, ...(p.agent ? { agent_id: p.agent.id } : {}) },
      ],
    );
  }
  async #replay(
    c: pg.PoolClient,
    org: string,
    actor: string,
    kind: string,
    key: string,
    input: unknown,
  ) {
    z.uuid().parse(key);
    const op = (
      await c.query<{ id: string; request_hash: string }>(
        "select id,request_hash from management_operations where organization_id=$1 and actor_id=$2 and kind=$3 and request_key=$4",
        [org, actor, kind, key],
      )
    ).rows[0];
    if (op && op.request_hash !== hash(input)) denied("IDEMPOTENCY_CONFLICT");
    return op;
  }

  /** Current policy, schedule state and health; `can_manage` tells the UI whether to show controls. */
  async status(token: string, org: string, serverId: string) {
    return this.#scoped(
      token,
      org,
      serverId,
      "backup:read",
      async (c, p, a, server) => {
        const row = await this.#latestPolicy(c, org, serverId);
        return backupStatusView.parse({
          server_id: serverId,
          policy: row ? await this.#policyView(c, org, serverId, row) : null,
          open_occurrence: (await this.#open(c, org, serverId))?.id ?? null,
          can_manage:
            !p.agent &&
            p.user.account_type === "adult" &&
            canAccess(a, "backup:manage", {
              kind: "environment",
              id: server.environment_id,
              projectId: server.project_id,
              environmentType: "minecraft",
            }),
        });
      },
    );
  }
  /** Append a policy revision. The policy_id never changes, so daily occurrences keep their identity. */
  async setPolicy(
    token: string,
    org: string,
    serverId: string,
    input: unknown,
    key: string,
  ) {
    const value = backupPolicyInput.parse(input);
    return this.#scoped(
      token,
      org,
      serverId,
      "backup:manage",
      async (c, p, _a, server) => {
        if (!server.registered) denied("SERVER_NOT_REGISTERED");
        const body = { server_id: serverId, ...value };
        const replay = await this.#replay(
          c,
          org,
          p.user.id,
          "backup_policy",
          key,
          body,
        );
        if (replay) {
          const row = await this.#latestPolicy(c, org, serverId);
          if (!row) denied("POLICY_RECEIPT_MISSING");
          return this.#policyView(c, org, serverId, row);
        }
        const prior = await this.#latestPolicy(c, org, serverId),
          now = new Date(this.#now()),
          operation = randomUUID(),
          id = randomUUID();
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at,finished_at) values($1,$2,$3,$4,$5,$6,$7,'backup_policy',$8,$9,'succeeded',0,$10,$10,$10)",
          [
            operation,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            p.user.id,
            p.sessionId,
            key,
            hash(body),
            now,
          ],
        );
        await c.query(
          "insert into minecraft_backup_policies(id,organization_id,project_id,environment_id,server_id,policy_id,revision,timezone,local_time,retention_days,offhost_weekday,enabled,created_by,operation_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
          [
            id,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            prior?.policy_id ?? id,
            (prior?.revision ?? 0) + 1,
            value.timezone,
            value.local_time,
            value.retention_days,
            value.offhost_weekday,
            value.enabled,
            p.user.id,
            operation,
            now,
          ],
        );
        await this.#event(c, org, p, "server.backup_policy_set", serverId, {
          operation_id: operation,
          revision: String((prior?.revision ?? 0) + 1),
          enabled: value.enabled,
        });
        const row = await this.#latestPolicy(c, org, serverId);
        if (!row) denied("POLICY_RECEIPT_MISSING");
        return this.#policyView(c, org, serverId, row);
      },
    );
  }
  /** "Back up now": records the request as a pending manual occurrence. The effect is separate. */
  async requestBackup(
    token: string,
    org: string,
    serverId: string,
    key: string,
  ) {
    return this.#scoped(
      token,
      org,
      serverId,
      "backup:manage",
      async (c, p, _a, server) => {
        if (!server.registered) denied("SERVER_NOT_REGISTERED");
        const body = { server_id: serverId, manual: true };
        const replay = await this.#replay(
          c,
          org,
          p.user.id,
          "backup_request",
          key,
          body,
        );
        if (replay) {
          const old = (
            await c.query<{ id: string; state: string }>(
              "select id,state from minecraft_backup_occurrences where organization_id=$1 and operation_id=$2",
              [org, replay.id],
            )
          ).rows[0];
          if (!old) denied("OCCURRENCE_RECEIPT_MISSING");
          return backupRequestAccepted.parse({
            operation_id: replay.id,
            occurrence_id: old.id,
            server_id: serverId,
            state: old.state === "running" ? "running" : "pending",
          });
        }
        const policy = await this.#latestPolicy(c, org, serverId);
        if (!policy) denied("BACKUP_POLICY_REQUIRED");
        if (await this.#open(c, org, serverId)) denied("BACKUP_IN_PROGRESS");
        const now = new Date(this.#now()),
          operation = randomUUID(),
          occurrence = randomUUID();
        await c.query(
          "insert into management_operations(id,organization_id,project_id,environment_id,server_id,actor_id,session_id,kind,request_key,request_hash,state,fence,deadline,created_at) values($1,$2,$3,$4,$5,$6,$7,'backup_request',$8,$9,'running',0,$10,$11)",
          [
            operation,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            p.user.id,
            p.sessionId,
            key,
            hash(body),
            new Date(now.getTime() + 3600000),
            now,
          ],
        );
        await c.query(
          "insert into minecraft_backup_occurrences(id,organization_id,project_id,environment_id,server_id,policy_id,policy_revision,occurrence_key,kind,local_date,scheduled_at,offhost_copy,requested_by,operation_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,'manual',null,$9,false,$10,$11,$9)",
          [
            occurrence,
            org,
            server.project_id,
            server.environment_id,
            serverId,
            policy.policy_id,
            policy.revision,
            createHash("sha256")
              .update(`backup.manual.v1/${operation}`)
              .digest("hex"),
            now,
            p.user.id,
            operation,
          ],
        );
        await c.query(
          "insert into minecraft_backup_outbox(id,organization_id,occurrence_id,event,schema_version) values($1,$2,$3,'occurrence_requested',1)",
          [randomUUID(), org, occurrence],
        );
        await c.query(
          "insert into management_outbox(id,organization_id,operation_id,schema_version) values($1,$2,$3,1)",
          [randomUUID(), org, operation],
        );
        await this.#event(c, org, p, "server.backup_requested", serverId, {
          operation_id: operation,
          occurrence_id: occurrence,
        });
        return backupRequestAccepted.parse({
          operation_id: operation,
          occurrence_id: occurrence,
          server_id: serverId,
          state: "pending",
        });
      },
    );
  }
  async list(token: string, org: string, serverId: string) {
    return this.#scoped(token, org, serverId, "backup:read", async (c) => {
      const rows = await this.#records(c, org, serverId),
        occurrences = new Map(
          (
            await c.query<OccurrenceRow>(
              "select id,policy_id,policy_revision,occurrence_key,kind,local_date::text as local_date,scheduled_at,offhost_copy,state,failure_code,operation_id,created_at,started_at,finished_at from minecraft_backup_occurrences where organization_id=$1 and server_id=$2 order by created_at desc limit 400",
              [org, serverId],
            )
          ).rows.map((o) => [o.id, o] as const),
        ),
        policy = await this.#latestPolicy(c, org, serverId),
        records = rows
          .filter((r) => !r.archive_removed_at)
          .map((r) => this.#record(r));
      const retention = policy
        ? planBackupRetention(this.#policy(policy), records, this.#now())
        : {
            keep: records.map((r) => ({ id: r.id, reason: "no_policy" })),
            expire: [],
          };
      return backupListView.parse({
        server_id: serverId,
        items: rows.map((r) => {
          const o = occurrences.get(r.occurrence_id);
          if (!o) denied("OCCURRENCE_MISSING", 500);
          return {
            ...this.#record(r),
            archive_sha256: r.archive_sha256,
            size_bytes: r.size_bytes === null ? null : Number(r.size_bytes),
            completed_at: iso(r.completed_at),
            archive_removed_at: iso(r.archive_removed_at),
            occurrence: {
              id: o.id,
              kind: o.kind,
              local_date: o.local_date,
              scheduled_at: o.scheduled_at.toISOString(),
              offhost_copy: o.offhost_copy,
              state: o.state,
              failure_code: o.failure_code,
              created_at: o.created_at.toISOString(),
              finished_at: iso(o.finished_at),
            },
          };
        }),
        retention,
      });
    });
  }
  async setLegalHold(
    token: string,
    org: string,
    serverId: string,
    backupId: string,
    input: unknown,
  ) {
    const { legal_hold } = legalHoldRequest.parse(input);
    z.uuid().parse(backupId);
    return this.#scoped(token, org, serverId, "backup:manage", async (c, p) => {
      const r = await c.query(
        "update minecraft_backups set legal_hold=$4,legal_hold_changed_by=$5,legal_hold_changed_at=$6 where organization_id=$1 and server_id=$2 and id=$3 and legal_hold<>$4",
        [org, serverId, backupId, legal_hold, p.user.id, new Date(this.#now())],
      );
      if (!r.rowCount) {
        const exists = await c.query(
          "select 1 from minecraft_backups where organization_id=$1 and server_id=$2 and id=$3",
          [org, serverId, backupId],
        );
        if (!exists.rowCount) denied("NOT_FOUND", 404);
        return { ok: true as const, changed: false };
      }
      await this.#event(
        c,
        org,
        p,
        "server.backup_legal_hold_changed",
        serverId,
        { backup_id: backupId, legal_hold },
      );
      return { ok: true as const, changed: true };
    });
  }

  // Composition-trusted methods below: no token, no HTTP route. The scheduler and the
  // node receipt path call them. They record; they never perform the backup.

  /** Create today's scheduled occurrence when it is due. At most one per call. */
  async scheduleDue(org: string, serverId: string) {
    z.uuid().parse(serverId);
    return this.#tx(org, (c) => this.#scheduleDue(c, org, serverId));
  }
  async #scheduleDue(c: pg.PoolClient, org: string, serverId: string) {
    {
      await this.#server(c, org, serverId);
      const row = await this.#latestPolicy(c, org, serverId);
      if (!row?.enabled) return { status: "disabled" as const, created: null };
      const policy = this.#policy(row),
        reconciled = reconcileBackupSchedule(
          policy,
          await this.#lastScheduledDate(c, org, serverId),
          this.#now(),
        );
      if (!reconciled.due) return { status: reconciled.status, created: null };
      if (await this.#open(c, org, serverId))
        return {
          status: reconciled.status,
          created: null,
          blocked: "in_progress" as const,
        };
      const due = backupOccurrence(policy, reconciled.due.local_date),
        id = randomUUID();
      const inserted = await c.query(
        "insert into minecraft_backup_occurrences(id,organization_id,project_id,environment_id,server_id,policy_id,policy_revision,occurrence_key,kind,local_date,scheduled_at,offhost_copy,created_at) select $1,$2,project_id,environment_id,$3,$4,$5,$6,'scheduled',$7,$8,$9,$10 from minecraft_servers where organization_id=$2 and id=$3 on conflict(organization_id,server_id,occurrence_key) do nothing",
        [
          id,
          org,
          serverId,
          row.policy_id,
          row.revision,
          due.occurrence_id,
          due.local_date,
          new Date(due.scheduled_at),
          due.offhost_copy,
          new Date(this.#now()),
        ],
      );
      if (!inserted.rowCount)
        return { status: reconciled.status, created: null };
      await c.query(
        "insert into minecraft_backup_outbox(id,organization_id,occurrence_id,event,schema_version) values($1,$2,$3,'occurrence_due',1)",
        [randomUUID(), org, id],
      );
      return { status: reconciled.status, created: id };
    }
  }
  async recordStarted(org: string, occurrenceId: string) {
    z.uuid().parse(occurrenceId);
    return this.#tx(org, async (c) => {
      const r = await c.query(
        "update minecraft_backup_occurrences set state='running',started_at=$3 where organization_id=$1 and id=$2 and state='pending'",
        [org, occurrenceId, new Date(this.#now())],
      );
      if (!r.rowCount) denied("OCCURRENCE_NOT_PENDING");
    });
  }
  /** Evidence from the effect side; the archive must already exist and be hashed. */
  async recordComplete(
    org: string,
    occurrenceId: string,
    evidence: {
      archive_sha256: string;
      size_bytes: number;
      manifest_hash: string;
    },
  ) {
    const v = z
      .strictObject({
        archive_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size_bytes: z.number().int().min(0),
        manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(evidence);
    z.uuid().parse(occurrenceId);
    return this.#tx(org, (c) => this.#complete(c, org, occurrenceId, v, false));
  }
  async #complete(
    c: pg.PoolClient,
    org: string,
    occurrenceId: string,
    v: { archive_sha256: string; size_bytes: number; manifest_hash: string },
    verified: boolean,
  ) {
    {
      const now = new Date(this.#now());
      const o = (
        await c.query<{
          project_id: string;
          environment_id: string;
          server_id: string;
          operation_id: string | null;
        }>(
          "update minecraft_backup_occurrences set state='complete',finished_at=$3 where organization_id=$1 and id=$2 and state='running' returning project_id,environment_id,server_id,operation_id",
          [org, occurrenceId, now],
        )
      ).rows[0];
      if (!o) denied("OCCURRENCE_NOT_RUNNING");
      const id = randomUUID();
      await c.query(
        "insert into minecraft_backups(id,organization_id,project_id,environment_id,server_id,occurrence_id,state,archive_sha256,size_bytes,manifest_hash,created_at,completed_at,verified_at) values($1,$2,$3,$4,$5,$6,'complete',$7,$8,$9,$10,$10,$11)",
        [
          id,
          org,
          o.project_id,
          o.environment_id,
          o.server_id,
          occurrenceId,
          v.archive_sha256,
          v.size_bytes,
          v.manifest_hash,
          now,
          verified ? now : null,
        ],
      );
      if (o.operation_id)
        await c.query(
          "update management_operations set state='succeeded',finished_at=$3 where organization_id=$1 and id=$2 and state='running'",
          [org, o.operation_id, now],
        );
      await c.query(
        "insert into minecraft_backup_outbox(id,organization_id,occurrence_id,event,schema_version) values($1,$2,$3,'backup_recorded',1)",
        [randomUUID(), org, occurrenceId],
      );
      return { backup_id: id };
    }
  }
  async recordFailed(org: string, occurrenceId: string, code: FailureCode) {
    z.uuid().parse(occurrenceId);
    return this.#tx(org, (c) => this.#fail(c, org, occurrenceId, code));
  }
  async #fail(
    c: pg.PoolClient,
    org: string,
    occurrenceId: string,
    code: FailureCode,
  ) {
    {
      const now = new Date(this.#now());
      const o = (
        await c.query<{ operation_id: string | null }>(
          "update minecraft_backup_occurrences set state='failed',failure_code=$3,finished_at=$4 where organization_id=$1 and id=$2 and state in ('pending','running') returning operation_id",
          [org, occurrenceId, code, now],
        )
      ).rows[0];
      if (!o) denied("OCCURRENCE_NOT_OPEN");
      if (o.operation_id)
        await c.query(
          "update management_operations set state='failed',failure_code='interrupted',finished_at=$3 where organization_id=$1 and id=$2 and state='running'",
          [org, o.operation_id, now],
        );
      await c.query(
        "insert into minecraft_backup_outbox(id,organization_id,occurrence_id,event,schema_version) values($1,$2,$3,'backup_failed',1)",
        [randomUUID(), org, occurrenceId],
      );
    }
  }
  /** Verification evidence is set once per kind; later proof never overwrites earlier proof. */
  async recordEvidence(
    org: string,
    backupId: string,
    kind: "verified_at" | "offhost_verified_at" | "restore_tested_at",
  ) {
    z.uuid().parse(backupId);
    return this.#tx(org, async (c) => {
      const column = {
        verified_at: "verified_at",
        offhost_verified_at: "offhost_verified_at",
        restore_tested_at: "restore_tested_at",
      }[kind];
      const r = await c.query(
        `update minecraft_backups set ${column}=$3 where organization_id=$1 and id=$2 and state='complete' and ${column} is null`,
        [org, backupId, new Date(this.#now())],
      );
      if (!r.rowCount) denied("EVIDENCE_NOT_RECORDABLE");
    });
  }

  // Node dispatch (master plan D1, ADR 0045). Called only by the private gateway after
  // it has authenticated the node. No public API surface.

  async #latched(c: pg.PoolClient, org: string, environmentId: string) {
    await c.query("select set_config('app.runtime_internal','enabled',true)");
    try {
      return !!(
        await c.query(
          "select 1 from runtime_stop_latches where latched and (kind='instance' or (kind='organization' and scope_id=$1) or (kind='environment' and scope_id=$2)) limit 1",
          [org, environmentId],
        )
      ).rowCount;
    } finally {
      await c.query(
        "select set_config('app.runtime_internal','disabled',true)",
      );
    }
  }
  async #nodeEvent(
    c: pg.PoolClient,
    org: string,
    action: string,
    serverId: string,
    details: Record<string, string>,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,null,$2,$3,'allowed',$4)",
      [org, action, serverId, details],
    );
  }
  async #boundServers(
    c: pg.PoolClient,
    org: string,
    nodeId: string,
    ids: string[],
  ) {
    return (
      await c.query<{ server_id: string; environment_id: string }>(
        "select b.server_id,b.environment_id from minecraft_server_nodes b join minecraft_nodes n on n.organization_id=b.organization_id and n.id=b.node_id join minecraft_servers s on s.organization_id=b.organization_id and s.id=b.server_id where b.organization_id=$1 and b.node_id=$2 and b.released_at is null and n.state='active' and s.registered and b.server_id=any($3::uuid[]) order by b.server_id",
        [org, nodeId, ids],
      )
    ).rows;
  }
  /**
   * Archives the bound node may delete now (ADR 0049): exactly what the retention rules
   * (ADR 0033) propose for a server with a policy, and only complete backups whose
   * archive still exists. Legal holds, the newest verified, off-server-verified and
   * restore-tested backups, anything inside the retention window, and everything while
   * no backup is verified are never offered. Nothing is offered under an emergency stop.
   */
  async expiredForNode(org: string, nodeId: string, serverIds: string[]) {
    const ids = z.array(z.uuid()).min(1).max(8).parse(serverIds);
    z.uuid().parse(nodeId);
    return this.#tx(org, async (c) => {
      const out: {
        backup_id: string;
        server_id: string;
        occurrence_id: string;
      }[] = [];
      for (const server of await this.#boundServers(c, org, nodeId, ids)) {
        if (await this.#latched(c, org, server.environment_id)) continue;
        const policy = await this.#latestPolicy(c, org, server.server_id);
        if (!policy) continue;
        const rows = (await this.#records(c, org, server.server_id)).filter(
          (r) => !r.archive_removed_at,
        );
        const expire = new Set(
          planBackupRetention(
            this.#policy(policy),
            rows.map((r) => this.#record(r)),
            this.#now(),
          ).expire,
        );
        for (const r of rows)
          if (expire.has(r.id) && r.state === "complete" && out.length < 20)
            out.push({
              backup_id: r.id,
              server_id: server.server_id,
              occurrence_id: r.occurrence_id,
            });
      }
      return out;
    });
  }
  /**
   * The bound node deleted an archive it was offered. The record is kept and marked,
   * once; a repeat changes nothing. The removal is written to the audit log either way,
   * because the file is gone whatever the record says.
   */
  async recordArchiveRemoved(
    org: string,
    nodeId: string,
    input: { backup_id: string; server_id: string; occurrence_id: string },
  ) {
    for (const v of [
      nodeId,
      input.backup_id,
      input.server_id,
      input.occurrence_id,
    ])
      z.uuid().parse(v);
    return this.#tx(org, async (c) => {
      const bound = await this.#boundServers(c, org, nodeId, [input.server_id]);
      const row = (
        await c.query<{ state: string; archive_removed_at: Date | null }>(
          "select state,archive_removed_at from minecraft_backups where organization_id=$1 and id=$2 and server_id=$3 and occurrence_id=$4 for update",
          [org, input.backup_id, input.server_id, input.occurrence_id],
        )
      ).rows[0];
      if (!bound.length || !row || row.state !== "complete")
        denied("BACKUP_RESULT_DENIED", 403);
      if (row.archive_removed_at) return;
      await c.query(
        "update minecraft_backups set archive_removed_at=$3 where organization_id=$1 and id=$2",
        [org, input.backup_id, new Date(this.#now())],
      );
      await this.#nodeEvent(
        c,
        org,
        "server.backup_archive_expired",
        input.server_id,
        {
          backup_id: input.backup_id,
          node_id: nodeId,
          service_actor: "node-gateway",
        },
      );
    });
  }
  /**
   * The next backup for one of the servers this node is bound to, marked running on it.
   * The node's question is also the schedule's clock: when a bound server's policy says
   * a backup is due, the occurrence is created here and handed over in the same step, so
   * nothing is scheduled for a server no host can back up. A backup already running on
   * this node is offered again; the node answers from its journal and never archives
   * twice. Nothing is scheduled or handed out under an emergency stop, and a manual
   * request whose author is no longer a member is cancelled instead of run.
   */
  async claimForNode(org: string, nodeId: string, serverIds: string[]) {
    const ids = z.array(z.uuid()).min(1).max(8).parse(serverIds);
    z.uuid().parse(nodeId);
    return this.#tx(org, async (c) => {
      const servers = (
        await c.query<{ server_id: string; environment_id: string }>(
          "select b.server_id,b.environment_id from minecraft_server_nodes b join minecraft_nodes n on n.organization_id=b.organization_id and n.id=b.node_id join minecraft_servers s on s.organization_id=b.organization_id and s.id=b.server_id where b.organization_id=$1 and b.node_id=$2 and b.released_at is null and n.state='active' and s.registered and b.server_id=any($3::uuid[]) order by b.server_id",
          [org, nodeId, ids],
        )
      ).rows;
      for (const server of servers) {
        let open = (
          await c.query<{
            id: string;
            kind: "scheduled" | "manual";
            state: "pending" | "running";
            node_id: string | null;
            requested_by: string | null;
            started_at: Date | null;
          }>(
            "select id,kind,state,node_id,requested_by,started_at from minecraft_backup_occurrences where organization_id=$1 and server_id=$2 and state in ('pending','running') order by created_at limit 1 for update",
            [org, server.server_id],
          )
        ).rows[0];
        if (open?.state === "running") {
          if (open.node_id === nodeId && open.started_at)
            return nodeBackupOffer.parse({
              occurrence_id: open.id,
              server_id: server.server_id,
              kind: open.kind,
              expires_at: new Date(
                open.started_at.getTime() + RUNNING_LEASE_MS,
              ).toISOString(),
            });
          continue;
        }
        if (await this.#latched(c, org, server.environment_id)) continue;
        if (!open) {
          const due = await this.#scheduleDue(c, org, server.server_id);
          if (!due.created) continue;
          open = {
            id: due.created,
            kind: "scheduled",
            state: "pending",
            node_id: null,
            requested_by: null,
            started_at: null,
          };
        }
        if (open.requested_by) {
          const member = (
            await c.query(
              "select 1 from memberships where organization_id=$1 and user_id=$2 and disabled_at is null",
              [org, open.requested_by],
            )
          ).rowCount;
          if (!member) {
            await this.#fail(c, org, open.id, "cancelled");
            continue;
          }
        }
        const started = new Date(this.#now());
        await c.query(
          "update minecraft_backup_occurrences set state='running',started_at=$3,node_id=$4 where organization_id=$1 and id=$2 and state='pending'",
          [org, open.id, started, nodeId],
        );
        await this.#nodeEvent(
          c,
          org,
          "server.backup_started",
          server.server_id,
          {
            occurrence_id: open.id,
            kind: open.kind,
            service_actor: nodeId,
          },
        );
        return nodeBackupOffer.parse({
          occurrence_id: open.id,
          server_id: server.server_id,
          kind: open.kind,
          expires_at: new Date(
            started.getTime() + RUNNING_LEASE_MS,
          ).toISOString(),
        });
      }
      return null;
    });
  }
  /**
   * The node's answer. Only the node the occurrence was handed to may settle it, and
   * only for the same server. A success carries the archive's hashes and is recorded as
   * verified, because the node reports success only after re-reading the archive
   * against its manifest. A repeat, or an answer after the occurrence was closed,
   * changes nothing and returns the recorded state; a late answer is still audited.
   */
  async recordNodeResult(
    org: string,
    nodeId: string,
    input: { occurrence_id: string; server_id: string; outcome: unknown },
  ) {
    const outcome = nodeBackupOutcome.parse(input.outcome);
    z.uuid().parse(input.occurrence_id);
    return this.#tx(org, async (c) => {
      const row = (
        await c.query<{
          id: string;
          server_id: string;
          state: "pending" | "running" | "complete" | "failed";
          node_id: string | null;
        }>(
          "select id,server_id,state,node_id from minecraft_backup_occurrences where organization_id=$1 and id=$2 for update",
          [org, input.occurrence_id],
        )
      ).rows[0];
      if (!row || row.node_id !== nodeId || row.server_id !== input.server_id)
        denied("BACKUP_RESULT_DENIED", 403);
      const reported = outcome.ok ? "complete" : "failed";
      if (row.state !== "running") {
        if (row.state !== reported)
          await this.#nodeEvent(
            c,
            org,
            "server.backup_late_result",
            row.server_id,
            { occurrence_id: row.id, reported, service_actor: nodeId },
          );
        return row.state;
      }
      if (outcome.ok)
        await this.#complete(
          c,
          org,
          row.id,
          {
            archive_sha256: outcome.archive_sha256,
            size_bytes: outcome.size_bytes,
            manifest_hash: outcome.manifest_hash,
          },
          true,
        );
      else await this.#fail(c, org, row.id, outcome.failure);
      await this.#nodeEvent(c, org, "server.backup_finished", row.server_id, {
        occurrence_id: row.id,
        state: reported,
        ...(outcome.ok ? {} : { failure: outcome.failure }),
        service_actor: nodeId,
      });
      return reported;
    });
  }
  /**
   * A backup a node started and never answered is recorded as interrupted after its
   * lease; "Back up now" that no host picked up within the hour is recorded as not
   * carried out. Nothing is retried: the next scheduled day, or a new request, starts
   * a fresh occurrence. A scheduled occurrence waiting out an emergency stop is kept.
   */
  async expireStale(org: string) {
    return this.#tx(org, async (c) => {
      const now = this.#now();
      const rows = (
        await c.query<{ id: string; state: "pending" | "running" }>(
          "select id,state from minecraft_backup_occurrences where organization_id=$1 and ((state='running' and started_at<=$2) or (state='pending' and kind='manual' and created_at<=$3)) order by created_at for update",
          [
            org,
            new Date(now - RUNNING_LEASE_MS),
            new Date(now - MANUAL_WAIT_MS),
          ],
        )
      ).rows;
      for (const r of rows)
        await this.#fail(
          c,
          org,
          r.id,
          r.state === "running" ? "interrupted" : "node_unavailable",
        );
      return rows.length;
    });
  }
}
