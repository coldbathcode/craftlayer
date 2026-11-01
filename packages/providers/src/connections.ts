import { randomUUID } from "node:crypto";
import {
  AuthError,
  type IdentityService,
  type Principal,
} from "@craftlayer/auth";
import {
  connectionCreateSchema,
  connectionSchema,
} from "@craftlayer/contracts";
import pg from "pg";
import { z } from "zod";
import { openCredential, sealCredential } from "./credentials.js";
import { ProviderError } from "./index.js";
import type { InstancePolicy, ProviderFiles } from "./instance.js";

export interface ConnectionRow {
  id: string;
  organization_id: string;
  kind: "ollama" | "openrouter";
  endpoint_id: string;
  label: string;
  enabled: boolean;
  version: number;
  credential_version: number;
  key_id: string | null;
  credential_payload: Buffer | null;
}
export interface ConnectionOptions {
  databaseUrl: string;
  auth: IdentityService;
  files: ProviderFiles;
  clock?: () => number;
}
export class ConnectionService {
  #pool: pg.Pool;
  protected readonly auth: IdentityService;
  protected readonly files: ProviderFiles;
  protected readonly now: () => number;
  constructor(options: ConnectionOptions) {
    if (new URL(options.databaseUrl).username !== "craftlayer_runtime")
      throw new Error("Restricted runtime role required");
    this.#pool = new pg.Pool({
      connectionString: options.databaseUrl,
      max: 5,
      statement_timeout: 5000,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    });
    this.auth = options.auth;
    this.files = options.files;
    this.now = options.clock ?? Date.now;
  }
  async close() {
    await this.#pool.end();
  }
  protected async tx<T>(
    org: string,
    operation: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    z.uuid().parse(org);
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.organization_id',$1,true)", [
        org,
      ]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  protected async admin<T>(
    token: string,
    org: string,
    operation: (client: pg.PoolClient, principal: Principal) => Promise<T>,
  ): Promise<T> {
    return this.auth.guardOrganization(token, org, "provider:manage", (p) =>
      this.tx(org, (c) => operation(c, p)),
    );
  }
  protected project(row: ConnectionRow) {
    return connectionSchema.parse({
      id: row.id,
      kind: row.kind,
      endpoint_id: row.endpoint_id,
      label: row.label,
      enabled: row.enabled,
      version: row.version,
      credential_configured: row.credential_payload !== null,
      key_id: row.key_id,
    });
  }
  protected async row(
    client: pg.PoolClient,
    org: string,
    id: string,
    write = false,
  ): Promise<ConnectionRow> {
    if (!z.uuid().safeParse(id).success)
      throw new ProviderError("policy_denied", false);
    const row = (
      await client.query<ConnectionRow>(
        `select * from provider_connections where organization_id=$1 and id=$2${write ? " for update" : ""}`,
        [org, id],
      )
    ).rows[0];
    if (!row) throw new AuthError(404, "NOT_FOUND", "Connection not found.");
    return row;
  }
  protected endpoint(
    row: Pick<ConnectionRow, "kind" | "endpoint_id">,
    policy: InstancePolicy,
  ) {
    if (row.kind === "openrouter") {
      if (!policy.openrouter_enabled || row.endpoint_id !== "openrouter")
        throw new ProviderError("policy_denied", false);
      return null;
    }
    const endpoint = policy.ollama.find((e) => e.id === row.endpoint_id);
    if (!endpoint) throw new ProviderError("policy_denied", false);
    return endpoint;
  }
  protected async audit(
    client: pg.PoolClient,
    org: string,
    actor: string,
    action: string,
    target: string,
  ) {
    await client.query(
      "insert into audit_events(organization_id,actor_id,action,target_id,outcome) values($1,$2,$3,$4,'allowed')",
      [org, actor, action, target],
    );
  }
  async listConnections(token: string, org: string) {
    return this.admin(token, org, async (client) =>
      (
        await client.query<ConnectionRow>(
          "select * from provider_connections where organization_id=$1 order by created_at,id limit 100",
          [org],
        )
      ).rows.map((r) => this.project(r)),
    );
  }
  async createConnection(
    token: string,
    org: string,
    input: z.infer<typeof connectionCreateSchema>,
  ) {
    await this.auth.authorize(token, org, "provider:manage", {
      kind: "organization",
      id: org,
    });
    const value = connectionCreateSchema.parse(input),
      policy = await this.files.policy();
    this.endpoint(value, policy);
    if ((value.kind === "openrouter") !== Boolean(value.secret))
      throw new ProviderError("policy_denied", false);
    const id = randomUUID(),
      sealed = value.secret
        ? sealCredential(await this.files.keys(), org, id, 1, value.secret)
        : null;
    return this.admin(token, org, async (client, p) => {
      // Re-read protected configuration after authority acquisition, before state change.
      this.endpoint(value, await this.files.policy());
      await client.query(
        "insert into provider_connections(id,organization_id,kind,endpoint_id,label,credential_version,key_id,credential_payload) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          org,
          value.kind,
          value.endpoint_id,
          value.label,
          sealed ? 1 : 0,
          sealed?.key_id ?? null,
          sealed?.payload ?? null,
        ],
      );
      await this.audit(client, org, p.user.id, "provider.created", id);
      return this.project(await this.row(client, org, id));
    });
  }
  async setEnabled(
    token: string,
    org: string,
    id: string,
    version: number,
    enabled: boolean,
  ) {
    return this.admin(token, org, async (client, p) => {
      const row = await this.row(client, org, id, true);
      this.assertVersion(row, version);
      if (enabled) this.endpoint(row, await this.files.policy());
      await client.query(
        "update provider_connections set enabled=$3,version=version+1 where organization_id=$1 and id=$2",
        [org, id, enabled],
      );
      await client.query(
        "delete from model_snapshots where organization_id=$1 and connection_id=$2",
        [org, id],
      );
      await this.audit(client, org, p.user.id, "provider.status_changed", id);
      return this.project(await this.row(client, org, id));
    });
  }
  protected assertVersion(row: ConnectionRow, version: number) {
    if (row.version !== version)
      throw new AuthError(
        409,
        "PROVIDER_VERSION_CONFLICT",
        "Refresh the connection and try again.",
      );
  }
  async changeCredential(
    token: string,
    org: string,
    id: string,
    version: number,
    secret: string | null,
    rewrap = false,
  ) {
    return this.admin(token, org, async (client, p) => {
      const row = await this.row(client, org, id, true);
      this.assertVersion(row, version);
      if (row.kind !== "openrouter")
        throw new ProviderError("policy_denied", false);
      const ring = secret !== null || rewrap ? await this.files.keys() : null;
      let next = secret;
      if (rewrap) {
        if (!ring || !row.key_id || !row.credential_payload)
          throw new ProviderError("auth", false);
        next = openCredential(
          ring,
          org,
          id,
          row.credential_version,
          row.key_id,
          row.credential_payload,
        );
      }
      const nextVersion = row.credential_version + 1,
        sealed =
          next && ring
            ? sealCredential(ring, org, id, nextVersion, next)
            : null;
      await client.query(
        "update provider_connections set credential_payload=$3,key_id=$4,credential_version=$5,enabled=case when $3::bytea is null then false else enabled end,version=version+1 where organization_id=$1 and id=$2",
        [
          org,
          id,
          sealed?.payload ?? null,
          sealed?.key_id ?? null,
          sealed ? nextVersion : 0,
        ],
      );
      await client.query(
        "delete from model_snapshots where organization_id=$1 and connection_id=$2",
        [org, id],
      );
      await this.audit(
        client,
        org,
        p.user.id,
        rewrap
          ? "provider.key_rewrapped"
          : next
            ? "provider.credential_changed"
            : "provider.credential_revoked",
        id,
      );
      return this.project(await this.row(client, org, id));
    });
  }
}
