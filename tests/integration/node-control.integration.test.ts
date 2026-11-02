import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { buildNodeAgentApp } from "../../apps/api/src/node-agent-app.js";
import { NodeTransport } from "../../apps/minecraft-node/src/client.js";
import { AuthService } from "../../packages/auth/src/index.js";
import type { NodeAgentRequest } from "../../packages/contracts/src/index.js";
import {
  MinecraftControl,
  NodeControl,
} from "../../packages/minecraft-control/src/index.js";
import {
  generateNodeKey,
  nodeDigest,
  nodeTimeWindow,
  signNodeValue,
} from "../../packages/node-protocol/src/index.js";
import { createNodeFixture } from "../../scripts/minecraft/node-fixtures.js";

const url = process.env.TEST_NODES_DATABASE_URL,
  identityUrl = process.env.TEST_NODES_IDENTITY_DATABASE_URL;
if (!url || !identityUrl) throw new Error("Disposable node DB required");
const identity = new pg.Pool({ connectionString: identityUrl, max: 2 }),
  runtime = new pg.Pool({ connectionString: url, max: 1 }),
  auth = new AuthService({
    databaseUrl: identityUrl,
    bootstrapToken: randomBytes(32).toString("hex"),
    recoveryToken: randomBytes(32).toString("hex"),
    csrfSecret: randomBytes(32).toString("hex"),
  });
const org = randomUUID(),
  project = randomUUID(),
  foreignOrg = randomUUID(),
  keypair = generateNodeKey(),
  agentKey = generateNodeKey();
let adult = "",
  viewer = "",
  child = "",
  node = "",
  metadataOperation = "",
  root = "";
let mtls: Awaited<ReturnType<typeof createNodeFixture>>;
const nodes = new NodeControl({
    databaseUrl: url,
    auth,
    controlPrivateKey: keypair.private_key,
  }),
  minecraft = new MinecraftControl({ databaseUrl: url, auth });
