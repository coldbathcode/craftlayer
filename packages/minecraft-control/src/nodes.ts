import { randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  type NodeCapacity,
  nodeCapacity,
  nodeEnrollmentRequest,
  nodeOperationAccepted,
  nodeOperationView,
  nodePage,
  nodeRotationRequest,
  nodeView,
  signedNodeRequest,
  signedNodeResponse,
} from "@craftlayer/contracts";
import { type Authority, canAccess, type Permission } from "@craftlayer/core";
import {
  assertNodeTime,
  nodeDigest,
  nodePrivateKey,
  publicKey,
  signNodeValue,
  verifyNodeValue,
} from "@craftlayer/node-protocol";
import pg from "pg";
import { z } from "zod";

interface NodeRow {
  id: string;
  project_id: string;
  created_at: Date;
  name: string;
  state: "enrolling" | "active" | "revoked";
  version: number;
  credential_version: number;
  enrollment_expires_at: Date;
  last_sequence: number;
  last_seen_at: Date | null;
  capacity: NodeCapacity | null;
  public_key: string;
  certificate_sha256: string;
  credential_expires_at: Date;
}
interface OpRow {
  id: string;
  node_id: string;
  project_id: string;
  kind: string;
  request_hash: string;
  created_at: Date;
}
const selectNode =
  "select n.*,c.public_key,c.certificate_sha256,c.expires_at credential_expires_at from minecraft_nodes n join minecraft_node_credentials c on (c.organization_id,c.node_id,c.version)=(n.organization_id,n.id,n.credential_version) where n.organization_id=$1";
