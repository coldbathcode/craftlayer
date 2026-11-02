import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AuthService } from "../../packages/auth/src/index.js";
import {
  NodeControl,
  type ReservationAdmissionContext,
  ReservationLedger,
} from "../../packages/minecraft-control/src/index.js";
import {
  generateNodeKey,
  nodeDigest,
  nodeTimeWindow,
  signNodeValue,
} from "../../packages/node-protocol/src/index.js";

const url = process.env.TEST_RESERVATIONS_DATABASE_URL ?? "",
  identityUrl = process.env.TEST_RESERVATIONS_IDENTITY_DATABASE_URL ?? "";
if (!url || !identityUrl) throw new Error("Disposable reservation DB required");
const runtime = new pg.Pool({ connectionString: url, max: 2 }),
  identity = new pg.Pool({ connectionString: identityUrl, max: 2 });
const auth = new AuthService({
  databaseUrl: identityUrl,
  bootstrapToken: randomBytes(32).toString("hex"),
  recoveryToken: randomBytes(32).toString("hex"),
  csrfSecret: randomBytes(32).toString("hex"),
});
beforeAll(() => auth.initialize());
afterAll(async () => {
  await auth.close();
  await runtime.end();
  await identity.end();
});
async function tx<T>(
  pool: pg.Pool,
  org: string,
  fn: (c: pg.PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [org]);
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
async function fixture(
  fn: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await fn(f);
  } finally {
    await f.nodes.close();
    await f.ledger.close();
  }
}
async function setup() {
  const org = randomUUID(),
    project = randomUUID(),
    environment = randomUUID(),
    otherProject = randomUUID(),
    otherEnvironment = randomUUID(),
    foreignOrg = randomUUID();
  await tx(identity, org, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Reservation fixture')",
      [org],
    );
    for (const id of [project, otherProject])
      await c.query(
        "insert into projects(id,organization_id,name) values($1,$2,'Placement')",
        [id, org],
      );
    for (const [id, p] of [
      [environment, project],
      [otherEnvironment, otherProject],
    ])
      await c.query(
        "insert into environments(id,organization_id,project_id,name,type) values($1,$2,$3,'World scope','minecraft')",
        [id, org, p],
      );
    for (const name of ["org_admin", "viewer"]) {
      const id = randomUUID();
      await c.query(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true)",
        [id, org, name],
      );
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3",
        [org, id, name],
      );
    }
  });
  await tx(identity, foreignOrg, (c) =>
    c.query("insert into organizations(id,name) values($1,'Foreign fixture')", [
      foreignOrg,
    ]),
  );
  async function member(role: string, type = "adult") {
    const user = randomUUID(),
      membership = randomUUID(),
      session = randomUUID(),
      token = randomBytes(32).toString("base64url");
    await tx(identity, org, async (c) => {
      await c.query(
        "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused')",
        [user, `reserve-${user}`, type],
      );
      await c.query(
        "insert into memberships(id,organization_id,user_id) values($1,$2,$3)",
        [membership, org, user],
      );
      await c.query(
        "insert into membership_roles(organization_id,membership_id,role_id) select $1,$2,id from roles where organization_id=$1 and name=$3",
        [org, membership, role],
      );
      await c.query(
        "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",
        [session, user, createHash("sha256").update(token).digest("hex")],
      );
    });
    return token;
  }
  const adult = await member("org_admin"),
    viewer = await member("viewer"),
    child = await member("org_admin", "child"),
    control = generateNodeKey(),
    agent = generateNodeKey();
  let now = Date.now(),
    sequence = 0;
  const nodes = new NodeControl({
    databaseUrl: url,
    auth,
    controlPrivateKey: control.private_key,
    clock: () => now,
  });
  const receipt = await nodes.enroll(
    adult,
    org,
    {
      project_id: project,
      name: "Fixture host",
      public_key: agent.public_key,
      certificate_sha256: nodeDigest(randomUUID()),
    },
    randomUUID(),
  );
  const fingerprint =
    (await tx(
      runtime,
      org,
      async (c) =>
        (
          await c.query<{ certificate_sha256: string }>(
            "select certificate_sha256 from minecraft_node_credentials where node_id=$1",
            [receipt.node_id],
          )
        ).rows[0]?.certificate_sha256,
    )) ?? "";
  if (!fingerprint) throw new Error("Certificate missing");
  const common = () => ({
    schema_version: 1 as const,
    organization_id: org,
    node_id: receipt.node_id,
    credential_version: 1,
    control_id: nodeDigest(control.public_key),
    ...nodeTimeWindow(now),
  });
  const enroll = { ...common(), purpose: "node.enroll.v1", sequence: 0 };
  await nodes.exchange(
    { payload: enroll, signature: signNodeValue(enroll, agent.private_key) },
    { certificate_sha256: fingerprint, certificate_expires_at: now + 86400000 },
  );
  async function touch(
    occupied_ports: {
      host_ip: string;
      port: number;
      protocol: "tcp" | "udp";
    }[] = [],
  ) {
    const payload = {
      ...common(),
      purpose: "node.heartbeat.v1",
      sequence: ++sequence,
      capacity: {
        observed_at: new Date(now).toISOString(),
        docker_api: "1.50",
        architecture: "amd64",
        cpu_count: 8,
        memory_total_mb: 32768,
        memory_reserved_mb: 0,
        unbounded_containers: 0,
        container_count: 0,
        occupied_ports,
        network_inventory_complete: false,
        disk_quota_verified: false,
        provisioning_qualified: false,
      },
    };
    await nodes.exchange(
      { payload, signature: signNodeValue(payload, agent.private_key) },
      {
        certificate_sha256: fingerprint,
        certificate_expires_at: now + 86400000,
      },
    );
  }
  await touch();
  const config = {
    cpu: 8000,
    memory: 24576,
    disk: 81920,
    approval: null as string | null,
    occupied: [] as { port: number; protocol: "tcp" | "udp" }[],
    policy: "f".repeat(64),
    calls: 0,
    hook: undefined as
      | ((context: ReservationAdmissionContext) => Promise<void>)
      | undefined,
  };
  const ledger = new ReservationLedger({
    databaseUrl: url,
    auth,
    clock: () => now,
    admission: {
      inspect: async (context) => {
        config.calls++;
        await config.hook?.(context);
        return {
          qualified: true,
          request_hash: context.request_hash,
          policy_hash: config.policy,
          template_hash: "e".repeat(64),
          independent_approval_hash: config.approval,
          cpu_budget_milli: config.cpu,
          memory_budget_mb: config.memory,
          disk_budget_mb: config.disk,
          occupied_ports: config.occupied,
          issued_at: new Date(now).toISOString(),
          expires_at: new Date(now + 5000).toISOString(),
        };
      },
    },
  });
  const input = (port = 25565) => ({
    node_id: receipt.node_id,
    environment_id: environment,
    template_id: "family-survival-v1",
    name: "Separate fixture world",
    java_port: port,
    bedrock_port: port + 1,
    plan_hash: "a".repeat(64),
  });
  return {
    org,
    project,
    environment,
    otherEnvironment,
    foreignOrg,
    adult,
    viewer,
    child,
    nodes,
    ledger,
    config,
    input,
    touch,
    node: receipt.node_id,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("reserves exactly one metadata operation for concurrent replay and commits ports/audit/outbox together", () =>
  fixture(async (f) => {
    const key = randomUUID(),
      results = await Promise.all(
        Array.from({ length: 6 }, () =>
          f.ledger.reserve(f.adult, f.org, f.input(), key),
        ),
      );
    expect(new Set(results.map((r) => r.operation_id)).size).toBe(1);
    const r = results[0];
    if (!r) throw new Error("Receipt missing");
    expect(await f.ledger.get(f.adult, f.org, r.reservation_id)).toMatchObject({
      state: "held",
      version: 1,
      cpu_milli: 2000,
      memory_mb: 6144,
      disk_mb: 20480,
    });
    await tx(runtime, f.org, async (c) => {
      expect(
        (
          await c.query(
            "select 1 from minecraft_reservation_ports where reservation_id=$1",
            [r.reservation_id],
          )
        ).rowCount,
      ).toBe(2);
      expect(
        (
          await c.query(
            "select 1 from minecraft_reservation_operations where reservation_id=$1",
            [r.reservation_id],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from minecraft_reservation_outbox where operation_id=$1",
            [r.operation_id],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from audit_events where target_id=$1 and details->>'operation_id'=$2",
            [r.reservation_id, r.operation_id],
          )
        ).rowCount,
      ).toBe(1);
      expect((await c.query("select 1 from minecraft_servers")).rowCount).toBe(
        0,
      );
    });
    await expect(
      f.ledger.reserve(f.adult, f.org, { ...f.input(), name: "Changed" }, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await tx(identity, f.org, (c) =>
      c.query(
        "delete from role_permissions where organization_id=$1 and permission='node:deploy'",
        [f.org],
      ),
    );
    await expect(
      f.ledger.reserve(f.adult, f.org, f.input(), key),
    ).rejects.toMatchObject({ status: 403 });
  }));

it("gives competing same-port requests one winner without partial losing reservations", () =>
  fixture(async (f) => {
    const results = await Promise.allSettled([
      f.ledger.reserve(f.adult, f.org, f.input(), randomUUID()),
      f.ledger.reserve(f.adult, f.org, f.input(), randomUUID()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      code: "RESERVATION_PORT_CONFLICT",
    });
    await tx(runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_reservations")).rowCount,
      ).toBe(1);
      expect(
        (await c.query("select 1 from minecraft_reservation_ports")).rowCount,
      ).toBe(2);
    });
  }));

it.each(["cpu", "memory", "disk"] as const)(
  "does not overbook the qualified %s budget",
  (resource) =>
    fixture(async (f) => {
      f.config[resource] = { cpu: 2000, memory: 6144, disk: 20480 }[resource];
      await f.ledger.reserve(f.adult, f.org, f.input(25565), randomUUID());
      await expect(
        f.ledger.reserve(f.adult, f.org, f.input(25567), randomUUID()),
      ).rejects.toMatchObject({ code: "RESERVATION_CAPACITY_CONFLICT" });
    }),
);

it("expires only undispatched holds, audits expiry and reuses freed ports without deleting history", () =>
  fixture(async (f) => {
    const first = await f.ledger.reserve(
      f.adult,
      f.org,
      f.input(),
      randomUUID(),
    );
    f.advance(61000);
    await f.touch();
    const next = await f.ledger.reserve(
      f.adult,
      f.org,
      f.input(),
      randomUUID(),
    );
    expect(next.reservation_id).not.toBe(first.reservation_id);
    expect(
      (await f.ledger.get(f.adult, f.org, first.reservation_id)).state,
    ).toBe("released");
    await tx(runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_reservations")).rowCount,
      ).toBe(2);
      expect(
        (
          await c.query(
            "select 1 from minecraft_reservation_operations where reservation_id=$1 and kind='expire' and actor_id is null",
            [first.reservation_id],
          )
        ).rowCount,
      ).toBe(1);
    });
  }));

