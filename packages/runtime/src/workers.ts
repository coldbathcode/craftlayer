import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { ExecutionGrant } from "@craftlayer/auth";
import {
  type AttemptHandle,
  actionPermit,
  attemptHandle,
  dispatchReference,
  finishRequest,
  finishView,
  leaseView,
  type prepareView,
  type RuntimeReason,
  runtimeBlocked,
  taskDefinition,
  workerClaim,
  workerCreate,
  workerEnrollment,
  workerView,
} from "@craftlayer/contracts";
import type pg from "pg";
import { z } from "zod";
import { deny, digest, type MissionRow, type TaskRow } from "./repository.js";
import { RuntimeScheduler } from "./scheduler.js";

interface WorkerRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  name: string;
  protocol: 1;
  version: number;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}
export interface AttemptRow {
  id: string;
  organization_id: string;
  mission_id: string;
  task_id: string;
  agent_id: string;
  worker_id: string;
  generation: number;
  fence: number;
  state: string;
  lease_expires_at: Date;
  deadline_at: Date;
  started_at: Date;
  tool_calls: number;
}
export interface WorkerContext {
  worker: WorkerRow;
  mission: MissionRow;
  task: TaskRow;
  attempt: AttemptRow;
}
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class RuntimeWorkers extends RuntimeScheduler {
  protected authorizationWindow = new AsyncLocalStorage<{
    expires: number;
    approvalId?: string;
    approvalSignature?: string;
  }>();
  protected async serviceAudit(
    c: pg.PoolClient,
    org: string,
    worker: string,
    task: string,
    attempt: string,
    action: string,
  ) {
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,null,$2,$3,'allowed',$4)",
      [org, action, attempt, { worker_id: worker, task_id: task }],
    );
  }
  private workerDto(w: WorkerRow) {
    return workerView.parse({
      id: w.id,
      environment_id: w.environment_id,
      name: w.name,
      protocol: w.protocol,
      version: w.version,
      active: !w.revoked_at && w.expires_at.getTime() > this.now(),
      expires_at: w.expires_at.toISOString(),
    });
  }
  async enrollWorker(token: string, org: string, input: unknown) {
    const v = workerCreate.parse(input);
    return this.scoped(
      token,
      org,
      v.environment_id,
      "agent:assign",
      async (c, p, e) => {
        if (
          ((
            await c.query<{ n: number }>(
              "select count(*)::int as n from runtime_workers where organization_id=$1 and revoked_at is null and expires_at>$2",
              [org, new Date(this.now())],
            )
          ).rows[0]?.n ?? 0) >= 16
        )
          deny("WORKER_CAPACITY", 429);
        const id = randomUUID(),
          secret = `v1.${org}.${id}.${randomBytes(32).toString("base64url")}`,
          expires = new Date(this.now() + 86400000);
        await this.storage(c, org, p.user.id, e.project_id, id, 8192);
        const row = (
          await c.query<WorkerRow>(
            "insert into runtime_workers(id,organization_id,project_id,environment_id,name,protocol,token_hash,expires_at) values($1,$2,$3,$4,$5,1,$6,$7) returning *",
            [id, org, e.project_id, e.id, v.name, tokenHash(secret), expires],
          )
        ).rows[0];
        if (!row) deny();
        await this.audit(c, org, p.user.id, "runtime.worker_enrolled", id);
        return workerEnrollment.parse({
          registration: this.workerDto(row),
          credential: {
            worker_id: id,
            organization_id: org,
            environment_id: e.id,
            protocol: 1,
            token: secret,
          },
        });
      },
    );
  }
  async listWorkers(token: string, org: string, environment: string) {
    return this.scoped(token, org, environment, "agent:read", async (c) =>
      (
        await c.query<WorkerRow>(
          "select * from runtime_workers where organization_id=$1 and environment_id=$2 order by id limit 100",
          [org, environment],
        )
      ).rows.map((w) => this.workerDto(w)),
    );
  }
  async revokeWorker(token: string, org: string, id: string, version: number) {
    const located = await this.member(token, org, () =>
      this.tx(
        org,
        async (c) =>
          (
            await c.query<WorkerRow>(
              "select * from runtime_workers where organization_id=$1 and id=$2",
              [org, z.uuid().parse(id)],
            )
          ).rows[0],
      ),
    );
    if (!located) deny("NOT_FOUND", 404);
    return this.scoped(
      token,
      org,
      located.environment_id,
      "agent:assign",
      async (c, p) => {
        const w = (
          await c.query<WorkerRow>(
            "select * from runtime_workers where organization_id=$1 and id=$2 for update",
            [org, id],
          )
        ).rows[0];
        if (!w) deny("NOT_FOUND", 404);
        this.version(w, version);
        const row = (
          await c.query<WorkerRow>(
            "update runtime_workers set revoked_at=$3,version=version+1 where organization_id=$1 and id=$2 returning *",
            [org, id, new Date(this.now())],
          )
        ).rows[0];
        if (!row) deny();
        await this.audit(c, org, p.user.id, "runtime.worker_revoked", id);
        return this.workerDto(row);
      },
    );
  }
  protected workerParts(token: string, protocol: number) {
    if (protocol !== 1) deny("WORKER_PROTOCOL", 403);
    const m = /^v1\.([a-f0-9-]{36})\.([a-f0-9-]{36})\.[A-Za-z0-9_-]{43}$/.exec(
      token,
    );
    if (!m?.[1] || !m[2]) deny("WORKER_DENIED", 401);
    const org = z.uuid().safeParse(m[1]),
      id = z.uuid().safeParse(m[2]);
    if (!org.success || !id.success) deny("WORKER_DENIED", 401);
    return { org: org.data, id: id.data };
  }
  protected async worker(
    c: pg.PoolClient,
    token: string,
    protocol: number,
  ): Promise<WorkerRow> {
    const parts = this.workerParts(token, protocol),
      row = (
        await c.query<WorkerRow>(
          "select * from runtime_workers where organization_id=$1 and id=$2 for share",
          [parts.org, parts.id],
        )
      ).rows[0];
    if (
      !row ||
      row.revoked_at ||
      row.expires_at.getTime() <= this.now() ||
      row.protocol !== protocol ||
      !timingSafeEqual(
        Buffer.from(row.token_hash, "hex"),
        Buffer.from(tokenHash(token), "hex"),
      )
    )
      deny("WORKER_DENIED", 401);
    await c.query(
      "update runtime_workers set last_seen_at=$3 where organization_id=$1 and id=$2",
      [parts.org, parts.id, new Date(this.now())],
    );
    return row;
  }
  protected async candidate(token: string, protocol: number, task: string) {
    const parts = this.workerParts(token, protocol);
    return this.tx(parts.org, async (c) => {
      const worker = await this.worker(c, token, protocol),
        row = (
          await c.query<TaskRow>(
            "select t.* from runtime_tasks t join runtime_missions m on m.organization_id=t.organization_id and m.id=t.mission_id where t.organization_id=$1 and t.id=$2 and m.environment_id=$3",
            [parts.org, task, worker.environment_id],
          )
        ).rows[0];
      if (!row) deny("NOT_FOUND", 404);
      return {
        worker,
        task: row,
        mission: await this.mission(c, parts.org, row.mission_id),
      };
    });
  }
  protected grant(row: MissionRow): ExecutionGrant {
    const g = row.execution_grant;
    if (
      !g ||
      g.organizationId !== row.organization_id ||
      g.permission !== "mission:execute" ||
      g.resource.kind !== "environment" ||
      g.resource.id !== row.environment_id ||
      row.execution_digest !==
        digest({
          mission: row.id,
          hash: row.template_hash,
          generation: row.generation,
          grant: g,
        })
    )
      deny("GRANT_DENIED", 403);
    return g;
  }
  async claim(token: string, protocol: number, input: unknown) {
    const ref = dispatchReference.parse(input),
      parts = this.workerParts(token, protocol);
    if (parts.org !== ref.organization_id) deny("WORKER_SCOPE", 403);
    const located = await this.candidate(token, protocol, ref.task_id),
      grant = this.grant(located.mission);
    return this.auth.guardExecution(grant, (p) =>
      this.tx(parts.org, async (c) => {
        const w = await this.worker(c, token, protocol),
          m = await this.mission(c, parts.org, located.mission.id),
          t = (
            await c.query<TaskRow>(
              "select * from runtime_tasks where organization_id=$1 and id=$2 for update",
              [parts.org, ref.task_id],
            )
          ).rows[0];
        if (
          !t ||
          m.environment_id !== w.environment_id ||
          p.user.account_type !== "adult"
        )
          deny("WORKER_SCOPE", 403);
        if (
          !["queued", "running"].includes(m.state) ||
          t.next_attempt_at.getTime() > this.now() ||
          t.state !== "ready" ||
          m.generation !== ref.execution_generation
        )
          return { claim: null };
        if (
          digest(this.grant(m)) !== digest(grant) ||
          (await this.control(c, m)) ||
          !m.deadline ||
          m.deadline.getTime() <= this.now()
        )
          deny("WORKER_STOPPED");
        if (
          !(
            await c.query(
              "select id from runtime_outbox where organization_id=$1 and id=$2 and task_id=$3 and generation=$4",
              [parts.org, ref.event_id, t.id, m.generation],
            )
          ).rowCount
        )
          deny("QUEUE_REFERENCE_DENIED", 403);
        const def = taskDefinition.parse(t.definition),
          graph = this.snapshot(m);
        if (
          !graph.nodes.some(
            (n) => n.key === t.node_key && digest(n) === digest(def),
          )
        )
          deny("SNAPSHOT_INVALID", 403);
        if (t.attempt_count >= def.max_attempts) deny("ATTEMPTS_EXHAUSTED");
        const active = (
          await c.query<{ kind: string }>(
            "select t.definition->'action'->>'kind' as kind from runtime_attempts a join runtime_tasks t on t.organization_id=a.organization_id and t.id=a.task_id where a.organization_id=$1 and a.mission_id=$2 and a.state in ('leased','running','uncertain','cancel_requested')",
            [parts.org, m.id],
          )
        ).rows;
        if (
          active.some((a) => a.kind === "fixture.approval") ||
          (def.action.kind === "fixture.approval" && active.length)
        )
          return { claim: null };
        const agent = (
          await c.query<{ id: string }>(
            "select a.id from runtime_agents a join runtime_group_agents g on g.organization_id=a.organization_id and g.agent_id=a.id where a.organization_id=$1 and g.group_id=$2 and a.environment_id=$3 and a.state in ('idle','assigned') and not exists(select 1 from runtime_attempts x where x.organization_id=a.organization_id and x.agent_id=a.id and x.state in ('leased','running','uncertain','cancel_requested')) order by a.id limit 1 for update of a skip locked",
            [parts.org, m.group_id, w.environment_id],
          )
        ).rows[0];
        if (!agent) return { claim: null };
        const id = randomUUID(),
          fence = t.fence + 1,
          deadline = new Date(
            Math.min(
              this.now() + def.timeout_ms,
              m.deadline.getTime(),
              p.authorityExpiresAt ?? grant.expiresAt,
              grant.expiresAt,
            ),
          ),
          lease = new Date(this.now() + 15000);
        await c.query(
          "update runtime_tasks set state='leased',fence=$3,attempt_count=attempt_count+1,reason='none' where organization_id=$1 and id=$2",
          [parts.org, t.id, fence],
        );
        await c.query(
          "insert into runtime_attempts(id,organization_id,project_id,environment_id,mission_id,task_id,agent_id,worker_id,generation,fence,state,lease_expires_at,deadline_at,started_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'leased',$11,$12,$13)",
          [
            id,
            parts.org,
            m.project_id,
            m.environment_id,
            m.id,
            t.id,
            agent.id,
            w.id,
            m.generation,
            fence,
            lease,
            deadline,
            new Date(this.now()),
          ],
        );
        await this.reserveAttempt(c, m, id, def.timeout_ms);
        await c.query(
          "update runtime_attempts set state='running' where organization_id=$1 and id=$2",
          [parts.org, id],
        );
        await c.query(
          "update runtime_tasks set state='running' where organization_id=$1 and id=$2",
          [parts.org, t.id],
        );
        await c.query(
          "update runtime_agents set state='busy',version=version+1 where organization_id=$1 and id=$2",
          [parts.org, agent.id],
        );
        if (m.state === "queued")
          await c.query(
            "update runtime_missions set state='running',version=version+1 where organization_id=$1 and id=$2",
            [parts.org, m.id],
          );
        await this.serviceAudit(
          c,
          parts.org,
          w.id,
          t.id,
          id,
          "runtime.task_claimed",
        );
        await this.event(c, m, "task.running", {
          task_id: t.id,
          attempt_id: id,
          fence,
        });
        const action =
          def.action.kind === "fixture.model"
            ? { kind: "fixture.model" as const }
            : def.action;
        return {
          claim: workerClaim.parse({
            attempt_id: id,
            task_id: t.id,
            generation: m.generation,
            fence,
            attempt_number: t.attempt_count + 1,
            lease_ms: 15000,
            deadline_ms: deadline.getTime() - this.now(),
            action,
          }),
        };
      }),
    );
  }
  protected async attemptContext(
    c: pg.PoolClient,
    token: string,
    protocol: number,
    h: AttemptHandle,
    allowExpired = false,
  ): Promise<WorkerContext> {
    const w = await this.worker(c, token, protocol),
      a = (
        await c.query<AttemptRow>(
          "select * from runtime_attempts where organization_id=$1 and id=$2 and worker_id=$3 for update",
          [w.organization_id, h.attempt_id, w.id],
        )
      ).rows[0];
    if (
      !a ||
      a.task_id !== h.task_id ||
      a.fence !== h.fence ||
      a.generation !== h.generation
    )
      deny("STALE_ATTEMPT");
    const m = await this.mission(c, w.organization_id, a.mission_id),
      t = (
        await c.query<TaskRow>(
          "select * from runtime_tasks where organization_id=$1 and id=$2 for update",
          [w.organization_id, a.task_id],
        )
      ).rows[0];
    if (!t || m.environment_id !== w.environment_id) deny("WORKER_SCOPE", 403);
    if (
      !allowExpired &&
      (m.generation !== h.generation ||
        t.fence !== h.fence ||
        !["queued", "running"].includes(m.state) ||
        a.state !== "running" ||
        a.lease_expires_at.getTime() <= this.now() ||
        a.deadline_at.getTime() <= this.now() ||
        (await this.control(c, m)))
    )
      deny("WORKER_STOPPED");
    return { worker: w, mission: m, task: t, attempt: a };
  }
  protected async executionAuthority<T>(
    located: { mission: MissionRow; task: TaskRow },
    operation: () => Promise<T>,
  ): Promise<T> {
    const grant = this.grant(located.mission);
    return this.auth.guardExecution(grant, (p) =>
      this.authorizationWindow.run(
        {
          expires: p.authorityExpiresAt ?? grant.expiresAt,
        },
        operation,
      ),
    );
  }
  protected async beforePrepare(
    _c: pg.PoolClient,
    ctx: WorkerContext,
  ): Promise<z.infer<typeof runtimeBlocked> | null> {
    if (
      taskDefinition.parse(ctx.task.definition).action.kind ===
      "fixture.approval"
    )
      deny("APPROVAL_REQUIRED", 403);
    return null;
  }
  protected async blockAttempt(
    c: pg.PoolClient,
    ctx: WorkerContext,
    reason: RuntimeReason,
  ) {
    const org = ctx.worker.organization_id;
    await this.retire(c, ctx, "released");
    await c.query(
      "update runtime_tasks set state='blocked',reason=$3 where organization_id=$1 and id=$2 and state in ('leased','running','cancel_requested')",
      [org, ctx.task.id, reason],
    );
    await c.query(
      "update runtime_missions set state='blocked',reason=$3,version=version+1 where organization_id=$1 and id=$2 and state in ('queued','running')",
      [org, ctx.mission.id, reason],
    );
    await this.serviceAudit(
      c,
      org,
      ctx.worker.id,
      ctx.task.id,
      ctx.attempt.id,
      "runtime.task_blocked",
    );
    await this.event(c, ctx.mission, "task.blocked", {
      task_id: ctx.task.id,
      reason,
    });
    return runtimeBlocked.parse({ blocked: true, reason });
  }
  protected async withAttempt<T>(
    token: string,
    protocol: number,
    input: unknown,
    operation: (c: pg.PoolClient, context: WorkerContext) => Promise<T>,
  ): Promise<T> {
    const h = attemptHandle.strip().parse(input),
      located = await this.candidate(token, protocol, h.task_id),
      grant = this.grant(located.mission);
    return this.executionAuthority(located, () =>
      this.tx(located.worker.organization_id, async (c) => {
        const context = await this.attemptContext(c, token, protocol, h);
        const until = this.authorizationWindow.getStore()?.expires;
        if (until !== undefined)
          context.attempt.deadline_at = new Date(
            Math.min(context.attempt.deadline_at.getTime(), until),
          );
        this.lease(context.attempt);
        if (digest(this.grant(context.mission)) !== digest(grant))
          deny("GRANT_DENIED", 403);
        return operation(c, context);
      }),
    );
  }
  protected lease(a: AttemptRow) {
    const lease = a.lease_expires_at.getTime() - this.now(),
      deadline = a.deadline_at.getTime() - this.now();
    if (lease <= 0 || deadline <= 0) deny("WORKER_STOPPED");
    return leaseView.parse({ lease_ms: lease, deadline_ms: deadline });
  }
  async heartbeat(token: string, protocol: number, input: unknown) {
    return this.withAttempt(
      token,
      protocol,
      attemptHandle.parse(input),
      async (c, ctx) => {
        const expires = new Date(this.now() + 15000);
        await c.query(
          "update runtime_attempts set lease_expires_at=$3 where organization_id=$1 and id=$2",
          [ctx.worker.organization_id, ctx.attempt.id, expires],
        );
        ctx.attempt.lease_expires_at = expires;
        return this.lease(ctx.attempt);
      },
    );
  }
  protected async expectedValue(
    c: pg.PoolClient,
    ctx: WorkerContext,
  ): Promise<string> {
    const def = taskDefinition.parse(ctx.task.definition);
    if (
      def.action.kind === "fixture.echo" ||
      def.action.kind === "fixture.wait" ||
      def.action.kind === "fixture.approval"
    )
      return def.action.value;
    if (def.action.kind === "fixture.fail") {
      if (ctx.task.attempt_count > def.action.failures) return "recovered";
      if (def.action.failure === "uncertain") return "uncertain";
    }
    if (def.action.kind === "fixture.model") {
      const row = (
        await c.query<{ proposal: unknown }>(
          "select proposal from runtime_model_calls where organization_id=$1 and attempt_id=$2 and state='completed' order by step desc limit 1",
          [ctx.worker.organization_id, ctx.attempt.id],
        )
      ).rows[0];
      const parsed = z
        .strictObject({
          tool: z.literal("fixture.echo"),
          arguments: z.strictObject({ value: z.string().max(512) }),
        })
        .safeParse(row?.proposal);
      if (parsed.success) return parsed.data.arguments.value;
    }
    deny("TOOL_NOT_AUTHORIZED", 403);
  }
  async prepareAction(
    token: string,
    protocol: number,
    input: unknown,
  ): Promise<z.infer<typeof prepareView>> {
    return this.withAttempt(
      token,
      protocol,
      attemptHandle.parse(input),
      async (c, ctx) => {
        const blocked = await this.beforePrepare(c, ctx);
        if (blocked) return blocked;
        const value = await this.expectedValue(c, ctx),
          key = digest({
            task: ctx.task.id,
            generation: ctx.mission.generation,
            tool: 0,
          }),
          hash = digest({ tool: "fixture.echo", value }),
          old = (
            await c.query<{
              id: string;
              state: string;
              result: { value: string } | null;
            }>(
              "select id,state,result from runtime_action_receipts where organization_id=$1 and action_key=$2 for update",
              [ctx.worker.organization_id, key],
            )
          ).rows[0];
        if (old) {
          if (old.state !== "confirmed") deny("UNCERTAIN_EFFECT");
          return actionPermit.parse({
            receipt_id: old.id,
            cached: true,
            value: old.result?.value ?? null,
            ...this.lease(ctx.attempt),
          });
        }
        const id = randomUUID();
        await c.query(
          "insert into runtime_action_receipts(id,organization_id,mission_id,task_id,attempt_id,action_key,action_hash,state,created_at) values($1,$2,$3,$4,$5,$6,$7,'prepared',$8)",
          [
            id,
            ctx.worker.organization_id,
            ctx.mission.id,
            ctx.task.id,
            ctx.attempt.id,
            key,
            hash,
            new Date(this.now()),
          ],
        );
        await c.query(
          "update runtime_attempts set tool_calls=tool_calls+1 where organization_id=$1 and id=$2 and tool_calls<10",
          [ctx.worker.organization_id, ctx.attempt.id],
        );
        await this.serviceAudit(
          c,
          ctx.worker.organization_id,
          ctx.worker.id,
          ctx.task.id,
          ctx.attempt.id,
          "runtime.action_prepared",
        );
        return actionPermit.parse({
          receipt_id: id,
          cached: false,
          value,
          ...this.lease(ctx.attempt),
        });
      },
    );
  }
  protected async retire(c: pg.PoolClient, ctx: WorkerContext, state: string) {
    await c.query(
      "update runtime_attempts set state=$3,finished_at=$4 where organization_id=$1 and id=$2",
      [ctx.worker.organization_id, ctx.attempt.id, state, new Date(this.now())],
    );
    await c.query(
      "update runtime_agents set state=case when state='disabled' then state else 'idle' end,version=version+1 where organization_id=$1 and id=$2",
      [ctx.worker.organization_id, ctx.attempt.agent_id],
    );
    await this.releaseAttempt(c, ctx.worker.organization_id, ctx.attempt.id);
  }
  async finish(token: string, protocol: number, input: unknown) {
    const v = finishRequest.parse(input);
    return this.withAttempt(token, protocol, v, async (c, ctx) => {
      const org = ctx.worker.organization_id,
        receipts = (
          await c.query<{ id: string; state: string; action_hash: string }>(
            "select id,state,action_hash from runtime_action_receipts where organization_id=$1 and attempt_id=$2 for update",
            [org, ctx.attempt.id],
          )
        ).rows;
      if (v.outcome === "succeeded") {
        const definition = taskDefinition.parse(ctx.task.definition);
        if (
          definition.action.kind === "fixture.fail" &&
          ctx.task.attempt_count <= definition.action.failures
        )
          deny("VERIFICATION_FAILED", 403);
        const expected = await this.expectedValue(c, ctx);
        if (
          v.value !== expected ||
          receipts.length !== 1 ||
          receipts[0]?.action_hash !==
            digest({ tool: "fixture.echo", value: expected })
        )
          deny("VERIFICATION_FAILED", 403);
        await c.query(
          "update runtime_action_receipts set state='confirmed',result=$3 where organization_id=$1 and attempt_id=$2",
          [org, ctx.attempt.id, { value: expected }],
        );
        await c.query(
          "update runtime_tasks set state='succeeded',verified=true,result=$3,reason='none' where organization_id=$1 and id=$2",
          [org, ctx.task.id, { value: expected }],
        );
        this.lease(ctx.attempt);
        await this.retire(c, ctx, "succeeded");
        await this.serviceAudit(
          c,
          org,
          ctx.worker.id,
          ctx.task.id,
          ctx.attempt.id,
          "runtime.task_succeeded",
        );
        await this.event(c, ctx.mission, "task.succeeded", {
          task_id: ctx.task.id,
          verified: true,
        });
        await this.progress(c, await this.mission(c, org, ctx.mission.id));
        return finishView.parse({ ok: true, state: "succeeded" });
      }
      if (receipts.length || v.outcome === "uncertain")
        return this.uncertain(c, ctx);
      const def = taskDefinition.parse(ctx.task.definition),
        retry =
          v.outcome === "transient" &&
          ctx.task.attempt_count < def.max_attempts,
        next = retry ? "retry_wait" : "failed";
      await c.query(
        "update runtime_tasks set state=$3,reason=$4,next_attempt_at=$5 where organization_id=$1 and id=$2",
        [
          org,
          ctx.task.id,
          next,
          retry ? "retry" : "required_failure",
          new Date(
            this.now() +
              Math.min(5000, 1000 * 2 ** (ctx.task.attempt_count - 1)),
          ),
        ],
      );
      await this.retire(c, ctx, "failed");
      await this.serviceAudit(
        c,
        org,
        ctx.worker.id,
        ctx.task.id,
        ctx.attempt.id,
        "runtime.task_failed",
      );
      await this.event(c, ctx.mission, `task.${next}`, {
        task_id: ctx.task.id,
        state: next,
      });
      await this.progress(c, await this.mission(c, org, ctx.mission.id));
      return finishView.parse({ ok: true, state: next });
    });
  }
  protected async uncertain(c: pg.PoolClient, ctx: WorkerContext) {
    const org = ctx.worker.organization_id;
    await c.query(
      "update runtime_action_receipts set state='uncertain' where organization_id=$1 and attempt_id=$2 and state='prepared'",
      [org, ctx.attempt.id],
    );
    await c.query(
      "update runtime_attempts set state='uncertain' where organization_id=$1 and id=$2",
      [org, ctx.attempt.id],
    );
    await c.query(
      "update runtime_tasks set state='blocked',reason='uncertain' where organization_id=$1 and id=$2 and state in ('running','leased','cancel_requested')",
      [org, ctx.task.id],
    );
    await c.query(
      "update runtime_missions set state='blocked',reason='uncertain',version=version+1 where organization_id=$1 and id=$2 and state in ('queued','running','paused','cancelling')",
      [org, ctx.mission.id],
    );
    await this.serviceAudit(
      c,
      org,
      ctx.worker.id,
      ctx.task.id,
      ctx.attempt.id,
      "runtime.task_uncertain",
    );
    await this.event(c, ctx.mission, "task.uncertain", {
      task_id: ctx.task.id,
    });
    return finishView.parse({ ok: true, state: "blocked" });
  }
  async acknowledgeStopped(token: string, protocol: number, input: unknown) {
    const h = attemptHandle.parse(input),
      parts = this.workerParts(token, protocol);
    return this.tx(parts.org, async (c) => {
      const ctx = await this.attemptContext(c, token, protocol, h, true);
      if (
        !["leased", "running", "cancel_requested"].includes(ctx.attempt.state)
      )
        return { ok: true as const };
      const receipt = (
        await c.query(
          "select id from runtime_action_receipts where organization_id=$1 and attempt_id=$2",
          [parts.org, h.attempt_id],
        )
      ).rowCount;
      const modelUnknown = (
        await c.query(
          "select request_id from runtime_model_calls where organization_id=$1 and attempt_id=$2 and state in ('dispatched','uncertain')",
          [parts.org, h.attempt_id],
        )
      ).rowCount;
      if (receipt || modelUnknown) {
        await this.uncertain(c, ctx);
        return { ok: true as const };
      }
      await this.retire(c, ctx, "released");
      if (["leased", "running", "cancel_requested"].includes(ctx.task.state))
        await c.query(
          "update runtime_tasks set state='blocked',reason='stop' where organization_id=$1 and id=$2",
          [parts.org, h.task_id],
        );
      if (["queued", "running"].includes(ctx.mission.state))
        await c.query(
          "update runtime_missions set state='blocked',reason='stop',version=version+1 where organization_id=$1 and id=$2",
          [parts.org, ctx.mission.id],
        );
      return { ok: true as const };
    });
  }
}
