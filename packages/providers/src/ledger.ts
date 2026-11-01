import { createHash, randomUUID } from "node:crypto";
import { AuthError } from "@craftlayer/auth";
import {
  type BudgetLimits,
  budgetLimitsSchema,
  defaultBudgetLimits,
  type GenerateRequest,
  generateResultSchema,
  type ModelPolicy,
  pricingSchema,
} from "@craftlayer/contracts";
import type pg from "pg";
import { ProviderError } from "./index.js";
import { ceilingMicroUsd } from "./pricing.js";
import {
  type Candidate,
  type Outcome,
  type Reservation,
  RouterBlocked,
} from "./router.js";

export const budgetUnits = [
  "calls",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "micro_usd",
] as const;
type Unit = (typeof budgetUnits)[number];
export type Amounts = Record<Unit, bigint>;
export interface BudgetScope {
  kind: "organization" | "user" | "project" | "mission" | "task";
  id: string;
}
export interface LedgerContext {
  org: string;
  user: string;
  project: string;
  mission?: string | undefined;
  task?: string | undefined;
}
export interface BudgetConfiguration {
  instance: BudgetLimits;
  instance_paid_cap: string;
  policies: Record<string, ModelPolicy>;
}
type SqlRow = Record<string, unknown>;
interface LedgerRow extends SqlRow {
  id: string;
  organization_id: string;
  request_pk: string;
  state: string;
  input_max: string;
  output_max: string;
  tool_max: number;
  max_cost: string;
  window_start: Date;
  pricing: unknown;
  charged_input: string | null;
  charged_output: string | null;
  charged_cost: string | null;
  usage_quality: "observed" | "estimated" | "unknown" | null;
}
const maxBig = (a: bigint, b: bigint): bigint => {
  if (a > b) return a;
  return b;
};
const zero = (): Amounts => ({
  calls: 0n,
  input_tokens: 0n,
  output_tokens: 0n,
  total_tokens: 0n,
  micro_usd: 0n,
});
const json = (amounts: Amounts): Record<Unit, string> => ({
  calls: amounts.calls.toString(),
  input_tokens: amounts.input_tokens.toString(),
  output_tokens: amounts.output_tokens.toString(),
  total_tokens: amounts.total_tokens.toString(),
  micro_usd: amounts.micro_usd.toString(),
});
const vector = (row: SqlRow, prefix: string): Amounts =>
  Object.fromEntries(
    budgetUnits.map((unit) => [
      unit,
      BigInt(String(row[`${prefix}_${unit}`] ?? 0)),
    ]),
  ) as Amounts;
const add = (a: Amounts, b: Amounts): Amounts =>
  Object.fromEntries(
    budgetUnits.map((unit) => [unit, a[unit] + b[unit]]),
  ) as Amounts;
const negate = (a: Amounts): Amounts =>
  Object.fromEntries(budgetUnits.map((unit) => [unit, -a[unit]])) as Amounts;