async function tx<T>(
  pool: pg.Pool,
  scope: string,
  fn: (c: pg.PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.organization_id',$1,true)", [scope]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function member(role: string, type = "adult") {
  const user = randomUUID(),
    membership = randomUUID(),
    session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await tx(identity, org, async (c) => {
    await c.query(
      "insert into users(id,login,account_type,password_hash) values($1,$2,$3,'synthetic-unused')",
      [user, `node-${user}`, type],
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
const proof = (
  purpose: "node.enroll.v1" | "node.heartbeat.v1",
  sequence = 0,
  version = 1,
): NodeAgentRequest => {
  const common = {
    schema_version: 1 as const,
    control_id: nodeDigest(keypair.public_key),
    organization_id: org,
    node_id: node,
    credential_version: version,
    ...nodeTimeWindow(),
  };
  return purpose === "node.enroll.v1"
    ? { ...common, purpose, sequence: 0 }
    : { ...common, purpose, sequence, capacity: null };
};
const signed = (payload: NodeAgentRequest, key = agentKey) => ({
  payload,
  signature: signNodeValue(payload, key.private_key),
});
beforeAll(async () => {
  await auth.initialize();
  await tx(identity, org, async (c) => {
    await c.query(
      "insert into organizations(id,name) values($1,'Node fixture')",
      [org],
    );
    await c.query(
      "insert into projects(id,organization_id,name) values($1,$2,'Node fixture')",
      [project, org],
    );
    const roles = (
      await c.query<{ role_name: string }>(
        "select distinct role_name from built_in_role_permissions",
      )
    ).rows;
    for (const r of roles) {
      const id = randomUUID();
      await c.query(
        "insert into roles(id,organization_id,name,built_in) values($1,$2,$3,true)",
        [id, org, r.role_name],
      );
      await c.query(
        "insert into role_permissions(organization_id,role_id,permission) select $1,$2,permission from built_in_role_permissions where role_name=$3",
        [org, id, r.role_name],
      );
    }
  });
  await tx(identity, foreignOrg, (c) =>
    c.query("insert into organizations(id,name) values($1,'Foreign')", [
      foreignOrg,
    ]),
  );
  adult = await member("org_admin");
  viewer = await member("viewer");
  child = await member("org_admin", "child");
  root = await mkdtemp(join(tmpdir(), "craftlayer-node-tls-"));
  mtls = await createNodeFixture(join(root, "pki"));
}, 30000);
afterAll(async () => {
  await nodes.close();
  await minecraft.close();
  await auth.close();
  await identity.end();
  await runtime.end();
  if (root) await rm(root, { recursive: true, force: true });
});
describe("node principal and mTLS boundary", () => {
  it("creates one key/certificate-bound short enrollment with atomic audit/outbox and current replay permission", async () => {
    const key = randomUUID(),
      body = {
        project_id: project,
        name: "Disposable Docker host",
        public_key: agentKey.public_key,
        certificate_sha256: mtls.certificate_sha256,
      };
    const receipts = await Promise.all(
      Array.from({ length: 6 }, () => nodes.enroll(adult, org, body, key)),
    );
    expect(new Set(receipts.map((r) => r.node_id)).size).toBe(1);
    node = receipts[0]?.node_id ?? "";
    metadataOperation = receipts[0]?.operation_id ?? "";
    const view = await nodes.get(adult, org, node);
    expect(view).toMatchObject({
      state: "enrolling",
      connection: "awaiting_enrollment",
      capacity: null,
    });
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query("select 1 from minecraft_node_operations where id=$1", [
            metadataOperation,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from minecraft_node_outbox where operation_id=$1",
            [metadataOperation],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await c.query(
            "select 1 from audit_events where details->>'operation_id'=$1",
            [metadataOperation],
          )
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      nodes.enroll(adult, org, { ...body, name: "Changed" }, key),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("denies children with admin roles, viewers, foreign scope, and role-less replay", async () => {
    for (const token of [child, viewer])
      await expect(nodes.list(token, org, project)).rejects.toMatchObject({
        status: 403,
      });
    await expect(nodes.get(adult, foreignOrg, node)).rejects.toMatchObject({
      status: 404,
    });
    const scoped = await member("org_admin"),
      key = randomUUID(),
      pair = generateNodeKey(),
      body = {
        project_id: project,
        name: "Revoked creator",
        public_key: pair.public_key,
        certificate_sha256: "c".repeat(64),
      };
    await nodes.enroll(scoped, org, body, key);
    await auth.logout(scoped);
    await expect(nodes.enroll(scoped, org, body, key)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects wrong key/certificate, expired/forged proofs and unapproved commands before activating", async () => {
    const peer = {
      certificate_sha256: mtls.certificate_sha256,
      certificate_expires_at: Date.now() + 86400000,
    };
    await expect(
      nodes.exchange(signed(proof("node.enroll.v1"), generateNodeKey()), peer),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      nodes.exchange(signed(proof("node.enroll.v1")), {
        ...peer,
        certificate_sha256: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 401 });
    const expired = {
      ...proof("node.enroll.v1"),
      issued_at: new Date(Date.now() - 60000).toISOString(),
      expires_at: new Date(Date.now() - 30000).toISOString(),
    };
    await expect(nodes.exchange(signed(expired), peer)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      nodes.exchange(
        { ...signed(proof("node.enroll.v1")), command: "docker rm" },
        peer,
      ),
    ).rejects.toThrow();
    expect((await nodes.get(adult, org, node)).state).toBe("enrolling");
  });
  it("requires real mTLS and pins the controller certificate before accepting signed inventory", async () => {
    const pki = join(root, "pki"),
      [key, cert, ca, clientKey, clientCert] = await Promise.all(
        ["server.key", "server.crt", "ca.crt", "client.key", "client.crt"].map(
          (p) => readFile(join(pki, p), "utf8"),
        ),
      );
    if (!key || !cert || !ca || !clientKey || !clientCert)
      throw new Error("TLS fixture missing");
    const app = await buildNodeAgentApp({ control: nodes, key, cert, ca });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("TLS address missing");
    const connection = {
      url: `https://127.0.0.1:${address.port}`,
      ca,
      key: clientKey,
      cert: clientCert,
      private_key: agentKey.private_key,
      control_public_key: keypair.public_key,
      server_certificate_sha256: mtls.server_certificate_sha256,
    };
    try {
      await expect(
        new NodeTransport({
          ...connection,
          server_certificate_sha256: "0".repeat(64),
        }).send(proof("node.enroll.v1")),
      ).rejects.toThrow();
      await expect(
        new NodeTransport({ ...connection, cert: "", key: "" }).send(
          proof("node.enroll.v1"),
        ),
      ).rejects.toThrow();
      const transport = new NodeTransport(connection);
      expect(
        (await transport.send(proof("node.enroll.v1"))).capabilities,
      ).toEqual(["inventory.read"]);
      await expect(transport.send(proof("node.enroll.v1"))).rejects.toThrow(
        "NODE_ALREADY_ENROLLED",
      );
      expect(
        (await transport.send(proof("node.heartbeat.v1", 1))).sequence,
      ).toBe(1);
      await expect(
        transport.send(proof("node.heartbeat.v1", 1)),
      ).rejects.toThrow();
      const badCert = await readFile(join(pki, "other.crt"), "utf8"),
        badKey = await readFile(join(pki, "other.key"), "utf8");
      await expect(
        new NodeTransport({ ...connection, cert: badCert, key: badKey }).send(
          proof("node.heartbeat.v1", 2),
        ),
      ).rejects.toThrow();
      expect((await nodes.get(adult, org, node)).connection).toBe("online");
    } finally {
      await app.close();
    }
  });
  it("rotates both key and certificate, rejects old generations and preserves immutable credential history", async () => {
    const current = await nodes.get(adult, org, node),
      next = generateNodeKey();
    const cert = await readFile(join(root, "pki", "other.crt"));
    const { certificateHash } = await import(
      "../../packages/node-protocol/src/index.js"
    );
    const fingerprint = certificateHash(cert);
    await nodes.change(
      adult,
      org,
      node,
      "rotate",
      {
        expected_version: current.version,
        public_key: next.public_key,
        certificate_sha256: fingerprint,
      },
      randomUUID(),
    );
    await expect(
      nodes.exchange(signed(proof("node.heartbeat.v1", 2)), {
        certificate_sha256: mtls.certificate_sha256,
        certificate_expires_at: Date.now() + 86400000,
      }),
    ).rejects.toMatchObject({ status: 401 });
    const payload = proof("node.heartbeat.v1", 1, 2);
    expect(
      (
        await nodes.exchange(signed(payload, next), {
          certificate_sha256: fingerprint,
          certificate_expires_at: Date.now() + 86400000,
        })
      ).payload.credential_version,
    ).toBe(2);
    const view = await nodes.get(adult, org, node);
    await nodes.change(
      adult,
      org,
      node,
      "revoke",
      { expected_version: view.version },
      randomUUID(),
    );
    await expect(
      nodes.exchange(signed(proof("node.heartbeat.v1", 2, 2), next), {
        certificate_sha256: fingerprint,
        certificate_expires_at: Date.now() + 86400000,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect((await nodes.get(adult, org, node)).connection).toBe("revoked");
    await tx(runtime, org, async (c) => {
      expect(
        (
          await c.query(
            "select 1 from minecraft_node_credentials where node_id=$1",
            [node],
          )
        ).rowCount,
      ).toBe(2);
    });
  });
  it("enforces RLS/immutable history and tenant node-operation integrity", async () => {
    expect(
      (await runtime.query("select * from minecraft_nodes")).rows,
    ).toHaveLength(0);
    await expect(
      tx(runtime, org, (c) =>
        c.query("update minecraft_node_credentials set version=99"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tx(runtime, org, (c) =>
        c.query("delete from minecraft_nodes where id=$1", [node]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      tx(runtime, foreignOrg, (c) =>
        c.query(
          "insert into minecraft_node_outbox(id,organization_id,operation_id,created_at) values($1,$2,$3,now())",
          [randomUUID(), foreignOrg, metadataOperation],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(
      (
        await runtime.query(
          "select 1 from pg_policies where policyname='node_migration_discovery'",
        )
      ).rowCount,
    ).toBe(0);
  });
  it("exposes scoped REST/OpenAPI/operation receipts with CSRF and no agent endpoint on browser listener", async () => {
    const app = await buildApp({
      auth,
      nodes,
      minecraft,
      publicUrl: "http://127.0.0.1:3000",
      readiness: async () => true,
    });
    const headers = {
      cookie: `craftlayer_session=${adult}`,
      "x-craftlayer-organization": org,
    };
    try {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/nodes?project_id=${project}`,
            headers: { "x-craftlayer-organization": org },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/nodes?project_id=${project}`,
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/nodes/${node}/revoke`,
            headers: { ...headers, origin: "http://127.0.0.1:3000" },
            payload: { expected_version: 1 },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/v1/operations/${metadataOperation}`,
            headers,
          })
        ).json(),
      ).toMatchObject({ resource_type: "node", id: metadataOperation });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/node/v1/enroll",
            payload: signed(proof("node.enroll.v1")),
          })
        ).statusCode,
      ).toBe(404);
      const schema = (
        await app.inject({ method: "GET", url: "/api/v1/openapi.json" })
      ).json();
      expect(schema.paths["/api/v1/nodes/enrollments"]).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

it("does not let expired or revoked enrollment history consume the active node allowance forever", async () => {
  const actor = (
    await tx(runtime, org, (c) =>
      c.query<{ enrolled_by: string }>(
        "select enrolled_by from minecraft_nodes where id=$1",
        [node],
      ),
    )
  ).rows[0]?.enrolled_by;
  if (!actor) throw new Error("Actor missing");
  await tx(runtime, org, (c) =>
    c.query(
      "insert into minecraft_nodes(id,organization_id,project_id,name,state,enrollment_expires_at,enrolled_by,created_at) select gen_random_uuid(),$1,$2,'Expired fixture','enrolling',now()-interval '1 hour',$3,now()-interval '2 hours' from generate_series(1,100)",
      [org, project, actor],
    ),
  );
  const pair = generateNodeKey();
  const result = await nodes.enroll(
    adult,
    org,
    {
      project_id: project,
      name: "New active enrollment",
      public_key: pair.public_key,
      certificate_sha256: "d".repeat(64),
    },
    randomUUID(),
  );
  expect(result.node_id).toBeTruthy();
});