function deny(code = "NODE_DENIED", status = 409): never {
  throw new AuthError(
    status,
    code,
    "Node request denied; verify current scope, enrollment and credentials.",
  );
}
export class NodeControl {
  #pool: pg.Pool;
  #auth: IdentityService | undefined;
  #public: string | null;
  #private: string | undefined;
  #now: () => number;
  constructor(options: {
    databaseUrl: string;
    auth?: IdentityService;
    controlPublicKey?: string;
    controlPrivateKey?: string;
    clock?: () => number;
  }) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    const key = options.controlPrivateKey
      ? nodePrivateKey(options.controlPrivateKey)
      : null;
    this.#public = key?.public_key ?? options.controlPublicKey ?? null;
    if (this.#public) publicKey(this.#public);
    this.#private = key?.private_key;
    this.#auth = options.auth;
    this.#now = options.clock ?? Date.now;
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 3,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
  }
  close() {
    return this.#pool.end();
  }
  async #tx<T>(org: string, fn: (c: pg.PoolClient) => Promise<T>) {
    z.uuid().parse(org);
    const c = await this.#pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.organization_id',$1,true)", [org]);
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
  #scope<T>(
    token: string,
    org: string,
    project: string,
    permission: Permission,
    fn: (c: pg.PoolClient, p: Principal, a: Authority) => Promise<T>,
  ) {
    if (!this.#auth) deny("NODE_USER_API_UNAVAILABLE", 503);
    return this.#auth.guardResource(
      token,
      org,
      permission,
      { kind: "project", id: z.uuid().parse(project) },
      (p, a) =>
        this.#tx(org, async (c) => {
          if (p.user.account_type !== "adult") deny("NODE_ADULT_ONLY", 403);
          return fn(c, p, a);
        }),
    );
  }
  async #locate(token: string, org: string, id: string) {
    if (!this.#auth) deny("NODE_USER_API_UNAVAILABLE", 503);
    z.uuid().parse(id);
    return this.#auth.guardOrganization(token, org, "organization:read", () =>
      this.#tx(org, async (c) => {
        const r = (
          await c.query<NodeRow>(`${selectNode} and n.id=$2`, [org, id])
        ).rows[0];
        if (!r) deny("NOT_FOUND", 404);
        return r;
      }),
    );
  }
  async #row(c: pg.PoolClient, org: string, id: string) {
    const row = (
      await c.query<NodeRow>(`${selectNode} and n.id=$2 for update of n`, [
        org,
        id,
      ])
    ).rows[0];
    if (!row) deny("NOT_FOUND", 404);
    return row;
  }
  #view(row: NodeRow, a: Authority) {
    const scope = { kind: "project" as const, id: row.project_id };
    return nodeView.parse({
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      state: row.state,
      version: row.version,
      credential_version: row.credential_version,
      enrollment_expires_at: row.enrollment_expires_at.toISOString(),
      credential_expires_at: row.credential_expires_at.toISOString(),
      last_seen_at: row.last_seen_at?.toISOString() ?? null,
      connection:
        row.state === "revoked"
          ? "revoked"
          : row.state === "enrolling"
            ? "awaiting_enrollment"
            : row.credential_expires_at.getTime() <= this.#now()
              ? "credential_expired"
              : row.last_seen_at &&
                  this.#now() - row.last_seen_at.getTime() <= 30000
                ? "online"
                : "offline",
      capacity: row.capacity ? nodeCapacity.parse(row.capacity) : null,
      can_rotate: row.state === "active" && canAccess(a, "node:rotate", scope),
      can_revoke: row.state !== "revoked" && canAccess(a, "node:revoke", scope),
      control_public_key: this.#public,
    });
  }
  #op(row: OpRow) {
    return nodeOperationView.parse({
      resource_type: "node",
      id: row.id,
      node_id: row.node_id,
      project_id: row.project_id,
      kind: row.kind,
      state: "succeeded",
      created_at: row.created_at.toISOString(),
    });
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
    const r = (
      await c.query<OpRow>(
        "select * from minecraft_node_operations where organization_id=$1 and actor_id=$2 and kind=$3 and request_key=$4",
        [org, actor, kind, key],
      )
    ).rows[0];
    if (r && r.request_hash !== nodeDigest(input)) deny("IDEMPOTENCY_CONFLICT");
    return r;
  }
  async #record(
    c: pg.PoolClient,
    org: string,
    project: string,
    node: string,
    p: Principal,
    kind: string,
    key: string,
    input: unknown,
    requestId?: string,
  ) {
    const count = (
      await c.query<{ total: number; recent: number }>(
        "select count(*)::int total,count(*) filter(where actor_id=$3 and created_at>$4)::int recent from minecraft_node_operations where organization_id=$1 and project_id=$2 and created_at>$5",
        [
          org,
          project,
          p.user.id,
          new Date(this.#now() - 60000),
          new Date(this.#now() - 86400000),
        ],
      )
    ).rows[0];
    if (!count || count.total >= 10000 || count.recent >= 12)
      deny("NODE_OPERATION_LIMIT", 429);
    const id = randomUUID(),
      now = new Date(this.#now());
    await c.query(
      "insert into minecraft_node_operations(id,organization_id,project_id,node_id,actor_id,session_id,kind,request_key,request_hash,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        org,
        project,
        node,
        p.user.id,
        p.sessionId,
        kind,
        key,
        nodeDigest(input),
        now,
      ],
    );
    await c.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,$2,$3,$4,'allowed',$5)",
      [
        org,
        p.user.id,
        `node.${kind}`,
        node,
        { operation_id: id, ...(requestId ? { request_id: requestId } : {}) },
      ],
    );
    await c.query(
      "insert into minecraft_node_outbox(id,organization_id,operation_id,created_at) values($1,$2,$3,$4)",
      [randomUUID(), org, id, now],
    );
    return nodeOperationAccepted.parse({ operation_id: id, node_id: node });
  }
  async #credential(
    c: pg.PoolClient,
    org: string,
    id: string,
    version: number,
    key: string,
    fingerprint: string,
  ) {
    publicKey(key);
    const now = new Date(this.#now());
    try {
      await c.query(
        "insert into minecraft_node_credentials(organization_id,node_id,version,public_key,certificate_sha256,created_at,expires_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          org,
          id,
          version,
          key,
          fingerprint,
          now,
          new Date(now.getTime() + 86400000),
        ],
      );
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "23505")
        deny("NODE_CREDENTIAL_ALREADY_USED");
      throw e;
    }
  }
  async enroll(
    token: string,
    org: string,
    input: unknown,
    key: string,
    requestId?: string,
  ) {
    const v = nodeEnrollmentRequest.parse(input);
    if (!this.#public) deny("NODE_CONTROL_NOT_CONFIGURED", 503);
    publicKey(v.public_key);
    return this.#scope(
      token,
      org,
      v.project_id,
      "node:enroll",
      async (c, p) => {
        const old = await this.#replay(c, org, p.user.id, "enroll", key, v);
        if (old)
          return nodeOperationAccepted.parse({
            operation_id: old.id,
            node_id: old.node_id,
          });
        const count = (
          await c.query<{ n: number }>(
            "select count(*)::int n from minecraft_nodes where organization_id=$1 and project_id=$2 and (state='active' or (state='enrolling' and enrollment_expires_at>$3))",
            [org, v.project_id, new Date(this.#now())],
          )
        ).rows[0];
        if (!count || count.n >= 100) deny("NODE_LIMIT", 429);
        const id = randomUUID(),
          now = new Date(this.#now());
        await c.query(
          "insert into minecraft_nodes(id,organization_id,project_id,name,state,enrollment_expires_at,enrolled_by,created_at) values($1,$2,$3,$4,'enrolling',$5,$6,$7)",
          [
            id,
            org,
            v.project_id,
            v.name,
            new Date(now.getTime() + 300000),
            p.user.id,
            now,
          ],
        );
        await this.#credential(
          c,
          org,
          id,
          1,
          v.public_key,
          v.certificate_sha256,
        );
        return this.#record(
          c,
          org,
          v.project_id,
          id,
          p,
          "enroll",
          key,
          v,
          requestId,
        );
      },
    );
  }
  async list(token: string, org: string, project: string, cursor?: string) {
    return this.#scope(token, org, project, "node:read", async (c, _p, a) => {
      let boundary: Date | null = null;
      if (cursor) {
        z.uuid().parse(cursor);
        const row = (
          await c.query<{ created_at: Date }>(
            "select created_at from minecraft_nodes where organization_id=$1 and project_id=$2 and id=$3",
            [org, project, cursor],
          )
        ).rows[0];
        if (!row) deny("NOT_FOUND", 404);
        boundary = row.created_at;
      }
      const rows = (
        await c.query<NodeRow>(
          `${selectNode} and n.project_id=$2 and ($3::timestamptz is null or (n.created_at,n.id)<($3,$4::uuid)) order by n.created_at desc,n.id desc limit 51`,
          [org, project, boundary, cursor ?? null],
        )
      ).rows;
      return nodePage.parse({
        items: rows.slice(0, 50).map((r) => this.#view(r, a)),
        next_cursor: rows.length > 50 ? (rows[49]?.id ?? null) : null,
      });
    });
  }
  async get(token: string, org: string, id: string) {
    const row = await this.#locate(token, org, id);
    return this.#scope(
      token,
      org,
      row.project_id,
      "node:read",
      async (c, _p, a) => this.#view(await this.#row(c, org, id), a),
    );
  }
  async change(
    token: string,
    org: string,
    id: string,
    kind: "rotate" | "revoke",
    input: unknown,
    key: string,
    requestId?: string,
  ) {
    const v =
      kind === "rotate"
        ? nodeRotationRequest.parse(input)
        : z
            .strictObject({ expected_version: z.number().int().positive() })
            .parse(input);
    const row = await this.#locate(token, org, id),
      body = { node_id: id, ...v };
    return this.#scope(
      token,
      org,
      row.project_id,
      kind === "rotate" ? "node:rotate" : "node:revoke",
      async (c, p) => {
        const old = await this.#replay(c, org, p.user.id, kind, key, body);
        if (old)
          return nodeOperationAccepted.parse({
            operation_id: old.id,
            node_id: old.node_id,
          });
        const current = await this.#row(c, org, id);
        if (
          current.version !== v.expected_version ||
          current.state === "revoked" ||
          (kind === "rotate" && current.state !== "active")
        )
          deny("NODE_VERSION_CONFLICT");
        if (kind === "revoke")
          await c.query(
            "update minecraft_nodes set state='revoked',version=version+1,capacity=null where organization_id=$1 and id=$2",
            [org, id],
          );
        else {
          const rotation = nodeRotationRequest.parse(v);
          await this.#credential(
            c,
            org,
            id,
            current.credential_version + 1,
            rotation.public_key,
            rotation.certificate_sha256,
          );
          await c.query(
            "update minecraft_nodes set credential_version=credential_version+1,version=version+1,last_sequence=0,last_seen_at=null,capacity=null where organization_id=$1 and id=$2",
            [org, id],
          );
        }
        return this.#record(
          c,
          org,
          row.project_id,
          id,
          p,
          kind,
          key,
          body,
          requestId,
        );
      },
    );
  }
  async operation(token: string, org: string, id: string) {
    if (!this.#auth) deny("NODE_USER_API_UNAVAILABLE", 503);
    z.uuid().parse(id);
    const located = await this.#auth.guardOrganization(
      token,
      org,
      "organization:read",
      () =>
        this.#tx(org, async (c) => {
          const r = (
            await c.query<OpRow>(
              "select * from minecraft_node_operations where organization_id=$1 and id=$2",
              [org, id],
            )
          ).rows[0];
          if (!r) deny("NOT_FOUND", 404);
          return r;
        }),
    );
    return this.#scope(token, org, located.project_id, "node:read", async () =>
      this.#op(located),
    );
  }
  /** Only a TLS adapter may supply peer identity; HTTP headers/cookies never do. */
  async exchange(
    input: unknown,
    peer: { certificate_sha256: string; certificate_expires_at: number },
  ) {
    if (!this.#private || !this.#public)
      deny("NODE_CONTROL_NOT_CONFIGURED", 503);
    const signed = signedNodeRequest.parse(input),
      v = signed.payload;
    try {
      assertNodeTime(v.issued_at, v.expires_at, this.#now());
    } catch {
      deny("NODE_PROOF_EXPIRED", 401);
    }
    if (
      v.control_id !== nodeDigest(this.#public) ||
      !Number.isFinite(peer.certificate_expires_at) ||
      peer.certificate_expires_at <= this.#now()
    )
      deny("NODE_CREDENTIAL_DENIED", 401);
    return this.#tx(v.organization_id, async (c) => {
      const row = await this.#row(c, v.organization_id, v.node_id).catch(() =>
        deny("NODE_CREDENTIAL_DENIED", 401),
      );
      if (
        row.certificate_sha256 !== peer.certificate_sha256 ||
        row.credential_version !== v.credential_version ||
        row.credential_expires_at.getTime() <= this.#now() ||
        !verifyNodeValue(v, signed.signature, row.public_key) ||
        row.state === "revoked"
      )
        deny("NODE_CREDENTIAL_DENIED", 401);
      if (v.purpose === "node.enroll.v1") {
        if (row.state === "active") deny("NODE_ALREADY_ENROLLED");
        if (
          row.state !== "enrolling" ||
          row.enrollment_expires_at.getTime() <= this.#now()
        )
          deny("NODE_ENROLLMENT_EXPIRED", 401);
        await c.query(
          "update minecraft_nodes set state='active',version=version+1,last_seen_at=$3 where organization_id=$1 and id=$2",
          [v.organization_id, v.node_id, new Date(this.#now())],
        );
        await c.query(
          "insert into audit_events(organization_id,actor_id,action,target_id,outcome,details) values($1,null,'node.enrolled',$2,'allowed',$3)",
          [
            v.organization_id,
            v.node_id,
            {
              service_actor: v.node_id,
              credential_version: String(v.credential_version),
            },
          ],
        );
      } else {
        if (row.state !== "active" || v.sequence <= row.last_sequence)
          deny("NODE_REPLAY_DENIED", 401);
        if (
          v.capacity &&
          (Date.parse(v.capacity.observed_at) > this.#now() + 5000 ||
            Date.parse(v.capacity.observed_at) < this.#now() - 30000)
        )
          deny("NODE_CAPACITY_STALE", 400);
        await c.query(
          "update minecraft_nodes set last_sequence=$3,last_seen_at=$4,capacity=$5 where organization_id=$1 and id=$2",
          [
            v.organization_id,
            v.node_id,
            v.sequence,
            new Date(this.#now()),
            v.capacity,
          ],
        );
      }
      const payload = {
        schema_version: 1,
        purpose: "node.ack.v1",
        control_id: v.control_id,
        organization_id: v.organization_id,
        node_id: v.node_id,
        credential_version: v.credential_version,
        sequence: v.sequence,
        request_hash: nodeDigest(v),
        issued_at: new Date(this.#now()).toISOString(),
        expires_at: new Date(this.#now() + 30000).toISOString(),
        credential_expires_at: row.credential_expires_at.toISOString(),
        state: "active",
        capabilities: ["inventory.read"],
      };
      return signedNodeResponse.parse({
        payload,
        signature: signNodeValue(payload, this.#private ?? ""),
      });
    });
  }
}
