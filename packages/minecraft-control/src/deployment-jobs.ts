import { randomUUID } from "node:crypto";
import {
  AuthError,
  type ExecutionGrant,
  executionGrantSchema,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  deploymentJobRequest,
  deploymentJobView,
  deploymentQualification,
  type NodeCommand,
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodeCommandReceipt,
  signedNodeJobRequest,
} from "@craftlayer/contracts";
import { canAccess } from "@craftlayer/core";
import {
  assertNodeTime,
  nodeDigest,
  nodePrivateKey,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import pg from "pg";
import { z } from "zod";
import {
  type DeploymentDispatchScope,
  deploymentDispatchScope,
} from "./deployment-dispatcher.js";
import type {
  DeploymentAuthorizer,
  DeploymentPrincipal,
} from "./execution-authorizer.js";

export interface DeploymentQualificationContext {
  phase: "issue" | "fetch" | "permit";
  request_hash: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  node_id: string;
  job_id: string;
  actor_id: string;
  session_id: string;
  reservation_id: string;
  deployment_id: string;
  world_id: string;
  plan_hash: string;
  template_hash: string;
  policy_hash: string;
  node_version: number;
  credential_version: number;
}
export interface DeploymentQualifier {
  /** Private approval + actual host/world qualification; absent by default. */
  inspect(
    context: DeploymentQualificationContext,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface NodePeer {
  certificate_sha256: string;
  certificate_expires_at: number;
}
interface Binding {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  node_id: string;
  reservation_id: string;
  actor_id: string;
  session_id: string;
  deployment_id: string;
  server_id: string;
  world_id: string;
  plan_hash: string;
  policy_hash: string;
  template_hash: string;
  environment_type: string;
  reservation_state: string;
  node_version: number;
  current_node_version: number;
  credential_version: number;
  current_credential_version: number;
  node_state: string;
  credential_expires_at: Date;
  public_key: string;
  certificate_sha256: string;
  last_seen_at: Date | null;
}
interface Job extends Binding {
  intent_id: string;
  request_key: string;
  request_hash: string;
  node_grant: ExecutionGrant;
  server_grant: ExecutionGrant;
  command: z.infer<typeof signedNodeCommand>;
  command_hash: string;
  stop_hash: string;
  lease_id: string;
  state:
    | "issued"
    | "succeeded"
    | "rolled_back"
    | "not_dispatched"
    | "uncertain";
  version: number;
  receipt: z.infer<typeof signedNodeCommandReceipt> | null;
  created_at: Date;
  lease_expires_at: Date;
}
const bindingColumns =
  "e.type environment_type,r.deployment_id,r.server_id,r.world_id,r.plan_hash,r.template_hash,r.policy_hash,r.state reservation_state,r.node_version,n.version current_node_version,n.credential_version current_credential_version,n.state node_state,k.expires_at credential_expires_at,k.public_key,k.certificate_sha256,n.last_seen_at";
const optionsPolicy = z.strictObject({
  revision: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  stop_generation: z.number().int().nonnegative().max(2147483646),
});
function deny(code: string, status = 409): never {
  throw new AuthError(
    status,
    code,
    "Deployment command denied; verify current authority, qualification and operation state.",
  );
}
/** Durable first-provision controller. No public route, retry/takeover or production qualifier is installed. */
export class DeploymentJobs {
  #pool: pg.Pool;
  #public: string;
  #policy: z.infer<typeof optionsPolicy>;
  #lastWall = 0;
  constructor(
    private readonly options: {
      databaseUrl: string;
      auth?: IdentityService;
      authorizer?: DeploymentAuthorizer;
      controlPrivateKey: string;
      policy: unknown;
      qualifier?: DeploymentQualifier;
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
    this.#public = nodePrivateKey(options.controlPrivateKey).public_key;
    this.#policy = optionsPolicy.parse(options.policy);
  }
  #auth() {
    if (!this.options.auth) deny("DEPLOYMENT_HUMAN_AUTH_NOT_INSTALLED", 503);
    return this.options.auth;
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
      await c.query<Binding>(
        `select i.*,r.credential_version,${bindingColumns} from minecraft_deployment_intents i join minecraft_reservations r on (r.organization_id,r.id)=(i.organization_id,i.reservation_id) join environments e on (e.organization_id,e.project_id,e.id)=(r.organization_id,r.project_id,r.environment_id) join minecraft_nodes n on (n.organization_id,n.id)=(i.organization_id,i.node_id) join minecraft_node_credentials k on (k.organization_id,k.node_id,k.version)=(n.organization_id,n.id,r.credential_version) where i.organization_id=$1 and i.id=$2 for update of n`,
        [org, z.uuid().parse(id)],
      )
    ).rows[0];
    if (!r) deny("NOT_FOUND", 404);
    return r;
  }
  async #job(c: pg.PoolClient, org: string, id: string) {
    const r = (
      await c.query<Job>(
        `select j.*,${bindingColumns} from minecraft_deployment_jobs j join minecraft_reservations r on (r.organization_id,r.id)=(j.organization_id,j.reservation_id) join environments e on (e.organization_id,e.project_id,e.id)=(r.organization_id,r.project_id,r.environment_id) join minecraft_nodes n on (n.organization_id,n.id)=(j.organization_id,j.node_id) join minecraft_node_credentials k on (k.organization_id,k.node_id,k.version)=(n.organization_id,n.id,j.credential_version) where j.organization_id=$1 and j.id=$2 for update of j,n`,
        [org, z.uuid().parse(id)],
      )
    ).rows[0];
    if (!r) deny("NOT_FOUND", 404);
    r.command = signedNodeCommand.parse(r.command);
    r.node_grant = executionGrantSchema.parse(r.node_grant);
    r.server_grant = executionGrantSchema.parse(r.server_grant);
    if (r.receipt) r.receipt = signedNodeCommandReceipt.parse(r.receipt);
    return r;
  }
  async #locate(
    token: string,
    org: string,
    id: string,
    kind: "intent" | "job",
  ) {
    return this.#auth().guardOrganization(token, org, "organization:read", () =>
      this.#tx(org, (c) =>
        kind === "intent" ? this.#intent(c, org, id) : this.#job(c, org, id),
      ),
    );
  }
  #human<T>(
    token: string,
    org: string,
    r: Binding,
    fn: (c: pg.PoolClient, p: Principal) => Promise<T>,
  ) {
    return this.#auth().guardResource(
      token,
      org,
      "node:deploy",
      { kind: "project", id: r.project_id },
      (p, a) =>
        this.#tx(org, async (c) => {
          const e = (
            await c.query<{ type: string; project_id: string }>(
              "select type,project_id from environments where organization_id=$1 and id=$2",
              [org, r.environment_id],
            )
          ).rows[0];
          if (
            p.user.account_type !== "adult" ||
            e?.type !== "minecraft" ||
            e.project_id !== r.project_id ||
            !canAccess(a, "server:provision", {
              kind: "environment",
              id: r.environment_id,
              projectId: r.project_id,
              environmentType: "minecraft",
            })
          )
            deny("DEPLOYMENT_SCOPE_DENIED", 403);
          return fn(c, p);
        }),
    );
  }
  #grants(r: Binding, grants: readonly ExecutionGrant[]) {
    const [n, s] = grants;
    if (
      !n ||
      !s ||
      n.permission !== "node:deploy" ||
      n.resource.kind !== "project" ||
      n.resource.id !== r.project_id ||
      s.permission !== "server:provision" ||
      s.resource.kind !== "environment" ||
      s.resource.id !== r.environment_id ||
      grants.some(
        (g) =>
          g.organizationId !== r.organization_id ||
          g.userId !== r.actor_id ||
          g.sessionId !== r.session_id,
      )
    )
      deny("DEPLOYMENT_GRANT_BINDING_DENIED", 403);
  }
  #guard<T>(
    r: Binding,
    grants: readonly ExecutionGrant[],
    fn: (c: pg.PoolClient, p: DeploymentPrincipal) => Promise<T>,
  ) {
    this.#grants(r, grants);
    const authorizer: DeploymentAuthorizer | undefined =
      this.options.authorizer ?? this.options.auth;
    if (!authorizer) deny("DEPLOYMENT_AUTHORITY_UNAVAILABLE", 503);
    return authorizer.guardExecutions(grants, (p) => {
      if (
        p.user.account_type !== "adult" ||
        p.user.id !== r.actor_id ||
        p.sessionId !== r.session_id
      )
        deny("DEPLOYMENT_SESSION_DENIED", 403);
      return this.#tx(r.organization_id, async (c) => {
        if ((p.validatedUntil ?? Infinity) <= this.#now())
          deny("DEPLOYMENT_AUTHORITY_EXPIRED", 503);
        const value = await fn(c, p);
        if ((p.validatedUntil ?? Infinity) <= this.#now())
          deny("DEPLOYMENT_AUTHORITY_EXPIRED", 503);
        return value;
      });
    });
  }
  #current(r: Binding) {
    const now = this.#now();
    if (
      r.environment_type !== "minecraft" ||
      r.reservation_state !== "allocated" ||
      r.node_state !== "active" ||
      r.node_version !== r.current_node_version ||
      r.credential_version !== r.current_credential_version ||
      r.credential_expires_at.getTime() <= now ||
      r.policy_hash !== this.#policy.hash ||
      !r.last_seen_at ||
      r.last_seen_at.getTime() < now - 30000 ||
      r.last_seen_at.getTime() > now
    )
      deny("DEPLOYMENT_BINDING_STALE");
  }
  #active(r: Job) {
    this.#current(r);
    const v = r.command.payload;
    if (
      r.state !== "issued" ||
      r.lease_expires_at.getTime() <= this.#now() ||
      Date.parse(v.issued_at) > this.#now() ||
      v.control_id !== nodeDigest(this.#public) ||
      v.policy_revision !== this.#policy.revision ||
      v.policy_hash !== this.#policy.hash ||
      v.stop_generation !== this.#policy.stop_generation ||
      !verifyNodeValue(v, r.command.signature, this.#public) ||
      nodeDigest(v) !== r.command_hash
    )
      deny("DEPLOYMENT_LEASE_DENIED");
  }
  async #stop(c: pg.PoolClient, r: Binding) {
    await c.query("select set_config('app.runtime_internal','enabled',true)");
    try {
      const rows = (
        await c.query<{
          kind: string;
          scope_id: string;
          epoch: number;
          latched: boolean;
        }>(
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
  #context(
    phase: DeploymentQualificationContext["phase"],
    r: Binding,
    p: DeploymentPrincipal,
    jobId: string,
    stop: string,
    grants: readonly ExecutionGrant[],
    input: unknown,
  ): DeploymentQualificationContext {
    const value = {
      phase,
      organization_id: r.organization_id,
      project_id: r.project_id,
      environment_id: r.environment_id,
      node_id: r.node_id,
      job_id: jobId,
      actor_id: p.user.id,
      session_id: p.sessionId,
      reservation_id: r.reservation_id,
      deployment_id: r.deployment_id,
      world_id: r.world_id,
      plan_hash: r.plan_hash,
      template_hash: r.template_hash,
      policy_hash: r.policy_hash,
      node_version: r.current_node_version,
      credential_version: r.credential_version,
    };
    return {
      ...value,
      request_hash: nodeDigest({
        ...value,
        stop_hash: stop,
        grants_hash: nodeDigest(grants),
        user_version: p.userVersion,
        input,
      }),
    };
  }
  async #inspect(
    context: DeploymentQualificationContext,
    signal?: AbortSignal,
  ) {
    if (!this.options.qualifier) deny("DEPLOYMENT_UNQUALIFIED", 503);
    const abort = new AbortController(),
      combined = signal
        ? AbortSignal.any([abort.signal, signal])
        : abort.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return deploymentQualification.parse(
        await Promise.race([
          this.options.qualifier.inspect(context, combined),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(
                new AuthError(
                  503,
                  "DEPLOYMENT_QUALIFICATION_TIMEOUT",
                  "Deployment qualification unavailable.",
                ),
              );
            }, 5000);
          }),
        ]),
      );
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
  }
  #qualified(
    e: z.infer<typeof deploymentQualification>,
    context: DeploymentQualificationContext,
    approval?: string,
  ) {
    const now = this.#now();
    if (
      e.request_hash !== context.request_hash ||
      e.policy_hash !== context.policy_hash ||
      e.template_hash !== context.template_hash ||
      Date.parse(e.issued_at) > now ||
      Date.parse(e.expires_at) <= now ||
      Date.parse(e.expires_at) - Date.parse(e.issued_at) > 10000 ||
      (approval && e.approval_hash !== approval)
    )
      deny("DEPLOYMENT_QUALIFICATION_STALE");
  }
  #view(r: Job) {
    return deploymentJobView.parse({
      operation_id: r.id,
      intent_id: r.intent_id,
      deployment_id: r.deployment_id,
      server_id: r.server_id,
      world_id: r.world_id,
      node_id: r.node_id,
      project_id: r.project_id,
      environment_id: r.environment_id,
      state: r.state,
      command_hash: r.command_hash,
      lease_expires_at: r.lease_expires_at.toISOString(),
      created_at: r.created_at.toISOString(),
      receipt_state: r.receipt?.payload.state ?? null,
    });
  }
  async #event(
    c: pg.PoolClient,
    r: Job,
    kind: "issued" | "receipt" | "expired",
  ) {
    const id = randomUUID(),
      now = new Date(this.#now());
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        r.organization_id,
        r.actor_id,
        `server.deployment_${kind}`,
        r.deployment_id,
        { operation_id: r.id, state: r.state, source: "deployment_controller" },
      ],
    );
    await c.query(
      "insert into minecraft_deployment_job_outbox(id,organization_id,job_id,kind,created_at) values($1,$2,$3,$4,$5)",
      [id, r.organization_id, r.id, kind, now],
    );
  }
  async prepare(token: string, org: string, input: unknown, key: string) {
    const v = deploymentJobRequest.parse(input);
    z.uuid().parse(key);
    const located = await this.#locate(token, org, v.intent_id, "intent"),
      grants = [
        await this.#auth().issueExecutionGrant(token, org, "node:deploy", {
          kind: "project",
          id: located.project_id,
        }),
        await this.#auth().issueExecutionGrant(token, org, "server:provision", {
          kind: "environment",
          id: located.environment_id,
        }),
      ];
    return this.#issue(located, grants, v, key);
  }
  async issueAdmission(org: string, authorizationId: string) {
    const admitted = await this.#tx(org, async (c) => {
      const a = (
        await c.query<{
          intent_id: string;
          node_grant: ExecutionGrant;
          server_grant: ExecutionGrant;
          stop_hash: string;
          expires_at: Date;
        }>(
          "select intent_id,node_grant,server_grant,stop_hash,expires_at from minecraft_deployment_authorizations where organization_id=$1 and id=$2",
          [org, z.uuid().parse(authorizationId)],
        )
      ).rows[0];
      if (!a) deny("NOT_FOUND", 404);
      if (a.expires_at.getTime() <= this.#now())
        deny("DEPLOYMENT_AUTHORIZATION_STALE");
      return { ...a, r: await this.#intent(c, org, a.intent_id) };
    });
    return this.#issue(
      admitted.r,
      [
        executionGrantSchema.parse(admitted.node_grant),
        executionGrantSchema.parse(admitted.server_grant),
      ],
      { intent_id: admitted.intent_id },
      authorizationId,
      {
        id: authorizationId,
        stop: admitted.stop_hash,
        expires: admitted.expires_at.getTime(),
      },
    );
  }
  async #placement(
    c: pg.PoolClient,
    scope: DeploymentDispatchScope,
    current: boolean,
  ) {
    const r = (
      await c.query<{
        state: string;
        credential_version: number;
        expires_at: Date;
      }>(
        "select n.state,n.credential_version,k.expires_at from minecraft_nodes n join minecraft_node_credentials k on (k.organization_id,k.node_id)=(n.organization_id,n.id) where n.organization_id=$1 and n.project_id=$2 and n.id=$3 and k.version=$4",
        [
          scope.organization_id,
          scope.project_id,
          scope.node_id,
          scope.credential_version,
        ],
      )
    ).rows[0];
    if (
      !r ||
      (current &&
        (r.state !== "active" ||
          r.credential_version !== scope.credential_version ||
          r.expires_at.getTime() <= this.#now()))
    )
      deny("DEPLOYMENT_DISPATCH_SCOPE_DENIED", 403);
  }
  /** Private metadata issuer only. Each reference still passes sealed current authority/qualification. */
  async dispatchPending(
    scopeInput: unknown,
    page: { after?: string | null; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    const scope = deploymentDispatchScope.parse(scopeInput),
      after = z
        .uuid()
        .nullable()
        .parse(page.after ?? null),
      limit = z
        .number()
        .int()
        .min(1)
        .max(8)
        .parse(page.limit ?? 8);
    signal?.throwIfAborted();
    const rows = await this.#tx(scope.organization_id, async (c) => {
      await this.#placement(c, scope, true);
      return (
        await c.query<{ id: string }>(
          "select a.id from minecraft_deployment_authorization_outbox o join minecraft_deployment_authorizations a on (a.organization_id,a.id)=(o.organization_id,o.authorization_id) join minecraft_reservations r on (r.organization_id,r.id)=(a.organization_id,a.reservation_id) left join minecraft_deployment_jobs j on (j.organization_id,j.intent_id)=(a.organization_id,a.intent_id) where a.organization_id=$1 and a.project_id=$2 and a.node_id=$3 and r.credential_version=$4 and o.schema_version=1 and a.expires_at>$5 and a.created_at<=$5 and j.id is null and ($6::uuid is null or a.id>$6) order by a.id limit $7",
          [
            scope.organization_id,
            scope.project_id,
            scope.node_id,
            scope.credential_version,
            new Date(this.#now()),
            after,
            limit,
          ],
        )
      ).rows;
    });
    let issued = 0,
      blocked = 0;
    for (const row of rows) {
      signal?.throwIfAborted();
      try {
        await this.issueAdmission(scope.organization_id, row.id);
        issued++;
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
        blocked++;
      }
    }
    return {
      issued,
      blocked,
      after: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    };
  }
  /** Denial-only lease settlement; neither actor revocation nor a stop should preserve an expired issued state. */
  async settleExpiredForNode(scopeInput: unknown) {
    const scope = deploymentDispatchScope.parse(scopeInput);
    return this.#tx(scope.organization_id, async (c) => {
      await this.#placement(c, scope, false);
      const rows = (
        await c.query<{ id: string }>(
          "select id from minecraft_deployment_jobs where organization_id=$1 and project_id=$2 and node_id=$3 and credential_version=$4 and state='issued' and lease_expires_at<=$5 order by lease_expires_at,id limit 8",
          [
            scope.organization_id,
            scope.project_id,
            scope.node_id,
            scope.credential_version,
            new Date(this.#now()),
          ],
        )
      ).rows;
      for (const row of rows) {
        const r = await this.#job(c, scope.organization_id, row.id);
        if (
          r.command.payload.control_id !== nodeDigest(this.#public) ||
          !verifyNodeValue(r.command.payload, r.command.signature, this.#public)
        )
          deny("DEPLOYMENT_DISPATCH_CONTROL_DENIED", 403);
        await this.#expire(c, r);
      }
      return rows.length;
    });
  }
  async #issue(
    located: Binding,
    grants: ExecutionGrant[],
    v: z.infer<typeof deploymentJobRequest>,
    key: string,
    admission?: { id: string; stop: string; expires: number },
  ) {
    const org = located.organization_id,
      id = randomUUID(),
      requestHash = nodeDigest(v);
    const snapshot = await this.#guard(located, grants, async (c, p) => {
      const r = await this.#intent(c, org, v.intent_id);
      this.#current(r);
      const stop = await this.#stop(c, r);
      if (
        admission &&
        (admission.expires <= this.#now() || admission.stop !== stop)
      )
        deny("DEPLOYMENT_AUTHORIZATION_STALE");
      const oldId = (
        await c.query<{ id: string }>(
          "select id from minecraft_deployment_jobs where organization_id=$1 and (intent_id=$2 or (actor_id=$3 and request_key=$4))",
          [org, v.intent_id, p.user.id, key],
        )
      ).rows[0];
      if (oldId) {
        const old = await this.#job(c, org, oldId.id);
        if (
          old.intent_id !== v.intent_id ||
          old.request_key !== key ||
          old.request_hash !== requestHash
        )
          deny("IDEMPOTENCY_CONFLICT");
        this.#active(old);
        if (old.stop_hash !== stop) deny("DEPLOYMENT_STOP_CHANGED");
        return {
          r,
          stop,
          context: this.#context("issue", r, p, id, stop, grants, v),
          old: this.#view(old),
        };
      }
      return {
        r,
        stop,
        context: this.#context("issue", r, p, id, stop, grants, v),
        old: null,
      };
    });
    if (snapshot.old) return snapshot.old;
    const evidence = await this.#inspect(snapshot.context);
    return this.#guard(located, grants, async (c, p) => {
      const r = await this.#intent(c, org, v.intent_id);
      this.#current(r);
      const stop = await this.#stop(c, r),
        context = this.#context("issue", r, p, id, stop, grants, v);
      this.#qualified(evidence, context);
      if (
        admission &&
        (admission.expires <= this.#now() || admission.stop !== stop)
      )
        deny("DEPLOYMENT_AUTHORIZATION_STALE");
      const oldId = (
        await c.query<{ id: string }>(
          "select id from minecraft_deployment_jobs where organization_id=$1 and (intent_id=$2 or (actor_id=$3 and request_key=$4))",
          [org, v.intent_id, p.user.id, key],
        )
      ).rows[0];
      if (oldId) {
        const old = await this.#job(c, org, oldId.id);
        if (
          old.intent_id !== v.intent_id ||
          old.request_key !== key ||
          old.request_hash !== requestHash
        )
          deny("IDEMPOTENCY_CONFLICT");
        this.#active(old);
        if (old.stop_hash !== stop) deny("DEPLOYMENT_STOP_CHANGED");
        return this.#view(old);
      }
      const now = this.#now(),
        expires = Math.min(
          now + 30000,
          admission?.expires ?? Infinity,
          p.authorityExpiresAt ?? Number.POSITIVE_INFINITY,
          r.credential_expires_at.getTime(),
        );
      if (expires <= now) deny("DEPLOYMENT_LEASE_DENIED");
      const payload: NodeCommand = {
          schema_version: 1,
          purpose: "node.command.v1",
          control_id: nodeDigest(this.#public),
          organization_id: org,
          project_id: r.project_id,
          node_id: r.node_id,
          credential_version: r.credential_version,
          command_id: randomUUID(),
          operation_id: id,
          deployment_id: r.deployment_id,
          server_id: r.server_id,
          world_id: r.world_id,
          reservation_id: r.reservation_id,
          action: "provision",
          attempt: 1,
          fence: 1,
          stop_generation: this.#policy.stop_generation,
          policy_revision: this.#policy.revision,
          policy_hash: r.policy_hash,
          plan_hash: r.plan_hash,
          template_hash: r.template_hash,
          authorization_hash: nodeDigest({
            grants,
            actor: r.actor_id,
            session: r.session_id,
            stop_hash: stop,
          }),
          approval_hash: evidence.approval_hash,
          issued_at: new Date(now).toISOString(),
          expires_at: new Date(expires).toISOString(),
        },
        command = signedNodeCommand.parse({
          payload,
          signature: signNodeValue(payload, this.options.controlPrivateKey),
        });
      await c.query(
        "insert into minecraft_deployment_jobs(id,organization_id,project_id,environment_id,node_id,credential_version,reservation_id,intent_id,actor_id,session_id,request_key,request_hash,node_grant,server_grant,command,command_hash,stop_hash,lease_id,attempt,fence,state,created_at,lease_expires_at,authorization_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,1,'issued',$19,$20,$21)",
        [
          id,
          org,
          r.project_id,
          r.environment_id,
          r.node_id,
          r.credential_version,
          r.reservation_id,
          v.intent_id,
          r.actor_id,
          r.session_id,
          key,
          requestHash,
          grants[0],
          grants[1],
          command,
          nodeDigest(payload),
          stop,
          randomUUID(),
          new Date(now),
          new Date(expires),
          admission?.id ?? null,
        ],
      );
      const job = await this.#job(c, org, id);
      await this.#event(c, job, "issued");
      this.#active(job);
      if ((await this.#stop(c, job)) !== job.stop_hash)
        deny("DEPLOYMENT_STOP_CHANGED");
      this.#qualified(evidence, context);
      return this.#view(job);
    });
  }
  #peer(r: Job, peer: NodePeer) {
    if (
      r.node_state !== "active" ||
      r.current_credential_version !== r.credential_version ||
      r.credential_expires_at.getTime() <= this.#now() ||
      peer.certificate_sha256 !== r.certificate_sha256 ||
      !Number.isFinite(peer.certificate_expires_at) ||
      peer.certificate_expires_at <= this.#now()
    )
      deny("NODE_CREDENTIAL_DENIED", 401);
  }
  #request(
    r: Job,
    signed: z.infer<typeof signedNodeJobRequest>,
    peer: NodePeer,
  ) {
    const v = signed.payload;
    this.#peer(r, peer);
    try {
      assertNodeTime(v.issued_at, v.expires_at, this.#now());
    } catch {
      deny("NODE_PROOF_EXPIRED", 401);
    }
    if (
      Date.parse(v.issued_at) > this.#now() ||
      v.control_id !== nodeDigest(this.#public) ||
      v.organization_id !== r.organization_id ||
      v.project_id !== r.project_id ||
      v.node_id !== r.node_id ||
      v.credential_version !== r.credential_version ||
      v.command_hash !== r.command_hash ||
      !verifyNodeValue(v, signed.signature, r.public_key)
    )
      deny("NODE_COMMAND_REQUEST_DENIED", 401);
  }
  async #nonce(
    c: pg.PoolClient,
    r: Job,
    v: z.infer<typeof signedNodeJobRequest>["payload"],
    write: boolean,
  ) {
    const count = (
      await c.query<{ count: number; duplicate: boolean }>(
        "select count(*)::int count,coalesce(bool_or(request_id=$3 or ($4::uuid is not null and permit_nonce=$4)),false) duplicate from minecraft_deployment_job_requests where organization_id=$1 and job_id=$2",
        [r.organization_id, r.id, v.request_id, v.permit_nonce],
      )
    ).rows[0];
    if (!count || count.duplicate) deny("NODE_COMMAND_REQUEST_REPLAY", 401);
    if (count.count >= 64) deny("NODE_COMMAND_REQUEST_LIMIT", 429);
    if (write)
      await c.query(
        "insert into minecraft_deployment_job_requests(id,organization_id,node_id,credential_version,job_id,request_id,permit_nonce,kind,request_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          r.organization_id,
          r.node_id,
          r.credential_version,
          r.id,
          v.request_id,
          v.permit_nonce,
          v.purpose === "node.command.fetch.v1" ? "fetch" : "permit",
          nodeDigest(v),
          new Date(this.#now()),
        ],
      );
  }
  async exchange(input: unknown, peer: NodePeer, signal?: AbortSignal) {
    const signed = signedNodeJobRequest.parse(input),
      v = signed.payload;
    if (signal?.aborted) deny("NODE_COMMAND_REQUEST_ABORTED");
    const located = await this.#tx(v.organization_id, async (c) => {
        const r = await this.#job(c, v.organization_id, v.job_id);
        this.#request(r, signed, peer);
        return r;
      }),
      grants = [located.node_grant, located.server_grant],
      phase = v.purpose === "node.command.fetch.v1" ? "fetch" : "permit";
    const prepared = await this.#guard(located, grants, async (c, p) => {
      const r = await this.#job(c, v.organization_id, v.job_id);
      this.#request(r, signed, peer);
      this.#active(r);
      const stop = await this.#stop(c, r);
      if (stop !== r.stop_hash) deny("DEPLOYMENT_STOP_CHANGED");
      await this.#nonce(c, r, v, false);
      return this.#context(phase, r, p, r.id, stop, grants, v);
    });
    const evidence = await this.#inspect(prepared, signal);
    return this.#guard(located, grants, async (c, p) => {
      if (signal?.aborted) deny("NODE_COMMAND_REQUEST_ABORTED");
      const r = await this.#job(c, v.organization_id, v.job_id);
      this.#request(r, signed, peer);
      this.#active(r);
      const stop = await this.#stop(c, r);
      if (stop !== r.stop_hash) deny("DEPLOYMENT_STOP_CHANGED");
      this.#qualified(
        evidence,
        this.#context(phase, r, p, r.id, stop, grants, v),
        r.command.payload.approval_hash,
      );
      await this.#nonce(c, r, v, true);
      if ((await this.#stop(c, r)) !== stop) deny("DEPLOYMENT_STOP_CHANGED");
      this.#request(r, signed, peer);
      this.#active(r);
      this.#qualified(
        evidence,
        this.#context(phase, r, p, r.id, stop, grants, v),
        r.command.payload.approval_hash,
      );
      if (phase === "fetch") return r.command;
      const now = this.#now(),
        command = r.command.payload,
        payload = {
          schema_version: 1 as const,
          purpose: "node.command.permit.v1" as const,
          control_id: command.control_id,
          organization_id: r.organization_id,
          project_id: r.project_id,
          node_id: r.node_id,
          credential_version: r.credential_version,
          command_hash: r.command_hash,
          request_nonce: v.permit_nonce,
          lease_id: r.lease_id,
          fence: command.fence,
          stop_generation: command.stop_generation,
          policy_revision: command.policy_revision,
          policy_hash: command.policy_hash,
          authorization_hash: command.authorization_hash,
          issued_at: new Date(now).toISOString(),
          expires_at: new Date(
            Math.min(
              now + 5000,
              r.lease_expires_at.getTime(),
              p.authorityExpiresAt ?? Number.POSITIVE_INFINITY,
              p.validatedUntil ?? Number.POSITIVE_INFINITY,
              r.credential_expires_at.getTime(),
            ),
          ).toISOString(),
          allowed: true,
        };
      return signedNodeCommandPermit.parse({
        payload,
        signature: signNodeValue(payload, this.options.controlPrivateKey),
      });
    });
  }
  async get(token: string, org: string, id: string) {
    const located = await this.#locate(token, org, id, "job");
    return this.#human(token, org, located, async (c) =>
      this.#view(await this.#job(c, org, id)),
    );
  }
  async #uncertain(c: pg.PoolClient, r: Job) {
    const changed = await c.query(
      "update minecraft_reservations set state='uncertain',version=version+1 where organization_id=$1 and id=$2 and state='allocated' returning id",
      [r.organization_id, r.reservation_id],
    );
    if (!changed.rowCount) return;
    const id = randomUUID(),
      now = new Date(this.#now());
    await c.query(
      "insert into minecraft_reservation_operations(id,organization_id,project_id,environment_id,node_id,reservation_id,actor_id,session_id,kind,request_key,request_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,'uncertain',$9,$10,$11)",
      [
        id,
        r.organization_id,
        r.project_id,
        r.environment_id,
        r.node_id,
        r.reservation_id,
        r.actor_id,
        r.session_id,
        r.id,
        nodeDigest({ job_id: r.id, state: "uncertain" }),
        now,
      ],
    );
    await c.query(
      "insert into minecraft_reservation_outbox(id,organization_id,operation_id,created_at) values($1,$2,$3,$4)",
      [randomUUID(), r.organization_id, id, now],
    );
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,'node.reservation_uncertain',$3,'allowed',$4)",
      [
        r.organization_id,
        r.actor_id,
        r.reservation_id,
        { operation_id: id, source: "deployment_controller" },
      ],
    );
  }
  async settleExpired(token: string, org: string, id: string) {
    const located = await this.#locate(token, org, id, "job");
    return this.#human(token, org, located, async (c) => {
      const r = await this.#job(c, org, id);
      if (r.state !== "issued") return this.#view(r);
      if (r.lease_expires_at.getTime() > this.#now())
        deny("DEPLOYMENT_LEASE_ACTIVE");
      return this.#expire(c, r);
    });
  }
  async #expire(c: pg.PoolClient, r: Job) {
    await c.query(
      "update minecraft_deployment_jobs set state='uncertain',version=version+1 where organization_id=$1 and id=$2",
      [r.organization_id, r.id],
    );
    await this.#uncertain(c, r);
    const expired = await this.#job(c, r.organization_id, r.id);
    await this.#event(c, expired, "expired");
    return this.#view(expired);
  }
  async recordReceipt(input: unknown, peer: NodePeer) {
    const signed = signedNodeCommandReceipt.parse(input),
      v = signed.payload;
    return this.#tx(v.organization_id, async (c) => {
      let r = await this.#job(c, v.organization_id, v.operation_id);
      this.#peer(r, peer);
      const command = r.command.payload;
      if (
        !verifyNodeValue(v, signed.signature, r.public_key) ||
        v.command_hash !== r.command_hash ||
        Date.parse(v.finished_at) < Date.parse(command.issued_at) ||
        Date.parse(v.finished_at) > this.#now() + 5000
      )
        deny("NODE_RECEIPT_DENIED", 401);
      for (const key of [
        "control_id",
        "organization_id",
        "project_id",
        "node_id",
        "credential_version",
        "command_id",
        "operation_id",
        "deployment_id",
        "server_id",
        "world_id",
        "action",
        "fence",
      ] as const)
        if (v[key] !== command[key]) deny("NODE_RECEIPT_DENIED", 401);
      if (r.receipt) {
        if (nodeDigest(r.receipt) !== nodeDigest(signed))
          deny("NODE_RECEIPT_CONFLICT");
        return this.#view(r);
      }
      if (!["issued", "uncertain"].includes(r.state))
        deny("NODE_RECEIPT_CONFLICT");
      const state =
        r.state === "uncertain" ||
        r.lease_expires_at.getTime() <= this.#now() ||
        Date.parse(v.finished_at) >= r.lease_expires_at.getTime()
          ? "uncertain"
          : v.state;
      await c.query(
        "update minecraft_deployment_jobs set state=$3,receipt=$4,version=version+1 where organization_id=$1 and id=$2",
        [r.organization_id, r.id, state, signed],
      );
      if (state === "uncertain") await this.#uncertain(c, r);
      r = await this.#job(c, r.organization_id, r.id);
      await this.#event(c, r, "receipt");
      return this.#view(r);
    });
  }
}
