import { randomUUID } from "node:crypto";
import {
  AuthError,
  type ExecutionGrant,
  executionGrantSchema,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  deploymentAdmissionRequest,
  deploymentAdmissionView,
  deploymentApprovalDecisionRequest,
  deploymentApprovalDecisionView,
  deploymentApprovalEvidence,
  deploymentApprovalRequest,
  deploymentApprovalRequestView,
  deploymentApprovalRevocationRequest,
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
  project_id: string;
  environment_id: string;
  intent_id: string;
  actor_id: string;
  session_id: string;
  node_grant: unknown;
  server_grant: unknown;
  request_key: string;
  request_hash: string;
  stop_hash: string;
  review_hash: string;
  review: unknown;
  decision_id: string | null;
  created_at: Date;
  expires_at: Date;
}
interface ApprovalDecision {
  id: string;
  request_id: string;
  intent_id: string;
  environment_id: string;
  review: unknown;
  reviewer_id: string;
  reviewer_session_id: string;
  request_key: string;
  request_hash: string;
  review_hash: string;
  decision_hash: string;
  decision: "approved" | "rejected";
  reviewer_approval_grant: unknown;
  reviewer_node_grant: unknown;
  reviewer_server_grant: unknown;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
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
  async #stopState(c: pg.PoolClient, r: Intent) {
    await c.query("select set_config('app.runtime_internal','enabled',true)");
    try {
      const rows = (
        await c.query<{ latched: boolean }>(
          "select kind,scope_id,epoch,latched from runtime_stop_latches where kind='instance' or (kind='organization' and scope_id=$1) or (kind='environment' and scope_id=$2) order by kind,scope_id",
          [r.organization_id, r.environment_id],
        )
      ).rows;
      return { latched: rows.some((x) => x.latched), hash: nodeDigest(rows) };
    } finally {
      await c.query(
        "select set_config('app.runtime_internal','disabled',true)",
      );
    }
  }
  async #stop(c: pg.PoolClient, r: Intent) {
    const state = await this.#stopState(c, r);
    if (state.latched) deny("STOP_LATCHED", 403);
    return state.hash;
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
        "select q.*,d.id decision_id from minecraft_deployment_approval_requests q left join minecraft_deployment_approval_decisions d on (d.organization_id,d.request_id)=(q.organization_id,q.id) where q.organization_id=$1 and q.id=$2",
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
      state: r.decision_id ? "decided" : "awaiting_review",
      decision_id: r.decision_id,
      created_at: r.created_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
      expired: r.expires_at.getTime() <= this.#now(),
      execution_enabled: false,
      qualification: "unverified",
    });
  }
  #reviewOf(r: Intent) {
    return deploymentReviewSnapshot.parse({
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
              "select q.*,d.id decision_id from minecraft_deployment_approval_requests q left join minecraft_deployment_approval_decisions d on (d.organization_id,d.request_id)=(q.organization_id,q.id) where q.organization_id=$1 and (q.intent_id=$2 or (q.actor_id=$3 and q.request_key=$4))",
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
        const review = this.#reviewOf(r),
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
  async #decisionRead(c: pg.PoolClient, org: string, id: string) {
    return (
      await c.query<ApprovalDecision>(
        "select d.*,q.intent_id,q.environment_id,q.review,v.created_at revoked_at from minecraft_deployment_approval_decisions d join minecraft_deployment_approval_requests q on (q.organization_id,q.id)=(d.organization_id,d.request_id) left join minecraft_deployment_approval_revocations v on (v.organization_id,v.decision_id)=(d.organization_id,d.id) where d.organization_id=$1 and d.id=$2",
        [org, id],
      )
    ).rows[0];
  }
  #decisionView(d: ApprovalDecision) {
    return deploymentApprovalDecisionView.parse({
      operation_id: d.id,
      request_id: d.request_id,
      review_hash: d.review_hash,
      decision: d.decision,
      state:
        d.decision === "rejected"
          ? "rejected"
          : d.revoked_at
            ? "revoked"
            : d.expires_at.getTime() <= this.#now()
              ? "expired"
              : "approved",
      created_at: d.created_at.toISOString(),
      expires_at: d.expires_at.toISOString(),
      revoked_at: d.revoked_at?.toISOString() ?? null,
      execution_enabled: false,
      qualification: "unverified",
    });
  }
  /** An adult other than the requester. Self-review is refused, not merely unrecorded. */
  #reviewer(q: ApprovalRequest, p: Principal) {
    if (p.user.account_type !== "adult") deny("DEPLOYMENT_SCOPE_DENIED", 403);
    if (p.user.id === q.actor_id)
      deny("DEPLOYMENT_REVIEWER_NOT_INDEPENDENT", 403);
  }
  async #issued(c: pg.PoolClient, org: string, intent: string) {
    if (
      (
        await c.query(
          "select 1 from minecraft_deployment_jobs where organization_id=$1 and intent_id=$2",
          [org, intent],
        )
      ).rowCount
    )
      deny("DEPLOYMENT_ALREADY_ISSUED");
  }
  async #decisionReplay(
    c: pg.PoolClient,
    org: string,
    request: string,
    reviewer: string,
    key: string,
    hash: string,
  ) {
    const old = (
      await c.query<{ id: string }>(
        "select id from minecraft_deployment_approval_decisions where organization_id=$1 and (request_id=$2 or (reviewer_id=$3 and request_key=$4))",
        [org, request, reviewer, key],
      )
    ).rows[0];
    if (!old) return null;
    const d = await this.#decisionRead(c, org, old.id);
    if (!d) deny("NOT_FOUND", 404);
    if (d.reviewer_id === reviewer && d.request_key === key) {
      if (d.request_id !== request || d.request_hash !== hash)
        deny("IDEMPOTENCY_CONFLICT");
      return this.#decisionView(d);
    }
    deny(
      d.request_id === request
        ? "DEPLOYMENT_ALREADY_DECIDED"
        : "IDEMPOTENCY_CONFLICT",
    );
  }
  /** Checks shared by approve and reject: the exact live review and no issued work. */
  async #decidable(
    c: pg.PoolClient,
    org: string,
    q: ApprovalRequest,
    reviewHash: string,
  ) {
    if (q.expires_at.getTime() <= this.#now())
      deny("DEPLOYMENT_APPROVAL_REQUEST_EXPIRED");
    if (reviewHash !== q.review_hash) deny("DEPLOYMENT_REVIEW_MISMATCH");
    await this.#issued(c, org, q.intent_id);
  }
  /** Original binding plus proof the canonical plan is still the reviewed plan. */
  async #approvable(
    c: pg.PoolClient,
    org: string,
    q: ApprovalRequest,
    original: Principal,
  ) {
    const r = await this.#intent(c, org, q.intent_id);
    if (original.user.id !== q.actor_id || original.sessionId !== q.session_id)
      deny("DEPLOYMENT_SESSION_DENIED", 403);
    this.#binding(r, original);
    if (nodeDigest(this.#reviewOf(r)) !== nodeDigest(q.review))
      deny("DEPLOYMENT_REVIEW_STALE");
    if ((await this.#stop(c, r)) !== q.stop_hash)
      deny("DEPLOYMENT_STOP_CHANGED");
    return r;
  }
  async #saveDecision(
    c: pg.PoolClient,
    org: string,
    q: ApprovalRequest,
    p: Principal,
    d: {
      key: string;
      hash: string;
      decision: "approved" | "rejected";
      stop: string;
      expires: number;
      now: number;
      grants: readonly ExecutionGrant[];
    },
  ) {
    const id = randomUUID(),
      deadline = new Date(d.expires),
      decisionHash = nodeDigest({
        purpose: "deployment.decision.v1",
        decision_id: id,
        organization_id: org,
        request_id: q.id,
        review_hash: q.review_hash,
        reviewer_id: p.user.id,
        reviewer_session_id: p.sessionId,
        decision: d.decision,
        stop_hash: d.stop,
        grants_hash: nodeDigest(d.grants),
        expires_at: deadline.toISOString(),
      });
    await c.query(
      "insert into minecraft_deployment_approval_decisions(id,organization_id,request_id,reviewer_id,reviewer_session_id,request_key,request_hash,review_hash,stop_hash,decision_hash,decision,reviewer_approval_grant,reviewer_node_grant,reviewer_server_grant,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [
        id,
        org,
        q.id,
        p.user.id,
        p.sessionId,
        d.key,
        d.hash,
        q.review_hash,
        d.stop,
        decisionHash,
        d.decision,
        d.grants[0],
        d.grants[1] ?? null,
        d.grants[2] ?? null,
        new Date(d.now),
        deadline,
      ],
    );
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        org,
        p.user.id,
        d.decision === "approved"
          ? "server.deployment_review_approved"
          : "server.deployment_review_rejected",
        deploymentReviewSnapshot.parse(q.review).deployment_id,
        {
          operation_id: id,
          request_id: q.id,
          intent_id: q.intent_id,
          effects: "metadata_only",
        },
      ],
    );
    await c.query(
      "insert into minecraft_deployment_approval_decision_outbox(id,organization_id,decision_id,event,created_at) values($1,$2,$3,'decided',$4)",
      [randomUUID(), org, id, new Date(d.now)],
    );
    const saved = await this.#decisionRead(c, org, id);
    if (!saved) deny("DEPLOYMENT_DECISION_FAILED");
    return saved;
  }
  /**
   * Record one independent decision on an exact review. Approval needs both adults
   * current and the plan unchanged. Rejection only removes a path to execution, so it
   * needs just the reviewer and stays available during a stop. Neither enables anything.
   */
  async decideApproval(
    token: string,
    org: string,
    input: unknown,
    key: string,
  ) {
    const v = deploymentApprovalDecisionRequest.parse(input);
    z.uuid().parse(key);
    const auth = this.options.auth,
      q = await auth.guardOrganization(token, org, "organization:read", () =>
        this.#tx(org, (c) => this.#approvalRead(c, org, v.request_id)),
      );
    if (!q) deny("NOT_FOUND", 404);
    const environment = { kind: "environment", id: q.environment_id } as const,
      grants = [
        await auth.issueExecutionGrant(
          token,
          org,
          "approval:decide",
          environment,
        ),
      ],
      hash = nodeDigest(v);
    if (v.decision === "rejected")
      return auth.guardExecutions(grants, (p) =>
        this.#tx(org, async (c) => {
          this.#reviewer(q, p);
          const replay = await this.#decisionReplay(
            c,
            org,
            q.id,
            p.user.id,
            key,
            hash,
          );
          if (replay) return replay;
          await this.#decidable(c, org, q, v.review_hash);
          const r = await this.#intent(c, org, q.intent_id),
            now = this.#now();
          return this.#decisionView(
            await this.#saveDecision(c, org, q, p, {
              key,
              hash,
              decision: "rejected",
              stop: (await this.#stopState(c, r)).hash,
              expires: q.expires_at.getTime(),
              now,
              grants,
            }),
          );
        }),
      );
    grants.push(
      await auth.issueExecutionGrant(token, org, "node:deploy", {
        kind: "project",
        id: q.project_id,
      }),
      await auth.issueExecutionGrant(
        token,
        org,
        "server:provision",
        environment,
      ),
    );
    const replay = await auth.guardExecutions(grants, (p) =>
      this.#tx(org, (c) => {
        this.#reviewer(q, p);
        return this.#decisionReplay(c, org, q.id, p.user.id, key, hash);
      }),
    );
    if (replay) return replay;
    return auth.guardIndependentExecutions(
      [
        executionGrantSchema.parse(q.node_grant),
        executionGrantSchema.parse(q.server_grant),
      ],
      grants,
      (original, reviewer) =>
        this.#tx(org, async (c) => {
          this.#reviewer(q, reviewer);
          const raced = await this.#decisionReplay(
            c,
            org,
            q.id,
            reviewer.user.id,
            key,
            hash,
          );
          if (raced) return raced;
          await this.#decidable(c, org, q, v.review_hash);
          const r = await this.#approvable(c, org, q, original),
            now = this.#now(),
            expires = Math.min(
              q.expires_at.getTime(),
              original.authorityExpiresAt ?? 0,
              reviewer.authorityExpiresAt ?? 0,
              r.credential_expires_at.getTime(),
            );
          if (expires <= now) deny("DEPLOYMENT_APPROVAL_REQUEST_EXPIRED");
          const saved = await this.#saveDecision(c, org, q, reviewer, {
            key,
            hash,
            decision: "approved",
            stop: q.stop_hash,
            expires,
            now,
            grants,
          });
          if ((await this.#stop(c, r)) !== q.stop_hash)
            deny("DEPLOYMENT_STOP_CHANGED");
          if (expires <= this.#now())
            deny("DEPLOYMENT_APPROVAL_REQUEST_EXPIRED");
          return this.#decisionView(saved);
        }),
    );
  }
  /**
   * Withdraw an approval before work is issued. Available to any current adult with
   * review authority, including during a stop. It cannot recall issued work; stop
   * latches own that, so a revocation after issue is refused rather than implying it.
   */
  async revokeApproval(
    token: string,
    org: string,
    input: unknown,
    key: string,
  ) {
    const v = deploymentApprovalRevocationRequest.parse(input);
    z.uuid().parse(key);
    const auth = this.options.auth,
      d = await auth.guardOrganization(token, org, "organization:read", () =>
        this.#tx(org, (c) => this.#decisionRead(c, org, v.decision_id)),
      );
    if (!d) deny("NOT_FOUND", 404);
    const grant = await auth.issueExecutionGrant(
        token,
        org,
        "approval:decide",
        { kind: "environment", id: d.environment_id },
      ),
      hash = nodeDigest(v);
    return auth.guardExecutions([grant], (p) =>
      this.#tx(org, async (c) => {
        if (p.user.account_type !== "adult")
          deny("DEPLOYMENT_SCOPE_DENIED", 403);
        const current = await this.#decisionRead(c, org, d.id);
        if (!current) deny("NOT_FOUND", 404);
        const old = (
          await c.query<{
            decision_id: string;
            actor_id: string;
            request_key: string;
            request_hash: string;
          }>(
            "select decision_id,actor_id,request_key,request_hash from minecraft_deployment_approval_revocations where organization_id=$1 and (decision_id=$2 or (actor_id=$3 and request_key=$4))",
            [org, d.id, p.user.id, key],
          )
        ).rows[0];
        if (old) {
          if (old.actor_id === p.user.id && old.request_key === key) {
            if (old.decision_id !== d.id || old.request_hash !== hash)
              deny("IDEMPOTENCY_CONFLICT");
            return this.#decisionView(current);
          }
          deny(
            old.decision_id === d.id
              ? "DEPLOYMENT_ALREADY_REVOKED"
              : "IDEMPOTENCY_CONFLICT",
          );
        }
        if (current.decision !== "approved")
          deny("DEPLOYMENT_DECISION_NOT_REVOCABLE");
        await this.#issued(c, org, current.intent_id);
        const now = new Date(this.#now()),
          id = randomUUID();
        await c.query(
          "insert into minecraft_deployment_approval_revocations(id,organization_id,decision_id,actor_id,session_id,request_key,request_hash,approval_grant,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [id, org, d.id, p.user.id, p.sessionId, key, hash, grant, now],
        );
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,'server.deployment_review_revoked',$3,'allowed',$4)",
          [
            org,
            p.user.id,
            deploymentReviewSnapshot.parse(current.review).deployment_id,
            {
              operation_id: id,
              decision_id: d.id,
              intent_id: current.intent_id,
              effects: "metadata_only",
            },
          ],
        );
        await c.query(
          "insert into minecraft_deployment_approval_decision_outbox(id,organization_id,decision_id,event,created_at) values($1,$2,$3,'revoked',$4)",
          [randomUUID(), org, d.id, now],
        );
        const saved = await this.#decisionRead(c, org, d.id);
        if (!saved) deny("DEPLOYMENT_DECISION_FAILED");
        return this.#decisionView(saved);
      }),
    );
  }
  async approvalDecision(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const d = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () => this.#tx(org, (c) => this.#decisionRead(c, org, id)),
    );
    if (!d) deny("NOT_FOUND", 404);
    const located = await this.#locate(token, org, d.intent_id);
    return this.#scope(token, org, located, async (c) => {
      const current = await this.#decisionRead(c, org, id);
      if (!current) deny("NOT_FOUND", 404);
      return this.#decisionView(current);
    });
  }
  /**
   * Trusted composition only: revalidate a saved approval before use. Both adults must
   * still hold their sealed authority and the reviewed plan must be unchanged. Returns
   * evidence, never a grant; host, game and recovery qualification stay separate.
   */
  async currentApproval(org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.#tx(org, async (c) => {
      const d = await this.#decisionRead(c, org, id);
      if (!d) deny("NOT_FOUND", 404);
      const q = await this.#approvalRead(c, org, d.request_id);
      if (!q) deny("NOT_FOUND", 404);
      return { d, q };
    });
    const { d, q } = located;
    if (d.decision !== "approved" || d.revoked_at)
      deny("DEPLOYMENT_APPROVAL_NOT_CURRENT");
    return this.options.auth.guardIndependentExecutions(
      [
        executionGrantSchema.parse(q.node_grant),
        executionGrantSchema.parse(q.server_grant),
      ],
      [
        executionGrantSchema.parse(d.reviewer_approval_grant),
        executionGrantSchema.parse(d.reviewer_node_grant),
        executionGrantSchema.parse(d.reviewer_server_grant),
      ],
      (original, reviewer) =>
        this.#tx(org, async (c) => {
          const current = await this.#decisionRead(c, org, id);
          if (
            !current ||
            current.revoked_at ||
            reviewer.user.id !== current.reviewer_id ||
            reviewer.sessionId !== current.reviewer_session_id
          )
            deny("DEPLOYMENT_APPROVAL_NOT_CURRENT");
          this.#reviewer(q, reviewer);
          await this.#issued(c, org, q.intent_id);
          const r = await this.#approvable(c, org, q, original),
            expires = Math.min(
              current.expires_at.getTime(),
              original.authorityExpiresAt ?? 0,
              reviewer.authorityExpiresAt ?? 0,
              r.credential_expires_at.getTime(),
            );
          if (expires <= this.#now()) deny("DEPLOYMENT_APPROVAL_NOT_CURRENT");
          return deploymentApprovalEvidence.parse({
            decision_id: current.id,
            request_id: q.id,
            intent_id: q.intent_id,
            approval_hash: current.decision_hash,
            review_hash: current.review_hash,
            expires_at: new Date(expires).toISOString(),
            execution_enabled: false,
            qualification: "unverified",
          });
        }),
    );
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
