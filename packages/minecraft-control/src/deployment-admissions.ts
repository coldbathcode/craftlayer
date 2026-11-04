import { randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  deploymentAdmissionRequest,
  deploymentAdmissionView,
  deploymentApprovalRequest,
  deploymentApprovalRequestView,
  deploymentJobView,
  deploymentReviewSnapshot,
} from "@craftlayer/contracts";
import { canAccess } from "@craftlayer/core";
import { nodeDigest } from "@craftlayer/node-protocol";
import pg from "pg";
import { z } from "zod";

interface Intent {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  node_id: string;
  reservation_id: string;
  actor_id: string;
  session_id: string;
  deployment_id: string;
  reservation_state: string;
  node_version: number;
  credential_version: number;
  current_node_version: number;
  current_credential_version: number;
  node_state: string;
  credential_expires_at: Date;
  environment_type: string;
  server_id: string;
  world_id: string;
  name: string;
  template_id: string;
  plan_hash: string;
  template_hash: string;
  policy_hash: string;
  reservation_version: number;
  cpu_milli: number;
  memory_mb: number;
  disk_mb: number;
  java_port: number;
  bedrock_port: number;
}
interface ApprovalRequest {
  id: string;
  intent_id: string;
  request_key: string;
  request_hash: string;
  stop_hash: string;
  review_hash: string;
  review: unknown;
  created_at: Date;
  expires_at: Date;
}
interface Admission {
  id: string;
  intent_id: string;
  reservation_id: string;
  deployment_id: string;
  actor_id: string;
  session_id: string;
  request_key: string;
  request_hash: string;
  stop_hash: string;
  expires_at: Date;
  job_id: string | null;
}
function deny(code: string, status = 409): never {
  throw new AuthError(
    status,
    code,
    "Deployment authority admission denied; verify current scope and operation state.",
  );
}
/** Human/API-only sealed authority intake. No control key, signer, qualifier, worker or Docker port. */
export class DeploymentAdmissions {
  #pool: pg.Pool;
  #lastWall = 0;
  constructor(
    private readonly options: {
      databaseUrl: string;
      auth: IdentityService;
      clock?: () => number;
    },
  ) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 4,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      idleTimeoutMillis: 10000,
    });
  }
  close() {
    return this.#pool.end();
  }
  #now() {
    const n = (this.options.clock ?? Date.now)();
    if (!Number.isSafeInteger(n) || n < this.#lastWall)
      deny("DEPLOYMENT_CLOCK_ROLLBACK", 503);
    this.#lastWall = n;
    return n;
  }
  async #tx<T>(org: string, fn: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.#pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.organization_id',$1,true)", [
        z.uuid().parse(org),
      ]);
      await c.query(
        "select pg_advisory_xact_lock(hashtextextended($1,74618020))",
        [org],
      );
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
  async #intent(c: pg.PoolClient, org: string, id: string) {
    const r = (
      await c.query<Intent>(
        "select i.*,r.deployment_id,r.server_id,r.world_id,r.name,r.template_id,r.plan_hash,r.template_hash,r.policy_hash,r.version reservation_version,r.cpu_milli,r.memory_mb,r.disk_mb,r.java_port,r.bedrock_port,r.state reservation_state,r.node_version,r.credential_version,n.version current_node_version,n.credential_version current_credential_version,n.state node_state,k.expires_at credential_expires_at,e.type environment_type from minecraft_deployment_intents i join minecraft_reservations r on (r.organization_id,r.id)=(i.organization_id,i.reservation_id) join minecraft_nodes n on (n.organization_id,n.id)=(i.organization_id,i.node_id) join minecraft_node_credentials k on (k.organization_id,k.node_id,k.version)=(n.organization_id,n.id,n.credential_version) join environments e on (e.organization_id,e.project_id,e.id)=(r.organization_id,r.project_id,r.environment_id) where i.organization_id=$1 and i.id=$2 for update of n,r",
        [org, z.uuid().parse(id)],
      )
    ).rows[0];
    if (!r) deny("NOT_FOUND", 404);
    return r;
  }
  async #locate(token: string, org: string, id: string) {
    return this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#intent(c, org, id)),
    );
  }
  #scope<T>(
    token: string,
    org: string,
    r: Intent,
    fn: (c: pg.PoolClient, p: Principal) => Promise<T>,
  ) {
    return this.options.auth.guardResource(
      token,
      org,
      "node:deploy",
      { kind: "project", id: r.project_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const current = await this.#intent(c, org, r.id);
          if (
            p.user.account_type !== "adult" ||
            current.environment_type !== "minecraft" ||
            !canAccess(a, "server:provision", {
              kind: "environment",
              id: current.environment_id,
              projectId: current.project_id,
              environmentType: current.environment_type,
            })
          )
            deny("DEPLOYMENT_SCOPE_DENIED", 403);
          return fn(c, p);
        }),
    );
  }
  #binding(r: Intent, p: Principal) {
    if (
      r.actor_id !== p.user.id ||
      r.session_id !== p.sessionId ||
      p.user.account_type !== "adult"
    )
      deny("DEPLOYMENT_SESSION_DENIED", 403);
    if (
      r.reservation_state !== "allocated" ||
      r.environment_type !== "minecraft" ||
      r.node_state !== "active" ||
      r.node_version !== r.current_node_version ||
      r.credential_version !== r.current_credential_version ||
      r.credential_expires_at.getTime() <= this.#now()
    )
      deny("DEPLOYMENT_BINDING_STALE");
  }
  async #stop(c: pg.PoolClient, r: Intent) {
    await c.query("select set_config('app.runtime_internal','enabled',true)");
    try {
      const rows = (
        await c.query<{ latched: boolean }>(
          "select kind,scope_id,epoch,latched from runtime_stop_latches where kind='instance' or (kind='organization' and scope_id=$1) or (kind='environment' and scope_id=$2) order by kind,scope_id",
          [r.organization_id, r.environment_id],
        )
      ).rows;
      if (rows.some((x) => x.latched)) deny("STOP_LATCHED", 403);
      return nodeDigest(rows);
    } finally {
      await c.query(
        "select set_config('app.runtime_internal','disabled',true)",
      );
    }
  }
  async #read(c: pg.PoolClient, org: string, id: string) {
    return (
      await c.query<Admission>(
        "select a.*,r.deployment_id,j.id job_id from minecraft_deployment_authorizations a join minecraft_reservations r on (r.organization_id,r.id)=(a.organization_id,a.reservation_id) left join minecraft_deployment_jobs j on (j.organization_id,j.authorization_id)=(a.organization_id,a.id) where a.organization_id=$1 and a.id=$2",
        [org, id],
      )
    ).rows[0];
  }
  #view(a: Admission) {
    return deploymentAdmissionView.parse({
      operation_id: a.id,
      intent_id: a.intent_id,
      deployment_id: a.deployment_id,
      reservation_id: a.reservation_id,
      authorization_state:
        a.expires_at.getTime() > this.#now() ? "active" : "expired",
      expires_at: a.expires_at.toISOString(),
      effects: "metadata_only",
      job_id: a.job_id,
    });
  }
  async #approvalRead(c: pg.PoolClient, org: string, id: string) {
    return (
      await c.query<ApprovalRequest>(
        "select * from minecraft_deployment_approval_requests where organization_id=$1 and id=$2",
        [org, id],
      )
    ).rows[0];
  }
  #approvalView(r: ApprovalRequest) {
    return deploymentApprovalRequestView.parse({
      operation_id: r.id,
      intent_id: r.intent_id,
      review_hash: r.review_hash,
      review: r.review,
      state: "awaiting_review",
      created_at: r.created_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
      expired: r.expires_at.getTime() <= this.#now(),
      execution_enabled: false,
      qualification: "unverified",
    });
  }
  /** Persist review material only; no decision, grant, qualifier or dispatch. */
  async requestApproval(
    token: string,
    org: string,
    input: unknown,
    key: string,
  ) {
    const v = deploymentApprovalRequest.parse(input);
    z.uuid().parse(key);
    const located = await this.#locate(token, org, v.intent_id);
    const grants = [
      await this.options.auth.issueExecutionGrant(token, org, "node:deploy", {
        kind: "project",
        id: located.project_id,
      }),
      await this.options.auth.issueExecutionGrant(
        token,
        org,
        "server:provision",
        { kind: "environment", id: located.environment_id },
      ),
    ];
    return this.options.auth.guardExecutions(grants, (p) =>
      this.#tx(org, async (c) => {
        const r = await this.#intent(c, org, v.intent_id);
        this.#binding(r, p);
        const stop = await this.#stop(c, r),
          hash = nodeDigest(v),
          old = (
            await c.query<ApprovalRequest>(
              "select * from minecraft_deployment_approval_requests where organization_id=$1 and (intent_id=$2 or (actor_id=$3 and request_key=$4))",
              [org, r.id, p.user.id, key],
            )
          ).rows[0];
        if (old) {
          if (
            old.intent_id !== r.id ||
            old.request_key !== key ||
            old.request_hash !== hash
          )
            deny("IDEMPOTENCY_CONFLICT");
          if (old.stop_hash !== stop) deny("DEPLOYMENT_STOP_CHANGED");
          return this.#approvalView(old);
        }
        if (
          (
            await c.query(
              "select 1 from minecraft_deployment_jobs where organization_id=$1 and intent_id=$2",
              [org, r.id],
            )
          ).rowCount
        )
          deny("DEPLOYMENT_ALREADY_ISSUED");
        const now = this.#now(),
          expires = Math.min(
            now + 300000,
            p.authorityExpiresAt ?? 0,
            r.credential_expires_at.getTime(),
          );
        if (expires <= now) deny("DEPLOYMENT_APPROVAL_REQUEST_EXPIRED");
        const review = deploymentReviewSnapshot.parse({
            schema_version: 1,
            project_id: r.project_id,
            environment_id: r.environment_id,
            node_id: r.node_id,
            reservation_id: r.reservation_id,
            deployment_id: r.deployment_id,
            server_id: r.server_id,
            world_id: r.world_id,
            name: r.name,
            template_id: r.template_id,
            plan_hash: r.plan_hash,
            policy_hash: r.policy_hash,
            template_hash: r.template_hash,
            node_version: r.node_version,
            credential_version: r.credential_version,
            reservation_version: r.reservation_version,
            cpu_milli: r.cpu_milli,
            memory_mb: r.memory_mb,
            disk_mb: r.disk_mb,
            java_port: r.java_port,
            bedrock_port: r.bedrock_port,
          }),
          id = randomUUID(),
          deadline = new Date(expires).toISOString(),
          reviewHash = nodeDigest({
            purpose: "deployment.review.v1",
            request_id: id,
            organization_id: org,
            intent_id: r.id,
            actor_id: p.user.id,
            session_id: p.sessionId,
            stop_hash: stop,
            grants_hash: nodeDigest(grants),
            expires_at: deadline,
            review,
          });
        await c.query(
          "insert into minecraft_deployment_approval_requests(id,organization_id,project_id,environment_id,node_id,reservation_id,intent_id,actor_id,session_id,request_key,request_hash,stop_hash,review_hash,review,created_at,expires_at,node_grant,server_grant) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)",
          [
            id,
            org,
            r.project_id,
            r.environment_id,
            r.node_id,
            r.reservation_id,
            r.id,
            p.user.id,
            p.sessionId,
            key,
            hash,
            stop,
            reviewHash,
            review,
            new Date(now),
            new Date(expires),
            grants[0],
            grants[1],
          ],
        );
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,'server.deployment_review_requested',$3,'allowed',$4)",
          [
            org,
            p.user.id,
            r.deployment_id,
            { operation_id: id, intent_id: r.id, effects: "metadata_only" },
          ],
        );
        await c.query(
          "insert into minecraft_deployment_approval_request_outbox(id,organization_id,request_id,created_at) values($1,$2,$3,$4)",
          [randomUUID(), org, id, new Date(now)],
        );
        if ((await this.#stop(c, r)) !== stop) deny("DEPLOYMENT_STOP_CHANGED");
        if (expires <= this.#now()) deny("DEPLOYMENT_APPROVAL_REQUEST_EXPIRED");
        const saved = await this.#approvalRead(c, org, id);
        if (!saved) deny("DEPLOYMENT_APPROVAL_REQUEST_FAILED");
        return this.#approvalView(saved);
      }),
    );
  }
  async approvalRequest(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const r = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#approvalRead(c, org, id)),
    );
    if (!r) deny("NOT_FOUND", 404);
    const located = await this.#locate(token, org, r.intent_id);
    return this.#scope(token, org, located, async (c) => {
      const current = await this.#approvalRead(c, org, id);
      if (!current) deny("NOT_FOUND", 404);
      return this.#approvalView(current);
    });
  }
  async admit(token: string, org: string, input: unknown, key: string) {
    const v = deploymentAdmissionRequest.parse(input);
    z.uuid().parse(key);
    const located = await this.#locate(token, org, v.intent_id);
    const replay = await this.#scope(token, org, located, async (c, p) => {
      const r = await this.#intent(c, org, v.intent_id);
      this.#binding(r, p);
      const stop = await this.#stop(c, r),
        old = (
          await c.query<{ id: string }>(
            "select id from minecraft_deployment_authorizations where organization_id=$1 and (intent_id=$2 or (actor_id=$3 and request_key=$4))",
            [org, v.intent_id, p.user.id, key],
          )
        ).rows[0];
      if (!old) return null;
      const a = await this.#read(c, org, old.id);
      if (
        !a ||
        a.intent_id !== v.intent_id ||
        a.request_key !== key ||
        a.request_hash !== nodeDigest(v)
      )
        deny("IDEMPOTENCY_CONFLICT");
      if (a.stop_hash !== stop || a.expires_at.getTime() <= this.#now())
        deny("DEPLOYMENT_AUTHORIZATION_STALE");
      return this.#view(a);
    });
    if (replay) return replay;
    const grants = [
      await this.options.auth.issueExecutionGrant(token, org, "node:deploy", {
        kind: "project",
        id: located.project_id,
      }),
      await this.options.auth.issueExecutionGrant(
        token,
        org,
        "server:provision",
        { kind: "environment", id: located.environment_id },
      ),
    ];
    return this.options.auth.guardExecutions(grants, (p) =>
      this.#tx(org, async (c) => {
        const r = await this.#intent(c, org, v.intent_id);
        this.#binding(r, p);
        const stop = await this.#stop(c, r),
          hash = nodeDigest(v),
          oldId = (
            await c.query<{ id: string }>(
              "select id from minecraft_deployment_authorizations where organization_id=$1 and (intent_id=$2 or (actor_id=$3 and request_key=$4))",
              [org, v.intent_id, p.user.id, key],
            )
          ).rows[0];
        if (oldId) {
          const a = await this.#read(c, org, oldId.id);
          if (
            !a ||
            a.intent_id !== v.intent_id ||
            a.request_key !== key ||
            a.request_hash !== hash
          )
            deny("IDEMPOTENCY_CONFLICT");
          if (a.stop_hash !== stop || a.expires_at.getTime() <= this.#now())
            deny("DEPLOYMENT_AUTHORIZATION_STALE");
          return this.#view(a);
        }
        const now = this.#now(),
          expires = Math.min(
            now + 120000,
            p.authorityExpiresAt ?? 0,
            r.credential_expires_at.getTime(),
          );
        if (expires <= now) deny("DEPLOYMENT_AUTHORIZATION_STALE");
        const id = randomUUID();
        await c.query(
          "insert into minecraft_deployment_authorizations(id,organization_id,project_id,environment_id,node_id,reservation_id,intent_id,actor_id,session_id,request_key,request_hash,stop_hash,node_grant,server_grant,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
          [
            id,
            org,
            r.project_id,
            r.environment_id,
            r.node_id,
            r.reservation_id,
            r.id,
            p.user.id,
            p.sessionId,
            key,
            hash,
            stop,
            grants[0],
            grants[1],
            new Date(now),
            new Date(expires),
          ],
        );
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,'server.deployment_authorized',$3,'allowed',$4)",
          [
            org,
            p.user.id,
            r.deployment_id,
            {
              operation_id: id,
              intent_id: r.id,
              source: "deployment_authority_admission",
              effects: "metadata_only",
            },
          ],
        );
        await c.query(
          "insert into minecraft_deployment_authorization_outbox(id,organization_id,authorization_id,created_at) values($1,$2,$3,$4)",
          [randomUUID(), org, id, new Date(now)],
        );
        if ((await this.#stop(c, r)) !== stop) deny("DEPLOYMENT_STOP_CHANGED");
        const a = await this.#read(c, org, id);
        if (!a) deny("DEPLOYMENT_AUTHORIZATION_FAILED");
        if (a.expires_at.getTime() <= this.#now())
          deny("DEPLOYMENT_AUTHORIZATION_STALE");
        return this.#view(a);
      }),
    );
  }
  async get(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const a = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#read(c, org, id)),
    );
    if (!a) deny("NOT_FOUND", 404);
    const r = await this.#locate(token, org, a.intent_id);
    return this.#scope(token, org, r, async (c) => {
      const row = await this.#read(c, org, id);
      if (!row) deny("NOT_FOUND", 404);
      return this.#view(row);
    });
  }
  async job(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const row = (
            await c.query<{ intent_id: string }>(
              "select intent_id from minecraft_deployment_jobs where organization_id=$1 and id=$2",
              [org, id],
            )
          ).rows[0];
          if (!row) deny("NOT_FOUND", 404);
          return row;
        }),
    );
    const r = await this.#locate(token, org, located.intent_id);
    return this.#scope(token, org, r, async (c) => {
      const row = (
        await c.query<{ created_at: Date; lease_expires_at: Date }>(
          "select j.id operation_id,j.intent_id,r.deployment_id,r.server_id,r.world_id,j.node_id,j.project_id,j.environment_id,j.state,j.command_hash,j.lease_expires_at,j.created_at,j.receipt->'payload'->>'state' receipt_state from minecraft_deployment_jobs j join minecraft_reservations r on (r.organization_id,r.id)=(j.organization_id,j.reservation_id) where j.organization_id=$1 and j.id=$2",
          [org, id],
        )
      ).rows[0];
      if (!row) deny("NOT_FOUND", 404);
      return deploymentJobView.parse({
        ...row,
        created_at: row.created_at.toISOString(),
        lease_expires_at: row.lease_expires_at.toISOString(),
      });
    });
  }
  async operation(token: string, org: string, id: string) {
    const kind = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const row = (
            await c.query<{ kind: string }>(
              "select 'admission' kind from minecraft_deployment_authorizations where organization_id=$1 and id=$2 union all select 'job' kind from minecraft_deployment_jobs where organization_id=$1 and id=$2 limit 1",
              [org, z.uuid().parse(id)],
            )
          ).rows[0];
          if (!row) deny("NOT_FOUND", 404);
          return row.kind;
        }),
    );
    return kind === "admission"
      ? this.get(token, org, id)
      : this.job(token, org, id);
  }
}
