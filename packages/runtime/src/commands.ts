import { randomUUID } from "node:crypto";
import {
  agentCreate,
  agentView,
  graphSchema,
  groupCreate,
  groupView,
  missionCreate,
  templateCreate,
  templateView,
} from "@craftlayer/contracts";
import { validateDag } from "@craftlayer/core";
import { z } from "zod";
import { deny, digest, RuntimeRepository } from "./repository.js";

export class RuntimeCommands extends RuntimeRepository {
  async createAgent(token: string, org: string, input: unknown) {
    const v = agentCreate.parse(input);
    return this.scoped(
      token,
      org,
      v.environment_id,
      "agent:assign",
      async (c, p, e) => {
        const id = randomUUID();
        await c.query(
          "insert into runtime_agents(id,organization_id,project_id,environment_id,name,adapter) values($1,$2,$3,$4,$5,'simulation')",
          [id, org, e.project_id, e.id, v.name],
        );
        await this.audit(c, org, p.user.id, "runtime.agent_created", id);
        return agentView.parse({
          id,
          project_id: e.project_id,
          environment_id: e.id,
          name: v.name,
          adapter: "simulation",
          state: "idle",
          version: 1,
        });
      },
    );
  }
  async listAgents(token: string, org: string, environment: string) {
    return this.scoped(token, org, environment, "agent:read", async (c) =>
      (
        await c.query(
          "select id,project_id,environment_id,name,adapter,state,version from runtime_agents where organization_id=$1 and environment_id=$2 order by id limit 100",
          [org, environment],
        )
      ).rows.map((r) => agentView.parse(r)),
    );
  }
  async setAgentEnabled(
    token: string,
    org: string,
    id: string,
    expected: number,
    enabled: boolean,
  ) {
    const row = await this.member(token, org, () =>
      this.tx(
        org,
        async (c) =>
          (
            await c.query<{ environment_id: string }>(
              "select environment_id from runtime_agents where organization_id=$1 and id=$2",
              [org, z.uuid().parse(id)],
            )
          ).rows[0],
      ),
    );
    if (!row) deny("NOT_FOUND", 404);
    return this.scoped(
      token,
      org,
      row.environment_id,
      "agent:assign",
      async (c, p) => {
        const agent = (
          await c.query(
            "select id,project_id,environment_id,name,adapter,state,version from runtime_agents where organization_id=$1 and id=$2 for update",
            [org, id],
          )
        ).rows[0];
        this.version(agent, expected);
        if (
          (
            await c.query(
              "select id from runtime_attempts where organization_id=$1 and agent_id=$2 and state in ('leased','running','uncertain','cancel_requested')",
              [org, id],
            )
          ).rowCount
        )
          deny("AGENT_ACTIVE");
        const next = (
          await c.query(
            "update runtime_agents set state=$3,version=version+1 where organization_id=$1 and id=$2 returning id,project_id,environment_id,name,adapter,state,version",
            [org, id, enabled ? "idle" : "disabled"],
          )
        ).rows[0];
        await this.audit(c, org, p.user.id, "runtime.agent_status", id);
        return agentView.parse(next);
      },
    );
  }
  async createGroup(token: string, org: string, input: unknown) {
    const v = groupCreate.parse(input);
    if (new Set(v.agent_ids).size !== v.agent_ids.length)
      deny("DUPLICATE_AGENT", 400);
    return this.scoped(
      token,
      org,
      v.environment_id,
      "group:manage",
      async (c, p, e) => {
        const agents = (
          await c.query<{ id: string }>(
            "select id from runtime_agents where organization_id=$1 and environment_id=$2 and id=any($3::uuid[]) and state<>'disabled' for share",
            [org, e.id, v.agent_ids],
          )
        ).rows;
        if (agents.length !== v.agent_ids.length) deny("NOT_FOUND", 404);
        const id = randomUUID();
        await c.query(
          "insert into runtime_groups(id,organization_id,project_id,environment_id,name) values($1,$2,$3,$4,$5)",
          [id, org, e.project_id, e.id, v.name],
        );
        for (const agent of v.agent_ids)
          await c.query(
            "insert into runtime_group_agents(organization_id,project_id,environment_id,group_id,agent_id) values($1,$2,$3,$4,$5)",
            [org, e.project_id, e.id, id, agent],
          );
        await this.audit(c, org, p.user.id, "runtime.group_created", id);
        return groupView.parse({
          id,
          project_id: e.project_id,
          environment_id: e.id,
          name: v.name,
          agent_ids: v.agent_ids,
          version: 1,
        });
      },
    );
  }
  async listGroups(token: string, org: string, environment: string) {
    return this.scoped(token, org, environment, "agent:read", async (c) =>
      (
        await c.query(
          "select g.id,g.project_id,g.environment_id,g.name,g.version,array_agg(a.agent_id order by a.agent_id) as agent_ids from runtime_groups g join runtime_group_agents a on a.organization_id=g.organization_id and a.group_id=g.id where g.organization_id=$1 and g.environment_id=$2 group by g.id order by g.id limit 100",
          [org, environment],
        )
      ).rows.map((r) => groupView.parse(r)),
    );
  }
  async createTemplate(token: string, org: string, input: unknown) {
    const v = templateCreate.parse(input);
    try {
      validateDag(v.graph.nodes);
    } catch {
      deny("INVALID_GRAPH", 400);
    }
    return this.scoped(
      token,
      org,
      v.environment_id,
      "template:write",
      async (c, p, e) => {
        let family: string = randomUUID(),
          version = 1;
        if (v.supersedes) {
          const old = (
            await c.query<{ family_id: string; version: number }>(
              "select family_id,version from runtime_templates where organization_id=$1 and environment_id=$2 and id=$3",
              [org, e.id, v.supersedes],
            )
          ).rows[0];
          if (!old) deny("NOT_FOUND", 404);
          family = old.family_id;
          version =
            (
              await c.query<{ version: number }>(
                "select max(version)::int as version from runtime_templates where organization_id=$1 and family_id=$2",
                [org, family],
              )
            ).rows[0]?.version ?? old.version;
          version++;
        }
        const id = randomUUID(),
          hash = digest(v.graph);
        await c.query(
          "insert into runtime_templates(id,organization_id,project_id,environment_id,family_id,version,name,adapter,hash,graph,created_by) values($1,$2,$3,$4,$5,$6,$7,'simulation',$8,$9,$10)",
          [
            id,
            org,
            e.project_id,
            e.id,
            family,
            version,
            v.name,
            hash,
            v.graph,
            p.user.id,
          ],
        );
        await this.audit(c, org, p.user.id, "runtime.template_created", id);
        return templateView.parse({
          id,
          family_id: family,
          version,
          name: v.name,
          adapter: v.adapter,
          hash,
          graph: v.graph,
        });
      },
    );
  }
  async listTemplates(token: string, org: string, environment: string) {
    return this.scoped(token, org, environment, "mission:read", async (c) =>
      (
        await c.query(
          "select id,family_id,version,name,adapter,hash,graph from runtime_templates where organization_id=$1 and environment_id=$2 order by family_id,version desc limit 100",
          [org, environment],
        )
      ).rows.map((r) => templateView.parse(r)),
    );
  }
  async createMission(token: string, org: string, key: string, input: unknown) {
    const v = missionCreate.parse(input),
      group = await this.member(token, org, () =>
        this.tx(
          org,
          async (c) =>
            (
              await c.query<{ environment_id: string }>(
                "select environment_id from runtime_groups where organization_id=$1 and id=$2",
                [org, v.group_id],
              )
            ).rows[0],
        ),
      );
    if (!group) deny("NOT_FOUND", 404);
    return this.scoped(
      token,
      org,
      group.environment_id,
      "mission:create",
      (c, p, e) =>
        this.idempotent(
          c,
          org,
          p.user.id,
          "mission.create",
          key,
          v,
          async () => {
            const template = (
              await c.query<{ graph: unknown; hash: string }>(
                "select graph,hash from runtime_templates where organization_id=$1 and environment_id=$2 and id=$3",
                [org, e.id, v.template_id],
              )
            ).rows[0];
            if (!template) deny("NOT_FOUND", 404);
            const graph = graphSchema.parse(template.graph);
            try {
              validateDag(graph.nodes);
            } catch {
              deny("INVALID_GRAPH", 400);
            }
            if (digest(graph) !== template.hash) deny("SNAPSHOT_INVALID", 403);
            const id = randomUUID();
            await c.query(
              "insert into runtime_missions(id,organization_id,project_id,environment_id,group_id,template_id,name,template_hash,snapshot,created_by,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
              [
                id,
                org,
                e.project_id,
                e.id,
                v.group_id,
                v.template_id,
                v.name,
                template.hash,
                graph,
                p.user.id,
                new Date(this.now()),
              ],
            );
            const ids = new Map(graph.nodes.map((n) => [n.key, randomUUID()]));
            for (const node of graph.nodes)
              await c.query(
                "insert into runtime_tasks(id,organization_id,mission_id,node_key,definition,required,next_attempt_at) values($1,$2,$3,$4,$5,$6,$7)",
                [
                  ids.get(node.key),
                  org,
                  id,
                  node.key,
                  node,
                  node.required,
                  new Date(this.now()),
                ],
              );
            for (const node of graph.nodes)
              for (const edge of node.dependencies)
                await c.query(
                  "insert into runtime_dependencies(organization_id,mission_id,task_id,prerequisite_id,required) values($1,$2,$3,$4,$5)",
                  [
                    org,
                    id,
                    ids.get(node.key),
                    ids.get(edge.key),
                    edge.required,
                  ],
                );
            await this.audit(c, org, p.user.id, "runtime.mission_created", id);
            const row = await this.mission(c, org, id);
            await this.event(c, row, "mission.created", {
              state: "draft",
              version: 1,
            });
            return this.view(c, row);
          },
        ),
    );
  }
  async getMission(token: string, org: string, id: string) {
    const row = await this.locateMission(token, org, id);
    return this.scoped(
      token,
      org,
      row.environment_id,
      "mission:read",
      async (c) => this.view(c, await this.mission(c, org, id)),
    );
  }
  async listMissions(token: string, org: string, environment: string) {
    return this.scoped(token, org, environment, "mission:read", async (c) => {
      const rows = (
        await c.query<{ id: string }>(
          "select id from runtime_missions where organization_id=$1 and environment_id=$2 order by created_at desc,id limit 20",
          [org, environment],
        )
      ).rows;
      const result = [];
      for (const r of rows)
        result.push(await this.view(c, await this.mission(c, org, r.id)));
      return result;
    });
  }
  async executeMission(
    token: string,
    org: string,
    id: string,
    key: string,
    expected: number,
  ) {
    const located = await this.locateMission(token, org, id),
      grant = await this.auth.issueExecutionGrant(
        token,
        org,
        "mission:execute",
        { kind: "environment", id: located.environment_id },
      );
    return this.auth.guardExecution(grant, (p) =>
      this.tx(org, (c) =>
        this.idempotent(
          c,
          org,
          p.user.id,
          `mission.execute/${id}`,
          key,
          { expected_version: expected },
          async () => {
            if (p.user.account_type !== "adult") deny("SIMULATION_ONLY", 403);
            const row = await this.mission(c, org, id);
            this.version(row, expected);
            if (row.state !== "draft") deny("MISSION_NOT_DRAFT");
            this.snapshot(row);
            const updated = (
              await c.query(
                "update runtime_missions set state='queued',reason='none',version=version+1,execution_grant=$3,execution_digest=$4,deadline=$5 where organization_id=$1 and id=$2 returning *",
                [
                  org,
                  id,
                  grant,
                  digest({
                    mission: id,
                    hash: row.template_hash,
                    generation: row.generation,
                    grant,
                  }),
                  new Date(this.now() + 600000),
                ],
              )
            ).rows[0];
            await this.audit(c, org, p.user.id, "runtime.mission_executed", id);
            await this.event(c, updated, "mission.queued", {
              state: "queued",
              version: updated.version,
            });
            await this.queued(c, updated);
            return this.view(c, updated);
          },
        ),
      ),
    );
  }
}
