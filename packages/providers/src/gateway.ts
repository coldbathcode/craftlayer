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
    attempt_id: z.uuid().optional(),
  })
  .refine(
    (v) =>
      (!v.task_id || Boolean(v.mission_id)) &&
      (!v.attempt_id || Boolean(v.mission_id && v.task_id)),
  );
export type ExecutionBudgetContext = z.infer<typeof contextSchema>;
const standingSchema = z.strictObject({
  org: z.uuid(),
  userId: z.uuid(),
  membershipId: z.uuid(),
  projectId: z.uuid(),
});
export type StandingAuthority = z.infer<typeof standingSchema>;
const modelChoiceSchema = z.strictObject({
  connection_id: z.uuid(),
  model_id: z.string().min(1).max(180),
});
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
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
        kind: "ollama" | "openrouter" | "openai_compatible";
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
        allowed = this.approvedModels(row, instance);
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
      labels = contextSchema.parse(structuredClone(inputLabels));
    return this.route(
      {
        organizationId: grant.organizationId,
        run: (operation) => this.execute(grant, labels, operation),
        guard: async (client, principal, context, request) => {
          if (!labels.attempt_id) return;
          const allowed = (
            await client.query<{ allowed: boolean }>(
              "select runtime_guard_provider_dispatch_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) as allowed",
              [
                context.org,
                labels.mission_id,
                labels.task_id,
                labels.attempt_id,
                request.request_id,
                grant.id,
                grant.signature,
                new Date(this.now()),
                new Date(principal.authorityExpiresAt ?? grant.expiresAt),
              ],
            )
          ).rows[0]?.allowed;
          if (!allowed) throw new ProviderError("policy_denied", false);
        },
        expiry: (principal) => principal.authorityExpiresAt ?? grant.expiresAt,
      },
      input,
      signal,
    );
  }
  /**
   * Master plan G (ADR 0052): a call for a long-running AI player. Authority is the
   * delegating adult's current standing (no session), re-checked at every step; the
   * call may use exactly the model chosen in the player's profile, nothing else.
   * Budgets apply to the adult and the player's project like any other call.
   */
  async generateStanding(
    standing: StandingAuthority,
    choice: ModelChoice,
    input: GenerateRequest,
    signal: AbortSignal = AbortSignal.timeout(60000),
  ) {
    const value = standingSchema.parse(structuredClone(standing)),
      chosen = modelChoiceSchema.parse(structuredClone(choice));
    return this.route(
      {
        organizationId: value.org,
        run: (operation) => this.executeStanding(value, operation),
        guard: async () => {},
        expiry: (principal) => principal.authorityExpiresAt ?? 0,
        choice: chosen,
      },
      input,
      signal,
    );
  }
  /**
   * Refreshes one connection's model snapshot under standing authority, so a
   * long-running player is not blocked by the five-minute price freshness rule.
   * Only the instance operator's approved models are stored.
   */
  async refreshStanding(standing: StandingAuthority, connectionId: string) {
    const value = standingSchema.parse(structuredClone(standing));
    const state = await this.executeStanding(value, async (client) => {
      const row = await this.row(client, value.org, connectionId);
      if (!row.enabled) throw new ProviderError("policy_denied", false);
      return row;
    });
    const policy = await this.files.policy(),
      stamp = await this.files.stamp(),
      adapter = await this.adapter(state, policy);
    const approved = this.approvedModels(state, policy);
    const models = (await adapter.discover(AbortSignal.timeout(4000)))
      .map((m) => modelSchema.parse(m))
      .filter((m) => approved.includes(m.id));
    if (
      models.length > 32 ||
      models.some(
        (m) =>
          m.provider !== state.kind ||
          m.classification !==
            (state.kind === "ollama" ? "operator_local" : "hosted"),
      )
    )
      throw new ProviderError("malformed_response", false);
    return this.executeStanding(value, async (client) => {
      const row = await this.row(client, value.org, connectionId, true);
      this.assertVersion(row, state.version);
      if (!row.enabled || (await this.files.stamp()) !== stamp)
        throw new ProviderError("policy_denied", false);
      await client.query(
        "delete from model_snapshots where organization_id=$1 and connection_id=$2",
        [value.org, connectionId],
      );
      for (const model of models)
        await client.query(
          "insert into model_snapshots(organization_id,connection_id,connection_version,model_id,descriptor,fetched_at,expires_at) values($1,$2,$3,$4,$5::jsonb,$6,$7)",
          [
            value.org,
            connectionId,
            row.version,
            model.id,
            JSON.stringify(model),
            new Date(model.pricing.observed_at),
            new Date(model.pricing.expires_at),
          ],
        );
      return models;
    });
  }
  /** The chosen model's current snapshot (for cost bounds), or null when absent or stale. */
  async chosenModel(standing: StandingAuthority, choice: ModelChoice) {
    const value = standingSchema.parse(structuredClone(standing)),
      chosen = modelChoiceSchema.parse(structuredClone(choice));
    return this.executeStanding(value, async (client) => {
      const row = (
        await client.query<{ descriptor: unknown; expires_at: Date }>(
          "select s.descriptor,s.expires_at from model_snapshots s join provider_connections c on c.organization_id=s.organization_id and c.id=s.connection_id and c.version=s.connection_version where s.organization_id=$1 and s.connection_id=$2 and s.model_id=$3 and c.enabled=true",
          [value.org, chosen.connection_id, chosen.model_id],
        )
      ).rows[0];
      if (!row) return null;
      const model = modelSchema.safeParse(row.descriptor);
      return model.success ? model.data : null;
    });
  }
  private async executeStanding<T>(
    standing: StandingAuthority,
    operation: (
      client: pg.PoolClient,
      p: Principal,
      context: LedgerContext,
    ) => Promise<T>,
  ): Promise<T> {
    return this.auth.guardStanding(
      standing.org,
      { userId: standing.userId, membershipId: standing.membershipId },
      "ai_player:manage",
      { kind: "project", id: standing.projectId },
      (p) =>
        this.tx(standing.org, (client) =>
          operation(client, p, {
            org: standing.org,
            user: p.user.id,
            project: standing.projectId,
          }),
        ),
    );
  }
  private async route(
    authority: {
      organizationId: string;
      run: <T>(
        operation: (
          client: pg.PoolClient,
          p: Principal,
          context: LedgerContext,
        ) => Promise<T>,
      ) => Promise<T>;
      guard: (
        client: pg.PoolClient,
        p: Principal,
        context: LedgerContext,
        request: GenerateRequest,
      ) => Promise<void>;
      expiry: (p: Principal) => number;
      choice?: ModelChoice;
    },
    input: GenerateRequest,
    signal: AbortSignal,
  ) {
    const request = generateRequestSchema.parse(structuredClone(input));
    const { run, choice } = authority;
    const snapshot = async () => {
      const state = await run((client, _p, context) =>
        this.current(client, context),
      );
      if (!choice) return state;
      return {
        ...state,
        candidates: state.candidates.filter(
          (c) =>
            c.connection_id === choice.connection_id &&
            c.model.id === choice.model_id,
        ),
      };
    };
    const port: RouterPort = {
      snapshot,
      begin: (body) =>
        run((client, _p, context) => this.ledger.begin(client, context, body)),
      reserve: (candidate, body, attempt, epoch, cost) =>
        run(async (client, _p, context) => {
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
        run(async (client, principal, context) => {
          await authority.guard(client, principal, context, request);
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
          if (authority.expiry(principal) <= this.now())
            throw new ProviderError("policy_denied", false);
        }),
      // Settlement must survive initiating-session revocation; this closure retains canonical org.
      complete: (reservation, outcome) =>
        this.tx(authority.organizationId, (client) =>
          this.ledger.complete(
            client,
            authority.organizationId,
            reservation,
            outcome,
          ),
        ),
      cooldown: (id, delay) =>
        this.recordCooldown(authority.organizationId, id, delay),
      provider: (candidate) =>
        run(async (client) => {
          const row = await this.row(
            client,
            authority.organizationId,
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
