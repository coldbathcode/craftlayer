import { AuthError } from "@craftlayer/auth";
import {
  defaultModelPolicy,
  type ModelPolicy,
  modelPolicySchema,
  modelSchema,
} from "@craftlayer/contracts";
import type pg from "pg";
import {
  type ConnectionOptions,
  type ConnectionRow,
  ConnectionService,
} from "./connections.js";
import { openCredential } from "./credentials.js";
import { type ModelProvider, ProviderError } from "./index.js";
import type { InstancePolicy } from "./instance.js";
import { OllamaProvider } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";

export type ScopeKind = "organization" | "user" | "project";
export interface GatewayOptions extends ConnectionOptions {
  providerFactory?: (
    connection: ConnectionRow,
    policy: InstancePolicy,
    secret?: string,
  ) => ModelProvider;
}
export class GatewayControl extends ConnectionService {
  private factory: GatewayOptions["providerFactory"];
  constructor(options: GatewayOptions) {
    super(options);
    this.factory = options.providerFactory;
  }
  protected async adapter(
    row: ConnectionRow,
    policy: InstancePolicy,
    generation = false,
  ): Promise<ModelProvider> {
    const endpoint = this.endpoint(row, policy);
    let secret: string | undefined;
    if (generation && row.kind === "openrouter") {
      if (!row.credential_payload || !row.key_id)
        throw new ProviderError("auth", false);
      secret = openCredential(
        await this.files.keys(),
        row.organization_id,
        row.id,
        row.credential_version,
        row.key_id,
        row.credential_payload,
      );
    }
    if (this.factory) return this.factory(row, policy, secret);
    if (row.kind === "ollama" && endpoint)
      return new OllamaProvider(endpoint, undefined, this.now);
    return new OpenRouterProvider(
      secret,
      policy.openrouter_models,
      undefined,
      this.now,
    );
  }
  async listModels(token: string, org: string, id: string) {
    return this.admin(token, org, async (client) => {
      const row = await this.row(client, org, id);
      return (
        await client.query<{ descriptor: unknown }>(
          "select descriptor from model_snapshots where organization_id=$1 and connection_id=$2 and connection_version=$3 order by model_id limit 100",
          [org, id, row.version],
        )
      ).rows.map((row) => modelSchema.parse(row.descriptor));
    });
  }
  async refreshModels(token: string, org: string, id: string) {
    const state = await this.admin(token, org, async (client) => {
      const row = await this.row(client, org, id, true);
      if (!row.enabled) throw new ProviderError("policy_denied", false);
      const last = (
        await client.query<{ catalog_requested_at: Date | null }>(
          "select catalog_requested_at from provider_connections where organization_id=$1 and id=$2",
          [org, id],
        )
      ).rows[0]?.catalog_requested_at;
      if (last && this.now() - last.getTime() < 5000)
        throw new ProviderError("rate_limited", false, 5000);
      await client.query(
        "update provider_connections set catalog_requested_at=$3 where organization_id=$1 and id=$2",
        [org, id, new Date(this.now())],
      );
      return row;
    });
    const policy = await this.files.policy(),
      stamp = await this.files.stamp(),
      adapter = await this.adapter(state, policy);
    const models = (await adapter.discover(AbortSignal.timeout(4000))).map(
      (m) => modelSchema.parse(m),
    );
    const approved =
      state.kind === "ollama"
        ? (this.endpoint(state, policy)?.models ?? [])
        : policy.openrouter_models;
    if (
      models.length > 32 ||
      models.some(
        (m) =>
          !approved.includes(m.id) ||
          m.provider !== state.kind ||
          m.classification !==
            (state.kind === "ollama" ? "operator_local" : "hosted"),
      )
    )
      throw new ProviderError("malformed_response", false);
    return this.admin(token, org, async (client, p) => {
      const row = await this.row(client, org, id, true);
      this.assertVersion(row, state.version);
      if (!row.enabled || (await this.files.stamp()) !== stamp)
        throw new ProviderError("policy_denied", false);
      await client.query(
        "delete from model_snapshots where organization_id=$1 and connection_id=$2",
        [org, id],
      );
      for (const model of models)
        await client.query(
          "insert into model_snapshots(organization_id,connection_id,connection_version,model_id,descriptor,fetched_at,expires_at) values($1,$2,$3,$4,$5::jsonb,$6,$7)",
          [
            org,
            id,
            row.version,
            model.id,
            JSON.stringify(model),
            new Date(model.pricing.observed_at),
            new Date(model.pricing.expires_at),
          ],
        );
      await this.audit(
        client,
        org,
        p.user.id,
        "provider.catalog_refreshed",
        id,
      );
      return models;
    });
  }
  protected async scope(
    client: pg.PoolClient,
    org: string,
    kind: ScopeKind,
    id: string,
  ) {
    const valid =
      kind === "organization"
        ? id === org
        : kind === "project"
          ? (
              await client.query(
                "select 1 from projects where organization_id=$1 and id=$2",
                [org, id],
              )
            ).rowCount
          : (
              await client.query(
                "select 1 from memberships where organization_id=$1 and user_id=$2",
                [org, id],
              )
            ).rowCount;
    if (!valid)
      throw new AuthError(404, "NOT_FOUND", "Policy scope not found.");
  }
  protected async policyLock(client: pg.PoolClient, org: string) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1,74618004))",
      [org],
    );
  }
  async getPolicy(token: string, org: string, kind: ScopeKind, id: string) {
    return this.auth.guardOrganization(token, org, "budget:manage", () =>
      this.tx(org, async (client) => {
        await this.scope(client, org, kind, id);
        const row = (
          await client.query<{ version: number; policy: unknown }>(
            "select version,policy from provider_scope_policies where organization_id=$1 and scope_kind=$2 and scope_id=$3",
            [org, kind, id],
          )
        ).rows[0];
        return {
          version: row?.version ?? 0,
          policy: modelPolicySchema.parse(row?.policy ?? defaultModelPolicy),
        };
      }),
    );
  }
  async setPolicy(
    token: string,
    org: string,
    kind: ScopeKind,
    id: string,
    version: number,
    input: ModelPolicy,
  ) {
    const policy = modelPolicySchema.parse(input);
    return this.auth.guardOrganization(token, org, "budget:manage", (p) =>
      this.tx(org, async (client) => {
        await this.policyLock(client, org);
        await this.scope(client, org, kind, id);
        const row = (
          await client.query<{ version: number }>(
            "select version from provider_scope_policies where organization_id=$1 and scope_kind=$2 and scope_id=$3 for update",
            [org, kind, id],
          )
        ).rows[0];
        if ((row?.version ?? 0) !== version)
          throw new AuthError(
            409,
            "PROVIDER_VERSION_CONFLICT",
            "Refresh policy and try again.",
          );
        await client.query(
          "insert into provider_scope_policies(organization_id,scope_kind,scope_id,version,policy) values($1,$2,$3,1,$4::jsonb) on conflict(organization_id,scope_kind,scope_id) do update set version=provider_scope_policies.version+1,policy=excluded.policy",
          [org, kind, id, JSON.stringify(policy)],
        );
        await client.query(
          "insert into provider_routing_state(organization_id) values($1) on conflict(organization_id) do update set version=provider_routing_state.version+1",
          [org],
        );
        await this.audit(client, org, p.user.id, "provider.policy_changed", id);
        return { version: version + 1, policy };
      }),
    );
  }
  async stopStatus(token: string, org: string) {
    return this.auth.guardOrganization(token, org, "organization:read", () =>
      this.tx(org, async (client) => ({
        stopped:
          (
            await client.query<{ stopped: boolean }>(
              "select stopped from provider_routing_state where organization_id=$1",
              [org],
            )
          ).rows[0]?.stopped ?? false,
        instance_stopped: (await this.files.policy()).stopped,
      })),
    );
  }
  async setStopped(token: string, org: string, stopped: boolean) {
    return this.auth.guardOrganization(
      token,
      org,
      stopped ? "stop:request" : "stop:clear",
      (p) =>
        this.tx(org, async (client) => {
          await this.policyLock(client, org);
          await client.query(
            "insert into provider_routing_state(organization_id,stopped) values($1,$2) on conflict(organization_id) do update set stopped=excluded.stopped,version=provider_routing_state.version+1",
            [org, stopped],
          );
          await this.audit(
            client,
            org,
            p.user.id,
            stopped ? "provider.stop_requested" : "provider.stop_cleared",
            org,
          );
          return { ok: true as const };
        }),
    );
  }
  protected async recordCooldown(org: string, id: string, delay: number) {
    const bounded = Math.min(300000, Math.max(1000, Math.trunc(delay)));
    await this.tx(org, (c) =>
      c.query(
        "insert into provider_cooldowns(organization_id,connection_id,retry_at) values($1,$2,$3) on conflict(organization_id,connection_id) do update set retry_at=greatest(provider_cooldowns.retry_at,excluded.retry_at)",
        [org, id, new Date(this.now() + bounded)],
      ),
    );
  }
}
