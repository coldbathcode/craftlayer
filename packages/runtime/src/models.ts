import { randomUUID } from "node:crypto";
import { AuthError, type ExecutionGrant } from "@craftlayer/auth";
import {
  approvalView,
  fixtureTool,
  modelDecision,
  type RuntimeReason,
  runtimeBlocked,
  taskDefinition,
} from "@craftlayer/contracts";
import type pg from "pg";
import { z } from "zod";
import { deny, digest, type MissionRow, type TaskRow } from "./repository.js";
import {
  type AttemptRow,
  RuntimeWorkers,
  type WorkerContext,
} from "./workers.js";

type Proposal = z.infer<typeof fixtureTool>;
interface ApprovalRow {
  id: string;
  organization_id: string;
  mission_id: string;
  task_id: string;
  generation: number;
  state: string;
  action_hash: string;
  requester_id: string;
  approver_id: string | null;
  approver_grant: ExecutionGrant | null;
  expires_at: Date;
}
export class RuntimeModels extends RuntimeWorkers {
  private async approvalHash(c: pg.PoolClient, m: MissionRow, t: TaskRow) {
    const versions = [];
    for (const scope of this.scopes(
      m.organization_id,
      this.grant(m).userId,
      m.project_id,
    )) {
      const q = await this.quota(c, m.organization_id, scope);
      versions.push([scope.kind, scope.id, q.version]);
    }
    return digest({
      schema_version: 1,
      mission: m.id,
      task: t.id,
      definition: taskDefinition.parse(t.definition),
      generation: m.generation,
      environment: m.environment_id,
      template_hash: m.template_hash,
      versions,
    });
  }
  private async approval(c: pg.PoolClient, m: MissionRow, t: TaskRow) {
    const hash = await this.approvalHash(c, m, t);
    return (
      await c.query<ApprovalRow>(
        "select * from runtime_approvals where organization_id=$1 and task_id=$2 and generation=$3 and action_hash=$4",
        [m.organization_id, t.id, m.generation, hash],
      )
    ).rows[0];
  }
  protected override async executionAuthority<T>(
    located: { mission: MissionRow; task: TaskRow },
    operation: () => Promise<T>,
  ): Promise<T> {
    const required =
        taskDefinition.parse(located.task.definition).action.kind ===
        "fixture.approval",
      approval = required
        ? await this.tx(located.mission.organization_id, (c) =>
            this.approval(c, located.mission, located.task),
          )
        : undefined;
    const grant = this.grant(located.mission);
    return this.auth.guardExecution(grant, (p) => {
      const expires = p.authorityExpiresAt ?? grant.expiresAt;
      if (
        approval?.approver_grant &&
        ["approved", "consumed"].includes(approval.state)
      ) {
        const approvedGrant = approval.approver_grant;
        return this.auth.guardExecution(approvedGrant, (ap) =>
          this.authorizationWindow.run(
            {
              expires: Math.min(
                expires,
                ap.authorityExpiresAt ?? approvedGrant.expiresAt,
                approval.expires_at.getTime(),
              ),
              approvalId: approval.id,
              approvalSignature: approvedGrant.signature,
            },
            operation,
          ),
        );
      }
      return this.authorizationWindow.run({ expires }, operation);
    });
  }
  protected override async beforePrepare(c: pg.PoolClient, ctx: WorkerContext) {
    const def = taskDefinition.parse(ctx.task.definition);
    if (def.action.kind !== "fixture.approval") return null;
    const hash = await this.approvalHash(c, ctx.mission, ctx.task),
      old = await this.approval(c, ctx.mission, ctx.task);
    if (
      old &&
      ["approved", "consumed"].includes(old.state) &&
      old.expires_at.getTime() > this.now() &&
      old.approver_id !== this.grant(ctx.mission).userId &&
      old.approver_grant &&
      this.authorizationWindow.getStore()?.approvalId === old.id &&
      this.authorizationWindow.getStore()?.approvalSignature ===
        old.approver_grant.signature
    ) {
      if (old.state === "approved")
        await c.query(
          "update runtime_approvals set state='consumed' where organization_id=$1 and id=$2 and state='approved'",
          [ctx.worker.organization_id, old.id],
        );
      return null;
    }
    if (!old)
      await c.query(
        "insert into runtime_approvals(id,organization_id,mission_id,task_id,action_hash,requester_id,generation,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          ctx.worker.organization_id,
          ctx.mission.id,
          ctx.task.id,
          hash,
          this.grant(ctx.mission).userId,
          ctx.mission.generation,
          new Date(
            Math.min(
              this.now() + 300000,
              ctx.mission.deadline?.getTime() ?? this.now(),
            ),
          ),
        ],
      );
    return this.blockAttempt(c, ctx, "approval");
  }
  private dto(a: ApprovalRow, t: TaskRow) {
    const def = taskDefinition.parse(t.definition);
    if (def.action.kind !== "fixture.approval") deny("APPROVAL_INVALID", 403);
    return approvalView.parse({
      id: a.id,
      mission_id: a.mission_id,
      task_id: a.task_id,
      generation: a.generation,
      state: a.state,
      action_hash: a.action_hash,
      action: { tool: "fixture.echo", arguments: { value: def.action.value } },
      expires_at: a.expires_at.toISOString(),
    });
  }
  async listApprovals(token: string, org: string, environment: string) {
    return this.scoped(
      token,
      org,
      environment,
      "approval:decide",
      async (c) => {
        const rows = (
          await c.query<ApprovalRow>(
            "select a.* from runtime_approvals a join runtime_missions m on m.organization_id=a.organization_id and m.id=a.mission_id where a.organization_id=$1 and m.environment_id=$2 order by a.expires_at desc,a.id limit 100",
            [org, environment],
          )
        ).rows;
        const result = [];
        for (const row of rows) {
          const task = (
            await c.query<TaskRow>(
              "select * from runtime_tasks where organization_id=$1 and id=$2",
              [org, row.task_id],
            )
          ).rows[0];
          if (task) result.push(this.dto(row, task));
        }
        return result;
      },
    );
  }
  async decideApproval(
    token: string,
    org: string,
    id: string,
    decision: "approve" | "reject",
  ) {
    z.uuid().parse(id);
    z.enum(["approve", "reject"]).parse(decision);
    const located = await this.member(token, org, () =>
        this.tx(org, async (c) => {
          const row = (
            await c.query<ApprovalRow>(
              "select * from runtime_approvals where organization_id=$1 and id=$2",
              [org, id],
            )
          ).rows[0];
          if (!row) deny("NOT_FOUND", 404);
          return {
            approval: row,
            mission: await this.mission(c, org, row.mission_id),
          };
        }),
      ),
      grant = await this.auth.issueExecutionGrant(
        token,
        org,
        "approval:decide",
        { kind: "environment", id: located.mission.environment_id },
      );
    return this.auth.guardExecution(grant, (p) =>
      this.tx(org, async (c) => {
        const m = await this.mission(c, org, located.mission.id),
          t = (
            await c.query<TaskRow>(
              "select * from runtime_tasks where organization_id=$1 and id=$2",
              [org, located.approval.task_id],
            )
          ).rows[0],
          a = t ? await this.approval(c, m, t) : undefined;
        if (
          !a ||
          !t ||
          a.id !== id ||
          a.state !== "pending" ||
          a.expires_at.getTime() <= this.now() ||
          a.generation !== m.generation
        )
          deny("APPROVAL_STALE");
        if (p.user.account_type !== "adult" || p.user.id === a.requester_id)
          deny("SELF_APPROVAL_DENIED", 403);
        await c.query(
          "update runtime_approvals set state=$3,approver_id=$4,approver_grant=$5 where organization_id=$1 and id=$2",
          [
            org,
            id,
            decision === "approve" ? "approved" : "rejected",
            p.user.id,
            grant,
          ],
        );
        await this.audit(c, org, p.user.id, `runtime.approval_${decision}`, id);
        if (decision === "reject") {
          if (t.state === "blocked")
            await c.query(
              "update runtime_tasks set state='failed',reason='approval' where organization_id=$1 and id=$2",
              [org, t.id],
            );
          if (m.state === "blocked") {
            await c.query(
              "update runtime_missions set state='failed',reason='approval',version=version+1 where organization_id=$1 and id=$2",
              [org, m.id],
            );
            await this.releaseMission(c, m);
          }
        } else
          await c.query(
            "insert into runtime_tenants(organization_id) values($1) on conflict(organization_id) do update set active=true",
            [org],
          );
        await this.event(c, m, "approval.decided", {
          approval_id: id,
          decision,
        });
        return this.dto(
          { ...a, state: decision === "approve" ? "approved" : "rejected" },
          t,
        );
      }),
    );
  }
  protected override async resolvePending(org: string) {
    const pending = await this.tx(
      org,
      async (c) =>
        (
          await c.query<ApprovalRow>(
            "select a.* from runtime_approvals a join runtime_missions m on m.organization_id=a.organization_id and m.id=a.mission_id where a.organization_id=$1 and a.state='approved' and m.state='blocked' and m.reason='approval' and m.generation=a.generation and a.expires_at>$2 limit 4",
            [org, new Date(this.now())],
          )
        ).rows,
    );
    for (const a of pending) {
      if (!a.approver_grant) continue;
      const located = await this.tx(org, async (c) => {
        const m = await this.mission(c, org, a.mission_id),
          t = (
            await c.query<TaskRow>(
              "select * from runtime_tasks where organization_id=$1 and id=$2",
              [org, a.task_id],
            )
          ).rows[0];
        return { mission: m, task: t };
      });
      if (!located.task) continue;
      try {
        await this.executionAuthority(
          { mission: located.mission, task: located.task },
          () =>
            this.tx(org, async (c) => {
              const m = await this.mission(c, org, a.mission_id),
                t = (
                  await c.query<TaskRow>(
                    "select * from runtime_tasks where organization_id=$1 and id=$2",
                    [org, a.task_id],
                  )
                ).rows[0];
              if (
                !t ||
                m.state !== "blocked" ||
                m.reason !== "approval" ||
                (await this.control(c, m))
              )
                return;
              const current = await this.approval(c, m, t);
              if (
                !current ||
                current.id !== a.id ||
                current.state !== "approved" ||
                current.expires_at.getTime() <= this.now() ||
                (this.authorizationWindow.getStore()?.expires ?? 0) <=
                  this.now()
              )
                return;
              await c.query(
                "update runtime_tasks set state='ready',reason='none',next_attempt_at=$3 where organization_id=$1 and id=$2 and state='blocked'",
                [org, t.id, new Date(this.now())],
              );
              await c.query(
                "update runtime_missions set state='queued',reason='none',version=version+1 where organization_id=$1 and id=$2",
                [org, m.id],
              );
              const row = await this.mission(c, org, m.id);
              await this.queued(c, row);
              await this.event(c, row, "mission.approval_resolved", {
                state: "queued",
              });
            }),
        );
      } catch (error) {
        if (!(error instanceof AuthError) || error.status !== 403) throw error;
        await this.tx(org, async (c) => {
          await c.query(
            "update runtime_approvals set expires_at=least(expires_at,$3) where organization_id=$1 and id=$2 and state='approved'",
            [org, a.id, new Date(this.now())],
          );
          await this.event(c, located.mission, "approval.invalidated", {
            approval_id: a.id,
          });
        });
      }
    }
  }
  private async modelSettlement(
    c: pg.PoolClient,
    old: WorkerContext,
  ): Promise<WorkerContext | null> {
    const a = (
      await c.query<AttemptRow>(
        "select * from runtime_attempts where organization_id=$1 and id=$2 for update",
        [old.worker.organization_id, old.attempt.id],
      )
    ).rows[0];
    if (!a || !["leased", "running", "cancel_requested"].includes(a.state))
      return null;
    const m = await this.mission(c, old.worker.organization_id, a.mission_id),
      t = (
        await c.query<TaskRow>(
          "select * from runtime_tasks where organization_id=$1 and id=$2 for update",
          [old.worker.organization_id, a.task_id],
        )
      ).rows[0];
    if (!t || t.fence !== a.fence) return null;
    return { worker: old.worker, mission: m, task: t, attempt: a };
  }
  private async modelBlocked(
    old: WorkerContext,
    request: string,
    reason: RuntimeReason,
  ) {
    return this.tx(old.worker.organization_id, async (c) => {
      const row = (
          await c.query<{ state: string }>(
            "select state from runtime_model_calls where organization_id=$1 and request_id=$2 for update",
            [old.worker.organization_id, request],
          )
        ).rows[0],
        ctx = await this.modelSettlement(c, old);
      const uncertain =
        row?.state === "dispatched" || row?.state === "uncertain";
      await c.query(
        "update runtime_model_calls set state=$3 where organization_id=$1 and request_id=$2 and state not in ('completed','invalid')",
        [
          old.worker.organization_id,
          request,
          uncertain ? "uncertain" : "invalid",
        ],
      );
      if (ctx) {
        const receipt = (
          await c.query(
            "select id from runtime_action_receipts where organization_id=$1 and attempt_id=$2",
            [ctx.worker.organization_id, ctx.attempt.id],
          )
        ).rowCount;
        if (uncertain || receipt) {
          await this.uncertain(c, ctx);
          return runtimeBlocked.parse({ blocked: true, reason: "uncertain" });
        }
        return this.blockAttempt(c, ctx, reason);
      }
      return runtimeBlocked.parse({
        blocked: true,
        reason: uncertain ? "uncertain" : reason,
      });
    });
  }
  async decide(
    token: string,
    protocol: number,
    input: unknown,
    signal: AbortSignal = AbortSignal.timeout(10000),
  ) {
    const handle = z
      .strictObject({
        attempt_id: z.uuid(),
        task_id: z.uuid(),
        fence: z.number().int().positive(),
        generation: z.number().int().positive(),
      })
      .parse(input);
    for (let repair = 0; repair < 3; repair++) {
      const prepared = await this.withAttempt(
        token,
        protocol,
        handle,
        async (c, ctx) => {
          const def = taskDefinition.parse(ctx.task.definition);
          if (def.action.kind !== "fixture.model")
            deny("MODEL_NOT_AUTHORIZED", 403);
          const last = (
            await c.query<{
              step: number;
              request_id: string;
              state: string;
              proposal: unknown;
            }>(
              "select step,request_id,state,proposal from runtime_model_calls where organization_id=$1 and attempt_id=$2 order by step desc limit 1",
              [ctx.worker.organization_id, ctx.attempt.id],
            )
          ).rows[0];
          if (last?.state === "completed")
            return {
              kind: "cached" as const,
              proposal: fixtureTool.parse(last.proposal),
              ...this.lease(ctx.attempt),
            };
          if (last && last.state !== "invalid")
            deny("MODEL_DECISION_IN_FLIGHT");
          const step = (last?.step ?? -1) + 1;
          if (step > 2 || !this.providers)
            return {
              kind: "blocked" as const,
              ...(await this.blockAttempt(
                c,
                ctx,
                step > 2 ? "invalid_plan" : "provider",
              )),
            };
          const request = randomUUID();
          await c.query(
            "insert into runtime_model_calls(organization_id,mission_id,task_id,attempt_id,step,request_id,state) values($1,$2,$3,$4,$5,$6,'prepared')",
            [
              ctx.worker.organization_id,
              ctx.mission.id,
              ctx.task.id,
              ctx.attempt.id,
              step,
              request,
            ],
          );
          return {
            kind: "call" as const,
            ctx,
            step,
            request,
            prompt: def.action.prompt,
            timeout: Math.min(
              4000,
              ctx.attempt.deadline_at.getTime() - this.now(),
            ),
          };
        },
      );
      if (prepared.kind === "blocked")
        return runtimeBlocked.parse({ blocked: true, reason: prepared.reason });
      if (prepared.kind === "cached")
        return modelDecision.parse({
          proposal: prepared.proposal,
          lease_ms: prepared.lease_ms,
          deadline_ms: prepared.deadline_ms,
        });
      let proposal: Proposal | undefined;
      try {
        const gateway = this.providers;
        if (!gateway) deny("PROVIDER_UNCONFIGURED");
        const response = await gateway.generate(
          this.grant(prepared.ctx.mission),
          {
            schema_version: 1,
            request_id: prepared.request,
            messages: [
              {
                role: "system",
                content:
                  'Return only JSON: {"tool":"fixture.echo","arguments":{"value":"a short result"}}. No other tools or authority fields are permitted.',
              },
              { role: "user", content: prepared.prompt },
              ...(prepared.step
                ? [
                    {
                      role: "system" as const,
                      content:
                        "Previous proposal was invalid. Return only the permitted JSON schema.",
                    },
                  ]
                : []),
            ],
            max_input_tokens: 12288,
            max_output_tokens: 256,
            timeout_ms: Math.max(100, prepared.timeout),
            response_format: "text",
            tools: [],
          },
          {
            mission_id: prepared.ctx.mission.id,
            task_id: prepared.ctx.task.id,
            attempt_id: prepared.ctx.attempt.id,
          },
          signal,
        );
        if (
          Buffer.byteLength(response.result.text) <= 4096 &&
          response.result.tool_calls.length === 0
        ) {
          try {
            const parsed = fixtureTool.safeParse(
              JSON.parse(response.result.text),
            );
            if (parsed.success) proposal = parsed.data;
          } catch {}
        }
      } catch (error) {
        return this.modelBlocked(
          prepared.ctx,
          prepared.request,
          error instanceof AuthError && error.status === 403
            ? "permission"
            : "provider",
        );
      }
      await this.tx(prepared.ctx.worker.organization_id, async (c) => {
        await c.query(
          "update runtime_model_calls set state=$3,proposal=$4 where organization_id=$1 and request_id=$2",
          [
            prepared.ctx.worker.organization_id,
            prepared.request,
            proposal ? "completed" : "invalid",
            proposal ?? null,
          ],
        );
      });
      if (proposal) {
        try {
          return await this.withAttempt(
            token,
            protocol,
            handle,
            async (_c, ctx) =>
              modelDecision.parse({ proposal, ...this.lease(ctx.attempt) }),
          );
        } catch {
          return this.modelBlocked(prepared.ctx, prepared.request, "stop");
        }
      }
    }
    return this.withAttempt(token, protocol, handle, (c, ctx) =>
      this.blockAttempt(c, ctx, "invalid_plan"),
    );
  }
}
