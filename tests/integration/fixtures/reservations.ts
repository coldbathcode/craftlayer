import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { AuthService } from "../../../packages/auth/src/index.js";
import {
  NodeControl,
  type ReservationAdmissionContext,
  ReservationLedger,
} from "../../../packages/minecraft-control/src/index.js";
import {
  generateNodeKey,
  nodeDigest,
  nodeTimeWindow,
  signNodeValue,
} from "../../../packages/node-protocol/src/index.js";

export function reservationHarness(url: string, identityUrl: string) {
  if (!url || !identityUrl)
    throw new Error("Disposable reservation fixture DB required");
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
  async function setup(binding?: {
    fingerprint?: string;
    control?: ReturnType<typeof generateNodeKey>;
    agent?: ReturnType<typeof generateNodeKey>;
  }) {
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
      c.query(
        "insert into organizations(id,name) values($1,'Foreign fixture')",
        [foreignOrg],
      ),
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
      control = binding?.control ?? generateNodeKey(),
      agent = binding?.agent ?? generateNodeKey();
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
        certificate_sha256: binding?.fingerprint ?? nodeDigest(randomUUID()),
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
      {
        certificate_sha256: fingerprint,
        certificate_expires_at: now + 86400000,
      },
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
      control,
      agent,
      fingerprint,
      now: () => now,
      member,
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

  return { auth, runtime, identity, tx, fixture, setup };
}
