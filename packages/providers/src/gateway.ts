import { createHash } from "node:crypto";
import {
  AuthError,
  type ExecutionGrant,
  executionGrantSchema,
  type Principal,
} from "@craftlayer/auth";
import {
  type BudgetLimits,
  defaultModelPolicy,
  type GenerateRequest,
  generateRequestSchema,
  type ModelPolicy,
  modelPolicySchema,
  modelSchema,
} from "@craftlayer/contracts";
import type pg from "pg";
import { z } from "zod";
import {
  GatewayControl,
  type GatewayOptions,
  type ScopeKind,
} from "./control.js";
import { ProviderError } from "./index.js";
import {
  type BudgetConfiguration,
  BudgetLedger,
  type LedgerContext,
} from "./ledger.js";
import {
  type Candidate,
  ModelRouter,
  RouterBlocked,
  type RouterPort,
  type RoutingSnapshot,
} from "./router.js";

const contextSchema = z
  .strictObject({
    mission_id: z.uuid().optional(),
    task_id: z.uuid().optional(),
  })
  .refine((v) => !v.task_id || Boolean(v.mission_id));
export type ExecutionBudgetContext = z.infer<typeof contextSchema>;
interface CurrentState extends RoutingSnapshot {
  budget: BudgetConfiguration;
}
export class ProviderGateway extends GatewayControl {
  private ledger: BudgetLedger;
  constructor(options: GatewayOptions) {
    super(options);
    this.ledger = new BudgetLedger(this.now);
  }
  private async execute<T>(
    grant: ExecutionGrant,
    labels: ExecutionBudgetContext,
    operation: (
      client: pg.PoolClient,
      p: Principal,
      context: LedgerContext,
    ) => Promise<T>,
  ): Promise<T> {
    return this.auth.guardExecution(grant, (p) =>
      this.tx(grant.organizationId, async (client) => {
        if (
          p.user.account_type !== "adult" ||
          grant.permission !== "mission:execute" ||
          grant.resource.kind === "organization"
        )
          throw new ProviderError("policy_denied", false);
        const project =
          grant.resource.kind === "project"
            ? grant.resource.id
            : (
                await client.query<{ project_id: string }>(
                  "select project_id from environments where organization_id=$1 and id=$2",
                  [grant.organizationId, grant.resource.id],
                )
              ).rows[0]?.project_id;
        if (!project) throw new ProviderError("policy_denied", false);
        return operation(client, p, {
          org: grant.organizationId,
          user: p.user.id,
          project,
          mission: labels.mission_id,
          task: labels.task_id,
        });
      }),
    );
  }
  private async current(
    client: pg.PoolClient,
    context: LedgerContext,
  ): Promise<CurrentState> {
    await this.policyLock(client, context.org);
    const instance = await this.files.policy(),
      fileStamp = await this.files.stamp();
    const state = (
      await client.query<{ version: number; stopped: boolean }>(
        "select version,stopped from provider_routing_state where organization_id=$1",
        [context.org],
      )
    ).rows[0];
    const rows = (
      await client.query<{
        scope_kind: string;
        scope_id: string;
        version: number;
        policy: unknown;
      }>(
        "select scope_kind,scope_id,version,policy from provider_scope_policies where organization_id=$1 and ((scope_kind='organization' and scope_id=$1) or (scope_kind='user' and scope_id=$2) or (scope_kind='project' and scope_id=$3)) order by scope_kind,scope_id",
        [context.org, context.user, context.project],
      )
    ).rows;
    const policies: Record<string, ModelPolicy> = {};
    for (const row of rows)
      policies[`${row.scope_kind}/${row.scope_id}`] = modelPolicySchema.parse(
        row.policy,
      );
    policies[`organization/${context.org}`] ??=
      modelPolicySchema.parse(defaultModelPolicy);
    const connections = (
      await client.query<{
        id: string;
        kind: "ollama" | "openrouter";
        endpoint_id: string;
        version: number;
        descriptor: unknown;
        retry_at: Date | null;
      }>(
        "select c.id,c.kind,c.endpoint_id,c.version,s.descriptor,d.retry_at from provider_connections c join model_snapshots s on s.organization_id=c.organization_id and s.connection_id=c.id and s.connection_version=c.version left join provider_cooldowns d on d.organization_id=c.organization_id and d.connection_id=c.id where c.organization_id=$1 and c.enabled=true order by c.created_at,c.id,s.model_id limit 3200",
        [context.org],
      )
    ).rows;
    const candidates: Candidate[] = [];
    for (const row of connections) {
      const parsed = modelSchema.safeParse(row.descriptor);
      if (!parsed.success) continue;
      const model = parsed.data;
      let allowed: string[] = [];
      try {
        allowed =
          row.kind === "ollama"
            ? (this.endpoint(row, instance)?.models ?? [])
            : instance.openrouter_enabled
              ? instance.openrouter_models
              : [];
      } catch {
        continue;
      }
      if (
        model.provider !== row.kind ||
        model.classification !==
          (row.kind === "ollama" ? "operator_local" : "hosted") ||
        !allowed.includes(model.id)
      )
        continue;
      candidates.push({
        connection_id: row.id,
        version: row.version,
        model,
        cooldown_until: row.retry_at?.getTime() ?? 0,
      });
    }
    const epoch = createHash("sha256")
      .update(
        JSON.stringify([
          fileStamp,
          state?.version ?? 0,
          rows,
          candidates.map((c) => [
            c.connection_id,
            c.version,
            c.model.id,
            c.model.pricing.source_hash,
          ]),
        ]),
      )
      .digest("hex");
    return {
      epoch,
      stopped: instance.stopped || (state?.stopped ?? false),
      policies: Object.values(policies),
      allow_paid: instance.allow_paid,
      max_paid_micro_usd: instance.max_paid_micro_usd,
      candidates,
      budget: {
        instance: instance.limits,
        instance_paid_cap: instance.allow_paid
          ? instance.max_paid_micro_usd
          : "0",
        policies,
      },
    };
  }
  /** Internal runtime API only. Mission/task labels are budget grouping, not authorization. */
  async generate(
    inputGrant: ExecutionGrant,
    input: GenerateRequest,
    inputLabels: ExecutionBudgetContext = {},
    signal: AbortSignal = AbortSignal.timeout(60000),
  ) {
    const grant = executionGrantSchema.parse(structuredClone(inputGrant)),
      request = generateRequestSchema.parse(structuredClone(input)),
      labels = contextSchema.parse(structuredClone(inputLabels));
    const snapshot = () =>
      this.execute(grant, labels, (client, _p, context) =>
        this.current(client, context),
      );
    const port: RouterPort = {
      snapshot,
      begin: (body) =>
        this.execute(grant, labels, (client, _p, context) =>
          this.ledger.begin(client, context, body),
        ),
      reserve: (candidate, body, attempt, epoch, cost) =>
        this.execute(grant, labels, async (client, _p, context) => {
          const state = await this.current(client, context);
          if (state.epoch !== epoch || state.stopped)
            throw new RouterBlocked(["policy_changed"]);
          return this.ledger.reserve(
            client,
            context,
            body,
            candidate,
            attempt,
            epoch,
            cost,
            state.budget,
          );
        }),
      dispatch: (reservation, epoch) =>
        this.execute(grant, labels, async (client, _p, context) => {
          const state = await this.current(client, context);
          if (state.epoch !== epoch || state.stopped)
            throw new ProviderError("policy_denied", false);
          const connection = (
            await client.query<{ id: string }>(
              "select c.id from provider_connections c join usage_reservations r on r.organization_id=c.organization_id and r.connection_id=c.id and r.connection_version=c.version where c.organization_id=$1 and r.id=$2 and c.enabled=true for share of c",
              [context.org, reservation.id],
            )
          ).rows[0];
          if (!connection) throw new ProviderError("policy_denied", false);
          await this.ledger.dispatch(
            client,
            context,
            reservation,
            epoch,
            state.budget,
          );
        }),
      // Settlement must survive initiating-session revocation; this closure retains canonical org.
      complete: (reservation, outcome) =>
        this.tx(grant.organizationId, (client) =>
          this.ledger.complete(
            client,
            grant.organizationId,
            reservation,
            outcome,
          ),
        ),
      cooldown: (id, delay) =>
        this.recordCooldown(grant.organizationId, id, delay),
      provider: (candidate) =>
        this.execute(grant, labels, async (client) => {
          const row = await this.row(
            client,
            grant.organizationId,
            candidate.connection_id,
          );
          this.assertVersion(row, candidate.version);
          if (!row.enabled) throw new ProviderError("policy_denied", false);
          return this.adapter(row, await this.files.policy(), true);
        }),
    };
    return new ModelRouter(port, this.now).run(request, signal);
  }
  async getBudget(token: string, org: string, kind: ScopeKind, id: string) {
    return this.auth.guardOrganization(token, org, "budget:manage", () =>
      this.tx(org, async (client) => {
        await this.scope(client, org, kind, id);
        return this.ledger.getLimits(client, org, { kind, id });
      }),
    );
  }
  async setBudget(
    token: string,
    org: string,
    kind: ScopeKind,
    id: string,
    version: number,
    limits: BudgetLimits,
  ) {
    return this.auth.guardOrganization(token, org, "budget:manage", (p) =>
      this.tx(org, async (client) => {
        await this.scope(client, org, kind, id);
        const result = await this.ledger.setLimits(
          client,
          org,
          { kind, id },
          version,
          limits,
        );
        await this.audit(client, org, p.user.id, "provider.budget_changed", id);
        return result;
      }),
    );
  }
  async usage(token: string, org: string) {
    return this.auth.guardOrganization(token, org, "budget:manage", () =>
      this.tx(org, async (client) => ({
        reservations: (
          await client.query(
            "select r.id,q.request_id,r.connection_id,r.model_id,r.state,r.input_max,r.output_max,r.max_cost,r.charged_input,r.charged_output,r.charged_cost,r.usage_quality,r.created_at from usage_reservations r join provider_requests q on q.organization_id=r.organization_id and q.id=r.request_pk where r.organization_id=$1 order by r.created_at desc,r.id limit 100",
            [org],
          )
        ).rows,
        ledger: (
          await client.query(
            "select id,reservation_id,event,usage_quality,spend_quality,reserved_delta,used_delta,receipt_hash,created_at from usage_ledger where organization_id=$1 order by id desc limit 100",
            [org],
          )
        ).rows,
      })),
    );
  }
  async reconcile(
    token: string,
    org: string,
    id: string,
    receipt: string,
    confirmed: boolean,
  ) {
    z.uuid().parse(id);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(receipt);
    if (confirmed !== true)
      throw new AuthError(
        400,
        "QUIESCENCE_REQUIRED",
        "Confirm the provider request is no longer running.",
      );
    return this.auth.guardOrganization(token, org, "budget:manage", (p) =>
      this.tx(org, async (client) => {
        await this.ledger.reconcile(client, org, id, receipt);
        await this.audit(
          client,
          org,
          p.user.id,
          "provider.reservation_reconciled",
          id,
        );
        return { ok: true as const };
      }),
    );
  }
}