it("requires fresh dispatch approval and retains allocated/uncertain capacity and ports beyond expiry", () =>
  fixture(async (f) => {
    const r = await f.ledger.reserve(f.adult, f.org, f.input(), randomUUID());
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        r.reservation_id,
        "dispatch",
        1,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_APPROVAL_REQUIRED" });
    f.config.approval = "b".repeat(64);
    await f.ledger.change(
      f.adult,
      f.org,
      r.reservation_id,
      "dispatch",
      1,
      randomUUID(),
    );
    await expect(
      tx(runtime, f.org, (c) =>
        c.query(
          "delete from minecraft_reservation_ports where reservation_id=$1",
          [r.reservation_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await f.ledger.change(
      f.adult,
      f.org,
      r.reservation_id,
      "uncertain",
      2,
      randomUUID(),
    );
    f.advance(61000);
    await f.touch();
    await expect(
      f.ledger.reserve(f.adult, f.org, f.input(), randomUUID()),
    ).rejects.toMatchObject({ code: "RESERVATION_PORT_CONFLICT" });
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        r.reservation_id,
        "release",
        3,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_RECONCILIATION_REQUIRED" });
    expect((await f.ledger.get(f.adult, f.org, r.reservation_id)).state).toBe(
      "uncertain",
    );
  }));

it("rechecks fresh conflicts, budget and policy immediately before recording dispatch intent", () =>
  fixture(async (f) => {
    const first = await f.ledger.reserve(
      f.adult,
      f.org,
      f.input(),
      randomUUID(),
    );
    await f.ledger.reserve(f.adult, f.org, f.input(25567), randomUUID());
    f.config.approval = "b".repeat(64);
    f.config.occupied = [{ port: 25565, protocol: "tcp" }];
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        first.reservation_id,
        "dispatch",
        1,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_PORT_CONFLICT" });
    f.config.occupied = [];
    f.config.cpu = 2000;
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        first.reservation_id,
        "dispatch",
        1,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_CAPACITY_CONFLICT" });
    f.config.cpu = 8000;
    f.config.policy = "0".repeat(64);
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        first.reservation_id,
        "dispatch",
        1,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_APPROVAL_REQUIRED" });
    f.config.policy = "f".repeat(64);
    await f.touch([{ host_ip: "127.0.0.1", port: 25565, protocol: "tcp" }]);
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        first.reservation_id,
        "dispatch",
        1,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_PORT_CONFLICT" });
    expect(
      (await f.ledger.get(f.adult, f.org, first.reservation_id)).state,
    ).toBe("held");
  }));

it("denies child/viewer/foreign placement and rechecks actor revocation after admission I/O", () =>
  fixture(async (f) => {
    await expect(
      f.ledger.reserve("", f.org, f.input(), randomUUID()),
    ).rejects.toMatchObject({ status: 401 });
    for (const token of [f.child, f.viewer])
      await expect(
        f.ledger.reserve(token, f.org, f.input(), randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.ledger.reserve(f.adult, f.foreignOrg, f.input(), randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.ledger.reserve(
        f.adult,
        f.org,
        { ...f.input(), environment_id: f.otherEnvironment },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.config.calls).toBe(0);
    f.config.hook = async () => {
      await tx(identity, f.org, (c) =>
        c.query(
          "delete from role_permissions where organization_id=$1 and permission='server:provision'",
          [f.org],
        ),
      );
    };
    await expect(
      f.ledger.reserve(f.adult, f.org, f.input(), randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await tx(runtime, f.org, (c) =>
          c.query("select 1 from minecraft_reservations"),
        )
      ).rowCount,
    ).toBe(0);
  }));

it("fails closed without a qualified adapter and honors shared instance stop visibility", () =>
  fixture(async (f) => {
    const disabled = new ReservationLedger({ databaseUrl: url, auth });
    try {
      await expect(
        disabled.reserve(f.adult, f.org, f.input(), randomUUID()),
      ).rejects.toMatchObject({ code: "RESERVATION_UNQUALIFIED", status: 503 });
    } finally {
      await disabled.close();
    }
    const scope = randomUUID();
    await tx(runtime, f.org, async (c) => {
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      await c.query(
        "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('instance',$1,null,1,true,$2,'Reservation test stop')",
        [scope, randomUUID()],
      );
    });
    try {
      await expect(
        f.ledger.reserve(f.adult, f.org, f.input(), randomUUID()),
      ).rejects.toMatchObject({ code: "STOP_LATCHED" });
      expect(f.config.calls).toBe(0);
    } finally {
      await tx(runtime, f.org, async (c) => {
        await c.query(
          "select set_config('app.runtime_internal','enabled',true)",
        );
        await c.query(
          "update runtime_stop_latches set latched=false,epoch=epoch+1 where kind='instance' and scope_id=$1",
          [scope],
        );
      });
    }
  }));

it("enforces scoped immutable bindings/history and releases only a current held reservation", () =>
  fixture(async (f) => {
    const r = await f.ledger.reserve(f.adult, f.org, f.input(), randomUUID());
    expect(
      (await runtime.query("select 1 from minecraft_reservations")).rowCount,
    ).toBe(0);
    await expect(
      tx(runtime, f.org, (c) =>
        c.query(
          "update minecraft_reservations set world_id=$2,version=version+1 where id=$1",
          [r.reservation_id, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      tx(runtime, f.org, (c) =>
        c.query("delete from minecraft_reservations where id=$1", [
          r.reservation_id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tx(runtime, f.org, (c) =>
        c.query(
          "update minecraft_reservation_operations set kind='release' where id=$1",
          [r.operation_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tx(runtime, f.foreignOrg, (c) =>
        c.query(
          "insert into minecraft_reservation_outbox(id,organization_id,operation_id,created_at) values($1,$2,$3,now())",
          [randomUUID(), f.foreignOrg, r.operation_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      f.ledger.change(
        f.adult,
        f.org,
        r.reservation_id,
        "release",
        99,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "RESERVATION_VERSION_CONFLICT" });
    const key = randomUUID(),
      released = await f.ledger.change(
        f.adult,
        f.org,
        r.reservation_id,
        "release",
        1,
        key,
      );
    expect(
      await f.ledger.change(
        f.adult,
        f.org,
        r.reservation_id,
        "release",
        1,
        key,
      ),
    ).toEqual(released);
    expect((await f.ledger.get(f.adult, f.org, r.reservation_id)).state).toBe(
      "released",
    );
    expect(
      (
        await tx(runtime, f.org, (c) =>
          c.query(
            "select 1 from minecraft_reservation_ports where reservation_id=$1",
            [r.reservation_id],
          ),
        )
      ).rowCount,
    ).toBe(0);
  }));

async function allocated(f: Awaited<ReturnType<typeof setup>>, port = 25565) {
  const reservation = await f.ledger.reserve(
    f.adult,
    f.org,
    f.input(port),
    randomUUID(),
  );
  f.config.approval = "b".repeat(64);
  const dispatch = await f.ledger.change(
    f.adult,
    f.org,
    reservation.reservation_id,
    "dispatch",
    1,
    randomUUID(),
  );
  return {
    reservation,
    dispatch,
    input: {
      reservation_id: reservation.reservation_id,
      dispatch_operation_id: dispatch.operation_id,
      reservation_version: 2,
    },
  };
}

it("persists one disabled deployment intent/audit/reference-only outbox for concurrent replay and DB reopen", () =>
  fixture(async (f) => {
    const a = await allocated(f),
      key = randomUUID(),
      calls = f.config.calls;
    const receipts = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.ledger.queueDeployment(f.adult, f.org, a.input, key),
      ),
    );
    expect(new Set(receipts.map((r) => r.operation_id)).size).toBe(1);
    const accepted = receipts[0];
    if (!accepted) throw new Error("Intent missing");
    expect(accepted).toMatchObject({
      state: "pending_qualification",
      effects: "none",
      execution_enabled: false,
      deployment_id: a.reservation.deployment_id,
    });
    expect(f.config.calls).toBe(calls);
    await tx(runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_deployment_intents")).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from audit_events where action='server.deployment_requested' and details->>'operation_id'=$1",
            [accepted.operation_id],
          )
        ).rowCount,
      ).toBe(1);
      const outbox = (
        await c.query(
          "select * from minecraft_deployment_intent_outbox where intent_id=$1",
          [accepted.operation_id],
        )
      ).rows;
      expect(outbox).toHaveLength(1);
      expect(Object.keys(outbox[0]).sort()).toEqual([
        "created_at",
        "id",
        "intent_id",
        "organization_id",
        "schema_version",
      ]);
    });
    const reopened = new ReservationLedger({ databaseUrl: url, auth });
    try {
      expect(
        await reopened.deploymentIntent(f.adult, f.org, accepted.operation_id),
      ).toMatchObject({
        ...accepted,
        project_id: f.project,
        environment_id: f.environment,
        node_id: f.node,
      });
    } finally {
      await reopened.close();
    }
    await expect(
      f.ledger.queueDeployment(f.adult, f.org, a.input, randomUUID()),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_ALREADY_REQUESTED" });
    await expect(
      f.ledger.queueDeployment(
        f.adult,
        f.org,
        { ...a.input, reservation_version: 99 },
        key,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      (await f.ledger.get(f.adult, f.org, a.reservation.reservation_id)).state,
    ).toBe("allocated");
  }));

it("denies child/viewer/anonymous/foreign deployment intake and reads with current canonical scope", () =>
  fixture(async (f) => {
    const a = await allocated(f);
    for (const token of ["", f.child, f.viewer])
      await expect(
        f.ledger.queueDeployment(token, f.org, a.input, randomUUID()),
      ).rejects.toMatchObject({ status: token ? 403 : 401 });
    await expect(
      f.ledger.queueDeployment(f.adult, f.foreignOrg, a.input, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    const accepted = await f.ledger.queueDeployment(
      f.adult,
      f.org,
      a.input,
      randomUUID(),
    );
    for (const token of [f.child, f.viewer])
      await expect(
        f.ledger.deploymentIntent(token, f.org, accepted.operation_id),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.ledger.deploymentIntent(f.adult, f.foreignOrg, accepted.operation_id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.ledger.queueDeployment(
        f.adult,
        f.org,
        { ...a.input, execution_enabled: true },
        randomUUID(),
      ),
    ).rejects.toThrow();
  }));

it("rejects held/uncertain/changed-version and mismatched dispatch operations without partial records", () =>
  fixture(async (f) => {
    const held = await f.ledger.reserve(
      f.adult,
      f.org,
      f.input(),
      randomUUID(),
    );
    await expect(
      f.ledger.queueDeployment(
        f.adult,
        f.org,
        {
          reservation_id: held.reservation_id,
          dispatch_operation_id: held.operation_id,
          reservation_version: 1,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_INTAKE_DENIED" });
    f.config.approval = "b".repeat(64);
    const dispatched = await f.ledger.change(
      f.adult,
      f.org,
      held.reservation_id,
      "dispatch",
      1,
      randomUUID(),
    );
    const input = {
      reservation_id: held.reservation_id,
      dispatch_operation_id: dispatched.operation_id,
      reservation_version: 2,
    };
    for (const changes of [
      { dispatch_operation_id: held.operation_id },
      { dispatch_operation_id: randomUUID() },
      { reservation_version: 1 },
    ])
      await expect(
        f.ledger.queueDeployment(
          f.adult,
          f.org,
          { ...input, ...changes },
          randomUUID(),
        ),
      ).rejects.toThrow();
    const other = await allocated(f, 25567);
    await expect(
      f.ledger.queueDeployment(
        f.adult,
        f.org,
        { ...input, dispatch_operation_id: other.dispatch.operation_id },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_DISPATCH_BINDING_DENIED" });
    await f.ledger.change(
      f.adult,
      f.org,
      held.reservation_id,
      "uncertain",
      2,
      randomUUID(),
    );
    await expect(
      f.ledger.queueDeployment(
        f.adult,
        f.org,
        { ...input, reservation_version: 3 },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_INTAKE_DENIED" });
    await tx(runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_deployment_intents")).rowCount,
      ).toBe(0);
      expect(
        (await c.query("select 1 from minecraft_deployment_intent_outbox"))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await c.query(
            "select 1 from audit_events where action='server.deployment_requested'",
          )
        ).rowCount,
      ).toBe(0);
    });
  }));

it("revalidates current session and node generation before replaying a deployment request", () =>
  fixture(async (f) => {
    const a = await allocated(f),
      key = randomUUID();
    await f.ledger.queueDeployment(f.adult, f.org, a.input, key);
    await tx(identity, f.org, (c) =>
      c.query("update sessions set revoked_at=now() where token_hash=$1", [
        createHash("sha256").update(f.adult).digest("hex"),
      ]),
    );
    await expect(
      f.ledger.queueDeployment(f.adult, f.org, a.input, key),
    ).rejects.toMatchObject({ status: 401 });
  }));

it("honors shared durable stops before creating deployment intake", () =>
  fixture(async (f) => {
    const a = await allocated(f),
      scope = randomUUID();
    await tx(runtime, f.org, async (c) => {
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      await c.query(
        "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('instance',$1,null,1,true,$2,'Deployment intake stop')",
        [scope, randomUUID()],
      );
    });
    try {
      await expect(
        f.ledger.queueDeployment(f.adult, f.org, a.input, randomUUID()),
      ).rejects.toMatchObject({ code: "STOP_LATCHED" });
      expect(
        (
          await tx(runtime, f.org, (c) =>
            c.query("select 1 from minecraft_deployment_intents"),
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await tx(runtime, f.org, async (c) => {
        await c.query(
          "select set_config('app.runtime_internal','enabled',true)",
        );
        await c.query(
          "update runtime_stop_latches set latched=false,epoch=epoch+1 where kind='instance' and scope_id=$1",
          [scope],
        );
      });
    }
  }));

it("forces deployment intake RLS, immutable disabled state and same-reservation dispatch references in SQL", () =>
  fixture(async (f) => {
    const a = await allocated(f),
      accepted = await f.ledger.queueDeployment(
        f.adult,
        f.org,
        a.input,
        randomUUID(),
      );
    expect(
      (await runtime.query("select 1 from minecraft_deployment_intents"))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await tx(runtime, f.foreignOrg, (c) =>
          c.query("select 1 from minecraft_deployment_intent_outbox"),
        )
      ).rowCount,
    ).toBe(0);
    for (const table of [
      "minecraft_deployment_intents",
      "minecraft_deployment_intent_outbox",
    ]) {
      await expect(
        tx(runtime, f.org, (c) => c.query(`delete from ${table}`)),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        tx(runtime, f.org, (c) =>
          c.query(`update ${table} set created_at=now()`),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      tx(runtime, f.foreignOrg, (c) =>
        c.query(
          "insert into minecraft_deployment_intent_outbox(id,organization_id,intent_id,created_at) values($1,$2,$3,now())",
          [randomUUID(), f.foreignOrg, accepted.operation_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const b = await allocated(f, 25567);
    const columns =
      "id,organization_id,project_id,environment_id,node_id,reservation_id,dispatch_operation_id,actor_id,session_id,request_key,request_hash,state,execution_enabled,created_at";
    const base = (
      await tx(runtime, f.org, (c) =>
        c.query(
          "select actor_id,session_id from minecraft_reservations where id=$1",
          [b.reservation.reservation_id],
        ),
      )
    ).rows[0];
    const insert = (
      changes: {
        dispatch?: string;
        enabled?: boolean;
        state?: string;
        actor?: string;
        session?: string;
        project?: string;
      } = {},
    ) =>
      tx(runtime, f.org, (c) =>
        c.query(
          `insert into minecraft_deployment_intents(${columns}) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
          [
            randomUUID(),
            f.org,
            changes.project ?? f.project,
            f.environment,
            f.node,
            b.reservation.reservation_id,
            changes.dispatch ?? b.dispatch.operation_id,
            changes.actor ?? base.actor_id,
            changes.session ?? base.session_id,
            randomUUID(),
            "c".repeat(64),
            changes.state ?? "pending_qualification",
            changes.enabled ?? false,
          ],
        ),
      );
    for (const changes of [
      { dispatch: a.dispatch.operation_id },
      { dispatch: b.reservation.operation_id },
      { enabled: true },
      { state: "ready" },
      { actor: randomUUID() },
      { session: randomUUID() },
      { project: randomUUID() },
    ])
      await expect(insert(changes)).rejects.toMatchObject({
        code: changes.project ? "23503" : "23514",
      });
    expect(
      (
        await tx(runtime, f.org, (c) =>
          c.query("select 1 from minecraft_deployment_intents"),
        )
      ).rowCount,
    ).toBe(1);
  }));

it.each(["rotate", "revoke"] as const)(
  "denies deployment intake after node %s",
  (kind) =>
    fixture(async (f) => {
      const a = await allocated(f),
        key = randomUUID();
      await f.ledger.queueDeployment(f.adult, f.org, a.input, key);
      const n = await f.nodes.get(f.adult, f.org, f.node);
      await f.nodes.change(
        f.adult,
        f.org,
        f.node,
        kind,
        {
          expected_version: n.version,
          ...(kind === "rotate"
            ? {
                public_key: generateNodeKey().public_key,
                certificate_sha256: nodeDigest(randomUUID()),
              }
            : {}),
        },
        randomUUID(),
      );
      await expect(
        f.ledger.queueDeployment(f.adult, f.org, a.input, key),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_INTAKE_DENIED" });
    }),
);

it("cannot move an allocated deployment request into another session or replay after grant removal", () =>
  fixture(async (f) => {
    const a = await allocated(f),
      token = randomBytes(32).toString("base64url"),
      key = randomUUID();
    await tx(identity, f.org, async (c) => {
      const user = (
        await c.query("select user_id from sessions where token_hash=$1", [
          createHash("sha256").update(f.adult).digest("hex"),
        ])
      ).rows[0].user_id;
      await c.query(
        "insert into sessions(id,user_id,token_hash,auth_version,idle_expires_at,expires_at) values($1,$2,$3,1,now()+interval '1 hour',now()+interval '2 hours')",
        [randomUUID(), user, createHash("sha256").update(token).digest("hex")],
      );
    });
    await expect(
      f.ledger.queueDeployment(token, f.org, a.input, key),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_SESSION_DENIED" });
    await f.ledger.queueDeployment(f.adult, f.org, a.input, key);
    await tx(identity, f.org, (c) =>
      c.query(
        "delete from role_permissions where organization_id=$1 and permission='server:provision'",
        [f.org],
      ),
    );
    await expect(
      f.ledger.queueDeployment(f.adult, f.org, a.input, key),
    ).rejects.toMatchObject({ status: 403 });
  }));