const identity = (scope: BudgetScope) => `${scope.kind}/${scope.id}`;
export function budgetScopes(context: LedgerContext): BudgetScope[] {
  const scopes: BudgetScope[] = [
    { kind: "organization", id: context.org },
    { kind: "user", id: context.user },
    { kind: "project", id: context.project },
  ];
  if (context.mission) scopes.push({ kind: "mission", id: context.mission });
  if (context.task) scopes.push({ kind: "task", id: context.task });
  return scopes.sort((a, b) => identity(a).localeCompare(identity(b)));
}
export class BudgetLedger {
  constructor(private now: () => number = Date.now) {}
  window() {
    return new Date(Math.floor(this.now() / 3600000) * 3600000);
  }
  async lock(client: pg.PoolClient, org: string) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1,74618004))",
      [org],
    );
    await client.query(
      "select set_config('app.provider_budget','enabled',true)",
    );
  }
  async begin(
    client: pg.PoolClient,
    context: LedgerContext,
    request: GenerateRequest,
  ): Promise<boolean> {
    const hash = createHash("sha256")
      .update(JSON.stringify([context, request]))
      .digest("hex");
    const result = await client.query(
      "insert into provider_requests(id,organization_id,request_id,user_id,project_id,mission_id,task_id,input_hash) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(organization_id,request_id) do nothing returning id",
      [
        randomUUID(),
        context.org,
        request.request_id,
        context.user,
        context.project,
        context.mission ?? null,
        context.task ?? null,
        hash,
      ],
    );
    if (result.rowCount) return true;
    const previous = (
      await client.query<{ input_hash: string }>(
        "select input_hash from provider_requests where organization_id=$1 and request_id=$2",
        [context.org, request.request_id],
      )
    ).rows[0];
    if (previous?.input_hash !== hash)
      throw new AuthError(
        409,
        "REQUEST_ID_CONFLICT",
        "Request ID was already used with different input.",
      );
    return false;
  }
  private reserved(row: LedgerRow): Amounts {
    const input = BigInt(row.input_max),
      output = BigInt(row.output_max);
    return {
      calls: 1n,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      micro_usd: BigInt(row.max_cost),
    };
  }
  private async global(client: pg.PoolClient, window: Date) {
    await client.query(
      "insert into provider_instance_active(id) values(true) on conflict(id) do nothing",
    );
    const active = (
      await client.query<{ active_count: number }>(
        "select active_count from provider_instance_active where id=true for update",
      )
    ).rows[0];
    await client.query(
      "insert into provider_instance_windows(window_start) values($1) on conflict(window_start) do nothing",
      [window],
    );
    const row = (
      await client.query<SqlRow>(
        "select * from provider_instance_windows where window_start=$1 for update",
        [window],
      )
    ).rows[0];
    if (!active || !row) throw new Error("Budget state missing");
    return { active: active.active_count, row };
  }
  private async scopeState(
    client: pg.PoolClient,
    org: string,
    scope: BudgetScope,
    window: Date,
  ) {
    await client.query(
      "insert into provider_budget_limits(organization_id,scope_kind,scope_id,limits) values($1,$2,$3,$4::jsonb) on conflict(organization_id,scope_kind,scope_id) do nothing",
      [org, scope.kind, scope.id, JSON.stringify(defaultBudgetLimits)],
    );
    const settings = (
      await client.query<{ limits: unknown; active_count: number }>(
        "select limits,active_count from provider_budget_limits where organization_id=$1 and scope_kind=$2 and scope_id=$3 for update",
        [org, scope.kind, scope.id],
      )
    ).rows[0];
    await client.query(
      "insert into provider_budget_windows(organization_id,scope_kind,scope_id,window_start) values($1,$2,$3,$4) on conflict(organization_id,scope_kind,scope_id,window_start) do nothing",
      [org, scope.kind, scope.id, window],
    );
    const row = (
      await client.query<SqlRow>(
        "select * from provider_budget_windows where organization_id=$1 and scope_kind=$2 and scope_id=$3 and window_start=$4 for update",
        [org, scope.kind, scope.id, window],
      )
    ).rows[0];
    if (!settings || !row) throw new Error("Scope state missing");
    return {
      limits: budgetLimitsSchema.parse(settings.limits),
      active: settings.active_count,
      row,
    };
  }
  private assertFits(
    row: SqlRow,
    active: number,
    limits: BudgetLimits,
    amount: Amounts,
    increment: number,
    paidCap: string,
  ) {
    const total = add(
      add(vector(row, "used"), vector(row, "reserved")),
      amount,
    );
    for (const unit of budgetUnits) {
      const cap =
        unit === "micro_usd"
          ? BigInt(limits.micro_usd) < BigInt(paidCap)
            ? BigInt(limits.micro_usd)
            : BigInt(paidCap)
          : BigInt(limits[unit]);
      if (total[unit] > cap)
        throw new RouterBlocked([`budget_${unit}_exhausted`]);
    }
    if (active + increment > limits.concurrent)
      throw new RouterBlocked(["budget_concurrency_exhausted"]);
  }
  private async counters(
    client: pg.PoolClient,
    org: string,
    window: Date,
    scopes: BudgetScope[],
    reservedDelta: Amounts,
    usedDelta: Amounts,
    activeDelta: number,
  ) {
    const values = [
      ...budgetUnits.map((u) => reservedDelta[u].toString()),
      ...budgetUnits.map((u) => usedDelta[u].toString()),
    ];
    const setters = [
      ...budgetUnits.map(
        (u, i) => `reserved_${u}=reserved_${u}+$${i + 1}::numeric`,
      ),
      ...budgetUnits.map((u, i) => `used_${u}=used_${u}+$${i + 6}::numeric`),
    ].join(",");
    await client.query(
      `update provider_instance_windows set ${setters} where window_start=$11`,
      [...values, window],
    );
    await client.query(
      "update provider_instance_active set active_count=active_count+$1 where id=true",
      [activeDelta],
    );
    for (const scope of scopes) {
      await client.query(
        `update provider_budget_windows set ${setters} where organization_id=$11 and scope_kind=$12 and scope_id=$13 and window_start=$14`,
        [...values, org, scope.kind, scope.id, window],
      );
      await client.query(
        "update provider_budget_limits set active_count=active_count+$4 where organization_id=$1 and scope_kind=$2 and scope_id=$3",
        [org, scope.kind, scope.id, activeDelta],
      );
    }
  }
  private async event(
    client: pg.PoolClient,
    org: string,
    id: string,
    event: string,
    quality: string,
    reservedDelta: Amounts,
    usedDelta: Amounts,
    receipt: string | null = null,
  ) {
    await client.query(
      "insert into usage_ledger(organization_id,reservation_id,event,usage_quality,spend_quality,reserved_delta,used_delta,receipt_hash) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",
      [
        org,
        id,
        event,
        quality,
        quality === "unknown" ? "unknown" : "estimated",
        JSON.stringify(json(reservedDelta)),
        JSON.stringify(json(usedDelta)),
        receipt,
      ],
    );
  }
  private policyCap(
    config: BudgetConfiguration,
    org: string,
    scope: BudgetScope,
  ) {
    const policy =
      config.policies[identity(scope)] ??
      config.policies[`organization/${org}`];
    return policy?.free_only ? "0" : (policy?.max_paid_micro_usd ?? "0");
  }
  async reserve(
    client: pg.PoolClient,
    context: LedgerContext,
    request: GenerateRequest,
    candidate: Candidate,
    attempt: number,
    epoch: string,
    cost: bigint,
    config: BudgetConfiguration,
  ): Promise<Reservation> {
    await this.lock(client, context.org);
    const window = this.window(),
      scopes = budgetScopes(context),
      global = await this.global(client, window);
    const amount: Amounts = {
      calls: 1n,
      input_tokens: BigInt(request.max_input_tokens),
      output_tokens: BigInt(request.max_output_tokens),
      total_tokens: BigInt(
        request.max_input_tokens + request.max_output_tokens,
      ),
      micro_usd: cost,
    };
    this.assertFits(
      global.row,
      global.active,
      config.instance,
      amount,
      1,
      config.instance_paid_cap,
    );
    for (const scope of scopes) {
      const state = await this.scopeState(client, context.org, scope, window);
      this.assertFits(
        state.row,
        state.active,
        state.limits,
        amount,
        1,
        this.policyCap(config, context.org, scope),
      );
    }
    const operation = (
      await client.query<{ id: string }>(
        "select id from provider_requests where organization_id=$1 and request_id=$2 and user_id=$3 and project_id=$4 for update",
        [context.org, request.request_id, context.user, context.project],
      )
    ).rows[0];
    if (!operation) throw new RouterBlocked(["request_not_claimed"]);
    const id = randomUUID();
    await client.query(
      "insert into usage_reservations(id,organization_id,request_pk,attempt,connection_id,connection_version,model_id,pricing,policy_epoch,window_start,input_max,output_max,tool_max,max_cost) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)",
      [
        id,
        context.org,
        operation.id,
        attempt,
        candidate.connection_id,
        candidate.version,
        candidate.model.id,
        JSON.stringify(candidate.model.pricing),
        epoch,
        window,
        request.max_input_tokens,
        request.max_output_tokens,
        request.tools.length ? 16 : 0,
        cost.toString(),
      ],
    );
    for (const scope of scopes)
      await client.query(
        "insert into reservation_budget_links(organization_id,reservation_id,scope_kind,scope_id,window_start) values($1,$2,$3,$4,$5)",
        [context.org, id, scope.kind, scope.id, window],
      );
    await this.counters(client, context.org, window, scopes, amount, zero(), 1);
    await this.event(
      client,
      context.org,
      id,
      "reserve",
      "estimated",
      amount,
      zero(),
    );
    return { id };
  }
  private async row(
    client: pg.PoolClient,
    org: string,
    id: string,
  ): Promise<LedgerRow> {
    const row = (
      await client.query<LedgerRow>(
        "select * from usage_reservations where organization_id=$1 and id=$2 for update",
        [org, id],
      )
    ).rows[0];
    if (!row) throw new AuthError(404, "NOT_FOUND", "Reservation not found.");
    return row;
  }
  private async links(
    client: pg.PoolClient,
    org: string,
    id: string,
  ): Promise<BudgetScope[]> {
    return (
      await client.query<{ scope_kind: BudgetScope["kind"]; scope_id: string }>(
        "select scope_kind,scope_id from reservation_budget_links where organization_id=$1 and reservation_id=$2 order by scope_kind,scope_id",
        [org, id],
      )
    ).rows.map((r) => ({ kind: r.scope_kind, id: r.scope_id }));
  }
  async dispatch(
    client: pg.PoolClient,
    context: LedgerContext,
    reservation: Reservation,
    epoch: string,
    config: BudgetConfiguration,
  ) {
    await this.lock(client, context.org);
    const row = await this.row(client, context.org, reservation.id);
    if (
      row.state !== "reserved" ||
      row.policy_epoch !== epoch ||
      row.window_start.getTime() !== this.window().getTime()
    )
      throw new RouterBlocked(["reservation_changed"]);
    const global = await this.global(client, row.window_start),
      scopes = await this.links(client, context.org, row.id);
    this.assertFits(
      global.row,
      global.active,
      config.instance,
      zero(),
      0,
      config.instance_paid_cap,
    );
    for (const scope of scopes) {
      const state = await this.scopeState(
        client,
        context.org,
        scope,
        row.window_start,
      );
      this.assertFits(
        state.row,
        state.active,
        state.limits,
        zero(),
        0,
        this.policyCap(config, context.org, scope),
      );
    }
    await client.query(
      "update usage_reservations set state='dispatched',updated_at=now() where organization_id=$1 and id=$2",
      [context.org, row.id],
    );
    await this.event(
      client,
      context.org,
      row.id,
      "dispatch",
      "estimated",
      zero(),
      zero(),
    );
  }
  private actual(
    row: LedgerRow,
    outcome: Extract<Outcome, { result: unknown }>,
  ): Amounts {
    const usage = outcome.result.usage,
      base = this.reserved(row),
      input =
        usage.quality === "observed"
          ? BigInt(usage.input_tokens ?? 0)
          : BigInt(usage.input_tokens ?? row.input_max) > base.input_tokens
            ? BigInt(usage.input_tokens ?? 0)
            : base.input_tokens,
      output =
        usage.quality === "observed"
          ? BigInt(usage.output_tokens ?? 0)
          : BigInt(usage.output_tokens ?? row.output_max) > base.output_tokens
            ? BigInt(usage.output_tokens ?? 0)
            : base.output_tokens;
    return this.forCounts(row, input, output);
  }
  private forCounts(row: LedgerRow, input: bigint, output: bigint): Amounts {
    const base = this.reserved(row);
    const pricing = pricingSchema.parse(row.pricing),
      units = {
        input,
        output,
        cache_read: input,
        cache_write: input,
        request: 1n,
        image: 0n,
        audio: 0n,
        reasoning: output,
        tool: BigInt(row.tool_max),
      };
    let bound = 0n;
    for (const key of Object.keys(units) as Array<keyof typeof units>) {
      const p = pricing.dimensions[key];
      if (!p) throw new Error("Missing reserved pricing");
      bound += ceilingMicroUsd(p.amount, 1n) * units[key];
    }
    return {
      calls: 1n,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      micro_usd: bound > base.micro_usd ? bound : base.micro_usd,
    };
  }
  private async aggregate(client: pg.PoolClient, org: string, request: string) {
    await client.query(
      "update provider_requests set state=case when exists(select 1 from usage_reservations where organization_id=$1 and request_pk=$2 and state='uncertain') then 'uncertain' when exists(select 1 from usage_reservations where organization_id=$1 and request_pk=$2 and state in ('reserved','dispatched')) then 'claimed' when exists(select 1 from usage_reservations where organization_id=$1 and request_pk=$2 and state='settled') then 'complete' else 'blocked' end where organization_id=$1 and id=$2",
      [org, request],
    );
  }
  async complete(
    client: pg.PoolClient,
    org: string,
    reservation: Reservation,
    outcome: Outcome,
    receipt: string | null = null,
  ) {
    if ("result" in outcome) generateResultSchema.parse(outcome.result);
    await this.lock(client, org);
    const row = await this.row(client, org, reservation.id),
      scopes = await this.links(client, org, row.id);
    await this.global(client, row.window_start);
    for (const scope of scopes)
      await this.scopeState(client, org, scope, row.window_start);
    const reserved = this.reserved(row);
    if (row.state === "released") return;
    if (row.state === "settled") {
      if ("result" in outcome) {
        const actual = this.actual(row, outcome),
          previous: Amounts = {
            calls: 1n,
            input_tokens: BigInt(row.charged_input ?? 0),
            output_tokens: BigInt(row.charged_output ?? 0),
            total_tokens:
              BigInt(row.charged_input ?? 0) + BigInt(row.charged_output ?? 0),
            micro_usd: BigInt(row.charged_cost ?? 0),
          };
        const nextInput = maxBig(actual.input_tokens, previous.input_tokens),
          nextOutput = maxBig(actual.output_tokens, previous.output_tokens);
        const corrected = this.forCounts(row, nextInput, nextOutput);
        const delta = Object.fromEntries(
          budgetUnits.map((u) => [
            u,
            corrected[u] > previous[u] ? corrected[u] - previous[u] : 0n,
          ]),
        ) as Amounts;
        if (budgetUnits.some((u) => delta[u] > 0n)) {
          await this.counters(
            client,
            org,
            row.window_start,
            scopes,
            zero(),
            delta,
            0,
          );
          await this.event(
            client,
            org,
            row.id,
            "adjust",
            "observed",
            zero(),
            delta,
          );
          if (
            previous.input_tokens + delta.input_tokens >
              reserved.input_tokens ||
            previous.output_tokens + delta.output_tokens >
              reserved.output_tokens ||
            previous.micro_usd + delta.micro_usd > reserved.micro_usd
          )
            await client.query(
              "insert into provider_routing_state(organization_id,stopped) values($1,true) on conflict(organization_id) do update set stopped=true,version=provider_routing_state.version+1",
              [org],
            );
          await client.query(
            "update usage_reservations set charged_input=$3,charged_output=$4,charged_cost=$5 where organization_id=$1 and id=$2",
            [
              org,
              row.id,
              (previous.input_tokens + delta.input_tokens).toString(),
              (previous.output_tokens + delta.output_tokens).toString(),
              (previous.micro_usd + delta.micro_usd).toString(),
            ],
          );
        }
      }
      return;
    }
    if ("error" in outcome) {
      if (row.state === "reserved" && !outcome.dispatched) {
        await this.counters(
          client,
          org,
          row.window_start,
          scopes,
          negate(reserved),
          zero(),
          -1,
        );
        await client.query(
          "update usage_reservations set state='released',updated_at=now() where organization_id=$1 and id=$2",
          [org, row.id],
        );
        await this.event(
          client,
          org,
          row.id,
          "release",
          "estimated",
          negate(reserved),
          zero(),
          receipt,
        );
      } else if (row.state !== "uncertain") {
        await client.query(
          "update usage_reservations set state='uncertain',usage_quality='unknown',updated_at=now() where organization_id=$1 and id=$2",
          [org, row.id],
        );
        await this.event(
          client,
          org,
          row.id,
          "uncertain",
          "unknown",
          zero(),
          zero(),
        );
      }
    } else {
      const actual = this.actual(row, outcome),
        quality =
          outcome.result.usage.quality === "observed"
            ? "observed"
            : "estimated";
      await this.counters(
        client,
        org,
        row.window_start,
        scopes,
        negate(reserved),
        actual,
        -1,
      );
      await client.query(
        "update usage_reservations set state='settled',charged_input=$3,charged_output=$4,charged_cost=$5,usage_quality=$6,provider_request_id=$7,updated_at=now() where organization_id=$1 and id=$2",
        [
          org,
          row.id,
          actual.input_tokens.toString(),
          actual.output_tokens.toString(),
          actual.micro_usd.toString(),
          quality,
          outcome.result.provider_request_id,
        ],
      );
      await this.event(
        client,
        org,
        row.id,
        receipt ? "reconcile" : "settle",
        quality,
        negate(reserved),
        actual,
        receipt,
      );
      if (
        actual.input_tokens > reserved.input_tokens ||
        actual.output_tokens > reserved.output_tokens ||
        actual.micro_usd > reserved.micro_usd
      ) {
        await client.query(
          "insert into provider_routing_state(organization_id,stopped) values($1,true) on conflict(organization_id) do update set stopped=true,version=provider_routing_state.version+1",
          [org],
        );
        await client.query(
          "insert into audit_events(organization_id,action,target_id,outcome) values($1,'provider.usage_overrun_stopped',$2,'allowed')",
          [org, row.id],
        );
      }
    }
    await this.aggregate(client, org, row.request_pk);
  }
  async reconcile(
    client: pg.PoolClient,
    org: string,
    id: string,
    receipt: string,
  ) {
    await this.lock(client, org);
    const row = await this.row(client, org, id);
    if (row.state === "reserved") {
      await this.complete(
        client,
        org,
        { id },
        { error: new ProviderError("policy_denied", false), dispatched: false },
        receipt,
      );
      return;
    }
    if (row.state === "dispatched") {
      await client.query(
        "update usage_reservations set state='uncertain',usage_quality='unknown' where organization_id=$1 and id=$2",
        [org, id],
      );
      await this.event(
        client,
        org,
        id,
        "uncertain",
        "unknown",
        zero(),
        zero(),
        receipt,
      );
    } else if (row.state !== "uncertain")
      throw new AuthError(
        409,
        "RESERVATION_NOT_RECOVERABLE",
        "Only pending or uncertain reservations can be acknowledged.",
      );
    await this.complete(
      client,
      org,
      { id },
      {
        result: {
          text: "",
          latency_ms: null,
          tool_calls: [],
          finish_reason: "stop",
          usage: {
            quality: "estimated",
            input_tokens: null,
            output_tokens: null,
          },
          provider_request_id: null,
        },
        dispatched: true,
      },
      receipt,
    );
  }
  async getLimits(client: pg.PoolClient, org: string, scope: BudgetScope) {
    const row = (
      await client.query<{
        version: number;
        limits: unknown;
        active_count: number;
      }>(
        "select version,limits,active_count from provider_budget_limits where organization_id=$1 and scope_kind=$2 and scope_id=$3",
        [org, scope.kind, scope.id],
      )
    ).rows[0];
    const counter =
      (
        await client.query<SqlRow>(
          "select * from provider_budget_windows where organization_id=$1 and scope_kind=$2 and scope_id=$3 and window_start=$4",
          [org, scope.kind, scope.id, this.window()],
        )
      ).rows[0] ?? {};
    return {
      version: row?.version ?? 0,
      limits: budgetLimitsSchema.parse(row?.limits ?? defaultBudgetLimits),
      active: row?.active_count ?? 0,
      window_start: this.window().toISOString(),
      reserved: json(vector(counter, "reserved")),
      used: json(vector(counter, "used")),
    };
  }
  async setLimits(
    client: pg.PoolClient,
    org: string,
    scope: BudgetScope,
    version: number,
    input: BudgetLimits,
  ) {
    await this.lock(client, org);
    const limits = budgetLimitsSchema.parse(input),
      row = (
        await client.query<{ version: number }>(
          "select version from provider_budget_limits where organization_id=$1 and scope_kind=$2 and scope_id=$3 for update",
          [org, scope.kind, scope.id],
        )
      ).rows[0];
    if ((row?.version ?? 0) !== version)
      throw new AuthError(
        409,
        "PROVIDER_VERSION_CONFLICT",
        "Refresh budget and try again.",
      );
    await client.query(
      "insert into provider_budget_limits(organization_id,scope_kind,scope_id,version,limits) values($1,$2,$3,1,$4::jsonb) on conflict(organization_id,scope_kind,scope_id) do update set version=provider_budget_limits.version+1,limits=excluded.limits",
      [org, scope.kind, scope.id, JSON.stringify(limits)],
    );
    await client.query(
      "insert into provider_routing_state(organization_id) values($1) on conflict(organization_id) do update set version=provider_routing_state.version+1",
      [org],
    );
    return this.getLimits(client, org, scope);
  }
}
