import { randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  deploymentIntentAccepted,
  deploymentIntentRequest,
  deploymentIntentView,
  nodeCapacity,
  qualifiedReservationAdmission,
  reservationReceipt,
  reservationRequest,
  reservationView,
} from "@craftlayer/contracts";
import { type Authority, canAccess } from "@craftlayer/core";
import { nodeDigest } from "@craftlayer/node-protocol";
import pg from "pg";
import { z } from "zod";

export interface ReservationAdmissionContext {
  phase: "reserve" | "dispatch";
  request_hash: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  node_id: string;
  actor_id: string;
  node_version: number;
  credential_version: number;
  plan_hash: string;
  template_id: string;
}
/** Private port must verify full host/template/recovery policy; no production adapter exists yet. */
export interface ReservationAdmission {
  inspect(
    context: ReservationAdmissionContext,
    signal: AbortSignal,
  ): Promise<unknown>;
}
interface NodeRow {
  id: string;
  project_id: string;
  state: string;
  version: number;
  credential_version: number;
  credential_expires_at: Date;
  last_seen_at: Date | null;
  capacity: unknown;
}
interface Row {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  node_id: string;
  deployment_id: string;
  server_id: string;
  world_id: string;
  actor_id: string;
  session_id: string;
  name: string;
  template_id: string;
  plan_hash: string;
  template_hash: string;
  policy_hash: string;
  node_version: number;
  credential_version: number;
  cpu_milli: number;
  memory_mb: number;
  disk_mb: number;
  java_port: number;
  bedrock_port: number;
  state: "held" | "allocated" | "uncertain" | "released";
  version: number;
  lease_expires_at: Date;
  created_at: Date;
}
function deny(code: string, status = 409): never {
  throw new AuthError(
    status,
    code,
    "Reservation denied; verify current scope, host qualification and capacity.",
  );
}
export class ReservationLedger {
  #pool: pg.Pool;
  #now: () => number;
  constructor(
    private readonly options: {
      databaseUrl: string;
      auth: IdentityService;
      admission?: ReservationAdmission;
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
    this.#now = options.clock ?? Date.now;
  }
  close() {
    return this.#pool.end();
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
      const value = await fn(c);
      await c.query("commit");
      return value;
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  async #node(c: pg.PoolClient, org: string, id: string) {
    const row = (
      await c.query<NodeRow>(
        "select n.*,k.expires_at credential_expires_at from minecraft_nodes n join minecraft_node_credentials k on (k.organization_id,k.node_id,k.version)=(n.organization_id,n.id,n.credential_version) where n.organization_id=$1 and n.id=$2 for update of n",
        [org, id],
      )
    ).rows[0];
    if (!row) deny("NOT_FOUND", 404);
    return row;
  }
  async #locate(
    token: string,
    org: string,
    table: "minecraft_nodes" | "minecraft_reservations",
    id: string,
  ) {
    return this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const row = (
            await c.query<{
              project_id: string;
              node_id?: string;
              environment_id?: string;
            }>(`select * from ${table} where organization_id=$1 and id=$2`, [
              org,
              z.uuid().parse(id),
            ])
          ).rows[0];
          if (!row) deny("NOT_FOUND", 404);
          return row;
        }),
    );
  }
  #scope<T>(
    token: string,
    org: string,
    project: string,
    node: string,
    environment: string,
    fn: (
      c: pg.PoolClient,
      p: Principal,
      a: Authority,
      n: NodeRow,
    ) => Promise<T>,
  ) {
    return this.options.auth.guardResource(
      token,
      org,
      "node:deploy",
      { kind: "project", id: project },
      (p, a) =>
        this.#tx(org, async (c) => {
          const e = (
            await c.query<{ project_id: string; type: string }>(
              "select project_id,type from environments where organization_id=$1 and id=$2",
              [org, environment],
            )
          ).rows[0];
          if (!e) deny("NOT_FOUND", 404);
          if (
            p.user.account_type !== "adult" ||
            e.project_id !== project ||
            e.type !== "minecraft" ||
            !canAccess(a, "server:provision", {
              kind: "environment",
              id: environment,
              projectId: project,
              environmentType: e.type,
            })
          )
            deny("RESERVATION_SCOPE_DENIED", 403);
          const n = await this.#node(c, org, node);
          if (n.project_id !== project) deny("RESERVATION_SCOPE_DENIED", 403);
          return fn(c, p, a, n);
        }),
    );
  }
  async #row(c: pg.PoolClient, org: string, id: string) {
    const r = (
      await c.query<Row>(
        "select * from minecraft_reservations where organization_id=$1 and id=$2 for update",
        [org, id],
      )
    ).rows[0];
    if (!r) deny("NOT_FOUND", 404);
    return r;
  }
  #context(
    phase: "reserve" | "dispatch",
    org: string,
    environment: string,
    n: NodeRow,
    p: Principal,
    a: Authority,
    input: unknown,
    plan: string,
    template: string,
  ): ReservationAdmissionContext {
    const binding = {
      phase,
      organization_id: org,
      project_id: n.project_id,
      environment_id: environment,
      node_id: n.id,
      actor_id: p.user.id,
      node_version: n.version,
      credential_version: n.credential_version,
      plan_hash: plan,
      template_id: template,
    };
    return {
      ...binding,
      request_hash: nodeDigest({
        ...binding,
        input,
        session_id: p.sessionId,
        user_version: p.userVersion,
        authority: {
          ...a,
          permissions: [...a.permissions].sort(),
          roles: [...a.roles].sort(),
          grants: [...a.grants].sort((x, y) =>
            nodeDigest(x).localeCompare(nodeDigest(y)),
          ),
        },
      }),
    };
  }
  async #inspect(context: ReservationAdmissionContext) {
    if (!this.options.admission) deny("RESERVATION_UNQUALIFIED", 503);
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return qualifiedReservationAdmission.parse(
        await Promise.race([
          this.options.admission.inspect(context, abort.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(new Error("RESERVATION_ADMISSION_TIMEOUT"));
            }, 5000);
          }),
        ]),
      );
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
  }
  async #stopped(c: pg.PoolClient, org: string, environment: string) {
    await c.query("select set_config('app.runtime_internal','enabled',true)");
    try {
      if (
        (
          await c.query(
            "select 1 from runtime_stop_latches where latched and (kind='instance' or (kind='organization' and scope_id=$1) or (kind='environment' and scope_id=$2)) limit 1",
            [org, environment],
          )
        ).rowCount
      )
        deny("STOP_LATCHED", 403);
    } finally {
      await c.query(
        "select set_config('app.runtime_internal','disabled',true)",
      );
    }
  }
  #qualified(
    e: z.infer<typeof qualifiedReservationAdmission>,
    context: ReservationAdmissionContext,
    n: NodeRow,
  ) {
    const now = this.#now(),
      capacity = nodeCapacity.safeParse(n.capacity);
    if (
      e.request_hash !== context.request_hash ||
      Date.parse(e.issued_at) > now ||
      Date.parse(e.expires_at) <= now ||
      Date.parse(e.expires_at) - Date.parse(e.issued_at) > 10000 ||
      n.state !== "active" ||
      n.credential_expires_at.getTime() <= now ||
      !n.last_seen_at ||
      n.last_seen_at.getTime() < now - 30000 ||
      n.last_seen_at.getTime() > now + 5000 ||
      !capacity.success ||
      Date.parse(capacity.data.observed_at) < now - 30000 ||
      Date.parse(capacity.data.observed_at) > now ||
      capacity.data.unbounded_containers !== 0 ||
      e.cpu_budget_milli > capacity.data.cpu_count * 1000 ||
      e.memory_budget_mb > capacity.data.memory_total_mb - 2048
    )
      deny("RESERVATION_EVIDENCE_STALE");
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
    const row = (
      await c.query<{
        id: string;
        reservation_id: string;
        request_hash: string;
        deployment_id: string;
      }>(
        "select o.*,r.deployment_id from minecraft_reservation_operations o join minecraft_reservations r on (r.organization_id,r.id)=(o.organization_id,o.reservation_id) where o.organization_id=$1 and o.actor_id=$2 and o.kind=$3 and o.request_key=$4",
        [org, actor, kind, key],
      )
    ).rows[0];
    if (row && row.request_hash !== nodeDigest(input))
      deny("IDEMPOTENCY_CONFLICT");
    return row
      ? reservationReceipt.parse({
          operation_id: row.id,
          reservation_id: row.reservation_id,
          deployment_id: row.deployment_id,
        })
      : null;
  }
  async #event(
    c: pg.PoolClient,
    r: Row,
    p: Principal | null,
    kind: "reserve" | "release" | "expire" | "dispatch" | "uncertain",
    key: string,
    input: unknown,
  ) {
    const id = randomUUID(),
      now = new Date(this.#now());
    await c.query(
      "insert into minecraft_reservation_operations(id,organization_id,project_id,environment_id,node_id,reservation_id,actor_id,session_id,kind,request_key,request_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        id,
        r.organization_id,
        r.project_id,
        r.environment_id,
        r.node_id,
        r.id,
        p?.user.id ?? null,
        p?.sessionId ?? null,
        kind,
        key,
        nodeDigest(input),
        now,
      ],
    );
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        r.organization_id,
        p?.user.id ?? null,
        `node.reservation_${kind}`,
        r.id,
        { operation_id: id, source: "reservation_ledger" },
      ],
    );
    await c.query(
      "insert into minecraft_reservation_outbox(id,organization_id,operation_id,schema_version,created_at) values($1,$2,$3,1,$4)",
      [randomUUID(), r.organization_id, id, now],
    );
    return reservationReceipt.parse({
      operation_id: id,
      reservation_id: r.id,
      deployment_id: r.deployment_id,
    });
  }
  async #expire(c: pg.PoolClient, org: string, node: string) {
    const expired = (
      await c.query<Row>(
        "update minecraft_reservations set state='released',version=version+1 where organization_id=$1 and node_id=$2 and state='held' and lease_expires_at<=$3 returning *",
        [org, node, new Date(this.#now())],
      )
    ).rows;
    for (const r of expired) {
      await c.query(
        "delete from minecraft_reservation_ports where organization_id=$1 and reservation_id=$2",
        [org, r.id],
      );
      await this.#event(c, r, null, "expire", randomUUID(), {
        reservation_id: r.id,
        lease_expires_at: r.lease_expires_at.toISOString(),
      });
    }
  }
  async #usage(c: pg.PoolClient, org: string, node: string) {
    const used = (
      await c.query<{
        cpu: number;
        memory: number;
        disk: number;
        count: number;
      }>(
        "select coalesce(sum(cpu_milli),0)::bigint::float8 cpu,coalesce(sum(memory_mb),0)::bigint::float8 memory,coalesce(sum(disk_mb),0)::bigint::float8 disk,count(*)::int count from minecraft_reservations where organization_id=$1 and node_id=$2 and state<>'released'",
        [org, node],
      )
    ).rows[0];
    if (!used) deny("RESERVATION_CAPACITY_CONFLICT");
    return used;
  }
  async #admit(c: pg.PoolClient, org: string, project: string, actor: string) {
    const limits = (
      await c.query<{ daily: number; recent: number }>(
        "select count(*) filter(where created_at>$4)::int daily,count(*) filter(where actor_id=$3 and created_at>$5)::int recent from minecraft_reservation_operations where organization_id=$1 and project_id=$2 and kind='reserve' and created_at>$4",
        [
          org,
          project,
          actor,
          new Date(this.#now() - 86400000),
          new Date(this.#now() - 60000),
        ],
      )
    ).rows[0];
    if (!limits || limits.daily >= 10000 || limits.recent >= 12)
      deny("RESERVATION_LIMIT", 429);
  }
  async reserve(token: string, org: string, input: unknown, key: string) {
    const v = reservationRequest.parse(input),
      located = await this.#locate(token, org, "minecraft_nodes", v.node_id);
    const prepare = await this.#scope(
      token,
      org,
      located.project_id,
      v.node_id,
      v.environment_id,
      async (c, p, a, n) => {
        await this.#stopped(c, org, v.environment_id);
        const replay = await this.#replay(c, org, p.user.id, "reserve", key, v);
        return {
          replay,
          context: this.#context(
            "reserve",
            org,
            v.environment_id,
            n,
            p,
            a,
            v,
            v.plan_hash,
            v.template_id,
          ),
        };
      },
    );
    if (prepare.replay) return prepare.replay;
    const evidence = await this.#inspect(prepare.context);
    return this.#scope(
      token,
      org,
      located.project_id,
      v.node_id,
      v.environment_id,
      async (c, p, a, n) => {
        await this.#stopped(c, org, v.environment_id);
        const replay = await this.#replay(c, org, p.user.id, "reserve", key, v);
        if (replay) return replay;
        this.#qualified(
          evidence,
          this.#context(
            "reserve",
            org,
            v.environment_id,
            n,
            p,
            a,
            v,
            v.plan_hash,
            v.template_id,
          ),
          n,
        );
        await this.#expire(c, org, n.id);
        await this.#admit(c, org, n.project_id, p.user.id);
        const used = await this.#usage(c, org, n.id);
        if (
          !used ||
          used.count >= 100 ||
          used.cpu + 2000 > evidence.cpu_budget_milli ||
          used.memory + 6144 > evidence.memory_budget_mb ||
          used.disk + 20480 > evidence.disk_budget_mb
        )
          deny("RESERVATION_CAPACITY_CONFLICT");
        for (const port of [
          { protocol: "tcp", port: v.java_port },
          { protocol: "udp", port: v.bedrock_port },
        ])
          if (
            [
              ...evidence.occupied_ports,
              ...nodeCapacity.parse(n.capacity).occupied_ports,
            ].some(
              (b) => b.protocol === port.protocol && b.port === port.port,
            ) ||
            (
              await c.query(
                "select 1 from minecraft_reservation_ports where organization_id=$1 and node_id=$2 and protocol=$3 and port=$4",
                [org, n.id, port.protocol, port.port],
              )
            ).rowCount
          )
            deny("RESERVATION_PORT_CONFLICT");
        const id = randomUUID(),
          now = this.#now();
        this.#qualified(
          evidence,
          this.#context(
            "reserve",
            org,
            v.environment_id,
            n,
            p,
            a,
            v,
            v.plan_hash,
            v.template_id,
          ),
          n,
        );
        await this.#stopped(c, org, v.environment_id);
        const row = (
          await c.query<Row>(
            "insert into minecraft_reservations(id,organization_id,project_id,environment_id,node_id,deployment_id,server_id,world_id,actor_id,session_id,name,template_id,plan_hash,template_hash,policy_hash,admission_hash,node_version,credential_version,cpu_milli,memory_mb,disk_mb,java_port,bedrock_port,state,created_at,lease_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,2000,6144,20480,$19,$20,'held',$21,$22) returning *",
            [
              id,
              org,
              n.project_id,
              v.environment_id,
              n.id,
              randomUUID(),
              randomUUID(),
              randomUUID(),
              p.user.id,
              p.sessionId,
              v.name,
              v.template_id,
              v.plan_hash,
              evidence.template_hash,
              evidence.policy_hash,
              nodeDigest(evidence),
              n.version,
              n.credential_version,
              v.java_port,
              v.bedrock_port,
              new Date(now),
              new Date(now + 60000),
            ],
          )
        ).rows[0];
        if (!row) deny("RESERVATION_INSERT_FAILED");
        await c.query(
          "insert into minecraft_reservation_ports(organization_id,node_id,reservation_id,protocol,port) values($1,$2,$3,'tcp',$4),($1,$2,$3,'udp',$5)",
          [org, n.id, id, v.java_port, v.bedrock_port],
        );
        return this.#event(c, row, p, "reserve", key, v);
      },
    );
  }
  async get(token: string, org: string, id: string) {
    const r = await this.#locate(token, org, "minecraft_reservations", id);
    if (!r.node_id || !r.environment_id) deny("NOT_FOUND", 404);
    return this.#scope(
      token,
      org,
      r.project_id,
      r.node_id,
      r.environment_id,
      async (c) => {
        const row = await this.#row(c, org, id);
        return reservationView.parse({
          ...Object.fromEntries(
            Object.keys(reservationView.shape).map((key) => [
              key,
              row[key as keyof Row],
            ]),
          ),
          created_at: row.created_at.toISOString(),
          lease_expires_at: row.lease_expires_at.toISOString(),
        });
      },
    );
  }
  async change(
    token: string,
    org: string,
    id: string,
    kind: "release" | "dispatch" | "uncertain",
    version: number,
    key: string,
  ) {
    z.number().int().positive().parse(version);
    const located = await this.#locate(
      token,
      org,
      "minecraft_reservations",
      id,
    );
    if (!located.node_id || !located.environment_id) deny("NOT_FOUND", 404);
    const node = located.node_id,
      environment = located.environment_id,
      input = { id, kind, version };
    const scope = <T>(
      fn: (
        c: pg.PoolClient,
        p: Principal,
        a: Authority,
        n: NodeRow,
      ) => Promise<T>,
    ) => this.#scope(token, org, located.project_id, node, environment, fn);
    const prepared = await scope(async (c, p, a, n) => {
      const row = await this.#row(c, org, id);
      return {
        row,
        replay: await this.#replay(c, org, p.user.id, kind, key, input),
        context: this.#context(
          "dispatch",
          org,
          environment,
          n,
          p,
          a,
          { ...input, reservation: row.id },
          row.plan_hash,
          row.template_id,
        ),
      };
    });
    if (prepared.replay) return prepared.replay;
    const evidence =
      kind === "dispatch" ? await this.#inspect(prepared.context) : null;
    return scope(async (c, p, a, n) => {
      const replay = await this.#replay(c, org, p.user.id, kind, key, input);
      if (replay) return replay;
      const row = await this.#row(c, org, id);
      if (row.version !== version) deny("RESERVATION_VERSION_CONFLICT");
      if (kind === "release" && row.state !== "held")
        deny("RESERVATION_RECONCILIATION_REQUIRED");
      if (kind === "dispatch") {
        await this.#stopped(c, org, environment);
        if (
          row.state !== "held" ||
          row.lease_expires_at.getTime() <= this.#now() ||
          row.node_version !== n.version ||
          row.credential_version !== n.credential_version ||
          !evidence
        )
          deny("RESERVATION_DISPATCH_DENIED");
        this.#qualified(
          evidence,
          this.#context(
            "dispatch",
            org,
            environment,
            n,
            p,
            a,
            { ...input, reservation: row.id },
            row.plan_hash,
            row.template_id,
          ),
          n,
        );
        await this.#expire(c, org, n.id);
        const usage = await this.#usage(c, org, n.id);
        if (
          usage.cpu > evidence.cpu_budget_milli ||
          usage.memory > evidence.memory_budget_mb ||
          usage.disk > evidence.disk_budget_mb
        )
          deny("RESERVATION_CAPACITY_CONFLICT");
        if (
          !evidence.independent_approval_hash ||
          evidence.policy_hash !== row.policy_hash ||
          evidence.template_hash !== row.template_hash
        )
          deny("RESERVATION_APPROVAL_REQUIRED");
        for (const port of [
          { protocol: "tcp", port: row.java_port },
          { protocol: "udp", port: row.bedrock_port },
        ])
          if (
            [
              ...evidence.occupied_ports,
              ...nodeCapacity.parse(n.capacity).occupied_ports,
            ].some((b) => b.protocol === port.protocol && b.port === port.port)
          )
            deny("RESERVATION_PORT_CONFLICT");
        this.#qualified(
          evidence,
          this.#context(
            "dispatch",
            org,
            environment,
            n,
            p,
            a,
            { ...input, reservation: row.id },
            row.plan_hash,
            row.template_id,
          ),
          n,
        );
        if (row.lease_expires_at.getTime() <= this.#now())
          deny("RESERVATION_DISPATCH_DENIED");
        await this.#stopped(c, org, environment);
      }
      if (kind === "uncertain" && row.state !== "allocated")
        deny("RESERVATION_TRANSITION_DENIED");
      const state =
        kind === "dispatch"
          ? "allocated"
          : kind === "release"
            ? "released"
            : "uncertain";
      await c.query(
        "update minecraft_reservations set state=$3,version=version+1 where organization_id=$1 and id=$2",
        [org, id, state],
      );
      if (kind === "release")
        await c.query(
          "delete from minecraft_reservation_ports where organization_id=$1 and reservation_id=$2",
          [org, id],
        );
      return this.#event(c, row, p, kind, key, input);
    });
  }
  /** Durable metadata intake only. No signer, queue publisher or native dispatch is attached. */
  async queueDeployment(
    token: string,
    org: string,
    input: unknown,
    key: string,
  ) {
    const v = deploymentIntentRequest.parse(input);
    z.uuid().parse(key);
    const located = await this.#locate(
      token,
      org,
      "minecraft_reservations",
      v.reservation_id,
    );
    if (!located.node_id || !located.environment_id) deny("NOT_FOUND", 404);
    return this.#scope(
      token,
      org,
      located.project_id,
      located.node_id,
      located.environment_id,
      async (c, p, _a, n) => {
        await this.#stopped(c, org, located.environment_id as string);
        const row = await this.#row(c, org, v.reservation_id),
          requestHash = nodeDigest(v);
        const old = (
          await c.query<{
            id: string;
            request_hash: string;
            reservation_id: string;
          }>(
            "select id,request_hash,reservation_id from minecraft_deployment_intents where organization_id=$1 and actor_id=$2 and request_key=$3",
            [org, p.user.id, key],
          )
        ).rows[0];
        if (
          old &&
          (old.request_hash !== requestHash || old.reservation_id !== row.id)
        )
          deny("IDEMPOTENCY_CONFLICT");
        // The intake preserves the initiating current session; it cannot launder a revoked request.
        if (row.actor_id !== p.user.id || row.session_id !== p.sessionId)
          deny("DEPLOYMENT_SESSION_DENIED", 403);
        if (
          row.state !== "allocated" ||
          row.version !== v.reservation_version ||
          n.state !== "active" ||
          row.node_version !== n.version ||
          row.credential_version !== n.credential_version ||
          n.credential_expires_at.getTime() <= this.#now()
        )
          deny("DEPLOYMENT_INTAKE_DENIED");
        if (old)
          return deploymentIntentAccepted.parse({
            operation_id: old.id,
            deployment_id: row.deployment_id,
            reservation_id: row.id,
            state: "pending_qualification",
            effects: "none",
            execution_enabled: false,
          });
        const dispatch = (
          await c.query<{
            actor_id: string;
            session_id: string;
            kind: string;
            reservation_id: string;
          }>(
            "select actor_id,session_id,kind,reservation_id from minecraft_reservation_operations where organization_id=$1 and id=$2",
            [org, v.dispatch_operation_id],
          )
        ).rows[0];
        if (
          dispatch?.kind !== "dispatch" ||
          dispatch.reservation_id !== row.id ||
          dispatch.actor_id !== p.user.id ||
          dispatch.session_id !== p.sessionId
        )
          deny("DEPLOYMENT_DISPATCH_BINDING_DENIED");
        if (
          (
            await c.query(
              "select 1 from minecraft_deployment_intents where organization_id=$1 and reservation_id=$2",
              [org, row.id],
            )
          ).rowCount
        )
          deny("DEPLOYMENT_ALREADY_REQUESTED");
        const count = (
          await c.query<{ recent: number; daily: number }>(
            "select count(*) filter(where actor_id=$3 and created_at>$4)::int recent,count(*)::int daily from minecraft_deployment_intents where organization_id=$1 and project_id=$2 and created_at>$5",
            [
              org,
              row.project_id,
              p.user.id,
              new Date(this.#now() - 60000),
              new Date(this.#now() - 86400000),
            ],
          )
        ).rows[0];
        if (!count || count.recent >= 12 || count.daily >= 10000)
          deny("DEPLOYMENT_LIMIT", 429);
        const id = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "insert into minecraft_deployment_intents(id,organization_id,project_id,environment_id,node_id,reservation_id,dispatch_operation_id,actor_id,session_id,request_key,request_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            org,
            row.project_id,
            row.environment_id,
            row.node_id,
            row.id,
            v.dispatch_operation_id,
            p.user.id,
            p.sessionId,
            key,
            requestHash,
            now,
          ],
        );
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,'server.deployment_requested',$3,'allowed',$4)",
          [
            org,
            p.user.id,
            row.deployment_id,
            {
              operation_id: id,
              reservation_id: row.id,
              source: "deployment_intake",
              effects: "none",
            },
          ],
        );
        await c.query(
          "insert into minecraft_deployment_intent_outbox(id,organization_id,intent_id,schema_version,created_at) values($1,$2,$3,1,$4)",
          [randomUUID(), org, id, now],
        );
        return deploymentIntentAccepted.parse({
          operation_id: id,
          deployment_id: row.deployment_id,
          reservation_id: row.id,
          state: "pending_qualification",
          effects: "none",
          execution_enabled: false,
        });
      },
    );
  }
  async deploymentIntent(token: string, org: string, id: string) {
    z.uuid().parse(id);
    const located = await this.options.auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const r = (
            await c.query<{ reservation_id: string }>(
              "select reservation_id from minecraft_deployment_intents where organization_id=$1 and id=$2",
              [org, id],
            )
          ).rows[0];
          if (!r) deny("NOT_FOUND", 404);
          return r;
        }),
    );
    const scope = await this.#locate(
      token,
      org,
      "minecraft_reservations",
      located.reservation_id,
    );
    if (!scope.node_id || !scope.environment_id) deny("NOT_FOUND", 404);
    return this.#scope(
      token,
      org,
      scope.project_id,
      scope.node_id,
      scope.environment_id,
      async (c) => {
        const r = (
          await c.query<{
            id: string;
            deployment_id: string;
            reservation_id: string;
            project_id: string;
            environment_id: string;
            node_id: string;
            server_id: string;
            world_id: string;
            created_at: Date;
          }>(
            "select i.*,r.deployment_id,r.server_id,r.world_id from minecraft_deployment_intents i join minecraft_reservations r on (r.organization_id,r.id)=(i.organization_id,i.reservation_id) where i.organization_id=$1 and i.id=$2",
            [org, id],
          )
        ).rows[0];
        if (!r) deny("NOT_FOUND", 404);
        return deploymentIntentView.parse({
          operation_id: r.id,
          deployment_id: r.deployment_id,
          reservation_id: r.reservation_id,
          project_id: r.project_id,
          environment_id: r.environment_id,
          node_id: r.node_id,
          server_id: r.server_id,
          world_id: r.world_id,
          created_at: r.created_at.toISOString(),
          state: "pending_qualification",
          effects: "none",
          execution_enabled: false,
        });
      },
    );
  }
}
