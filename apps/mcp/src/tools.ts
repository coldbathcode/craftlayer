import {
  environmentSchema,
  itemsSchema,
  meSchema,
  nodePage,
  nodeView,
  operationView,
  playersView,
  projectSchema,
  serverPage,
  serverTemplatePage,
  serverView,
} from "@craftlayer/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CraftLayerClient, CraftLayerError } from "./client.js";

const id = z.uuid();
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
type Server = z.infer<typeof serverView>;
function state(server: Server) {
  const o = server.observation;
  if (!o) return "not observed yet";
  const age = Math.max(
    0,
    Math.round((Date.now() - Date.parse(o.observed_at)) / 60000),
  );
  const when =
    o.freshness === "fresh"
      ? "just now"
      : `${age} minute${age === 1 ? "" : "s"} ago, may be out of date`;
  const players = o.player_count === null ? "" : `, ${o.player_count} playing`;
  return `${o.state}${players} (observed ${when})`;
}
function describe(server: Server) {
  const o = server.observation;
  const lines = [`${server.name}: ${state(server)}.`];
  if (o?.bedrock)
    lines.push(
      `iPad/console address ${o.bedrock.host} port ${o.bedrock.port}.`,
    );
  if (o?.java) lines.push(`Java address ${o.java.host} port ${o.java.port}.`);
  if (o)
    lines.push(
      `Allowlist ${o.enforce_allowlist ? "enforced" : o.allowlist_enabled ? "on but not enforced" : "off or unknown"}; online authentication ${o.online_authentication ? "on" : "off or unknown"}.`,
    );
  lines.push(
    "CraftLayer shows the last observation, not a live feed; backups and identities are not yet verified by the platform.",
  );
  return lines.join(" ");
}
function result(summary: string, data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${summary}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  };
}
function failure(error: unknown) {
  const message =
    error instanceof CraftLayerError
      ? `${error.message} (${error.code})`
      : "Something went wrong reading CraftLayer.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}
/** Read-only tools. Every call goes through the API with the agent's own token, so
 * CraftLayer's permission checks, scope and audit apply exactly as for a person. */
export function registerTools(server: McpServer, client: CraftLayerClient) {
  const guarded =
    <A>(run: (args: A) => Promise<ReturnType<typeof result>>) =>
    async (args: A) => {
      try {
        return await run(args);
      } catch (error) {
        return failure(error);
      }
    };
  server.registerTool(
    "get_connection_info",
    {
      title: "Who am I connected as",
      description:
        "Shows which CraftLayer family (organization) this agent can read and confirms the token works. Call this first.",
      annotations: readOnly,
    },
    guarded(async () => {
      const me = await client.get("/api/v1/auth/me", meSchema);
      return result(
        `Connected as agent for ${me.user.login}'s family. Organizations visible: ${me.organizations.map((o) => o.name).join(", ") || "none"}. This agent can only read.`,
        {
          organization_id: client.organization,
          organizations: me.organizations,
          read_only: true,
        },
      );
    }),
  );
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists the projects this agent may see. Worlds (environments) live inside projects.",
      annotations: readOnly,
    },
    guarded(async () => {
      const { items } = await client.get(
        "/api/v1/projects",
        itemsSchema(projectSchema),
      );
      return result(`${items.length} project(s) visible.`, items);
    }),
  );
  server.registerTool(
    "list_environments",
    {
      title: "List worlds",
      description:
        "Lists environments (worlds) this agent may see. Use an environment_id with list_servers.",
      annotations: readOnly,
    },
    guarded(async () => {
      const { items } = await client.get(
        "/api/v1/environments",
        itemsSchema(environmentSchema),
      );
      return result(`${items.length} environment(s) visible.`, items);
    }),
  );
  server.registerTool(
    "list_servers",
    {
      title: "List Minecraft servers",
      description:
        "Lists the Minecraft servers registered in one environment, with their last observed state.",
      inputSchema: { environment_id: id },
      annotations: readOnly,
    },
    guarded(async ({ environment_id }) => {
      const page = await client.get(
        `/api/v1/servers?environment_id=${encodeURIComponent(environment_id)}`,
        serverPage,
      );
      return result(
        page.items.length
          ? page.items.map(describe).join("\n")
          : "No servers are registered in that environment.",
        page,
      );
    }),
  );
  server.registerTool(
    "get_server_status",
    {
      title: "Get server status",
      description:
        "Last observed state of one Minecraft server: on/off, player count, join addresses and safety settings.",
      inputSchema: { server_id: id },
      annotations: readOnly,
    },
    guarded(async ({ server_id }) => {
      const server_ = await client.get(
        `/api/v1/servers/${encodeURIComponent(server_id)}`,
        serverView,
      );
      return result(describe(server_), server_);
    }),
  );
  server.registerTool(
    "list_players",
    {
      title: "List players",
      description:
        "Players seen on one server at the last observation. Names are as the game reported them; a Bedrock player appears with a leading dot.",
      inputSchema: { server_id: id },
      annotations: readOnly,
    },
    guarded(async ({ server_id }) => {
      const view = await client.get(
        `/api/v1/servers/${encodeURIComponent(server_id)}/players`,
        playersView,
      );
      const summary = !view.supported
        ? "This server's source does not report player names."
        : !view.players?.length
          ? `Nobody was playing at the last observation (${view.freshness}).`
          : `Playing (${view.freshness}): ${view.players.map((p) => `${p.name} [${p.edition}]`).join(", ")}.`;
      return result(summary, view);
    }),
  );
  server.registerTool(
    "get_operation_status",
    {
      title: "Get operation status",
      description:
        "State of a management operation by ID: running, succeeded or failed.",
      inputSchema: { operation_id: id },
      annotations: readOnly,
    },
    guarded(async ({ operation_id }) => {
      const op = await client.get(
        `/api/v1/operations/${encodeURIComponent(operation_id)}`,
        operationView,
      );
      return result(`Operation ${op.kind} is ${op.state}.`, op);
    }),
  );
  server.registerTool(
    "list_nodes",
    {
      title: "List Docker hosts",
      description:
        "Lists enrolled Docker hosts (nodes) in a project with connection state and capacity.",
      inputSchema: { project_id: id },
      annotations: readOnly,
    },
    guarded(async ({ project_id }) => {
      const page = await client.get(
        `/api/v1/nodes?project_id=${encodeURIComponent(project_id)}`,
        nodePage,
      );
      return result(
        page.items.length
          ? page.items.map((n) => `${n.name}: ${n.connection}`).join("\n")
          : "No hosts are enrolled in that project.",
        page,
      );
    }),
  );
  server.registerTool(
    "get_node_capacity",
    {
      title: "Get host capacity",
      description:
        "CPU, memory, containers and occupied ports last reported by one Docker host.",
      inputSchema: { node_id: id },
      annotations: readOnly,
    },
    guarded(async ({ node_id }) => {
      const node = await client.get(
        `/api/v1/nodes/${encodeURIComponent(node_id)}`,
        nodeView,
      );
      const c = node.capacity;
      return result(
        c
          ? `${node.name}: ${c.cpu_count} CPU, ${c.memory_total_mb} MB total, ${c.memory_reserved_mb} MB reserved, ${c.container_count} containers.`
          : `${node.name} has not reported capacity yet (${node.connection}).`,
        node,
      );
    }),
  );
  server.registerTool(
    "list_server_templates",
    {
      title: "List server templates",
      description:
        "Templates a host could provision from. Provisioning itself is not available to agents.",
      inputSchema: { node_id: id },
      annotations: readOnly,
    },
    guarded(async ({ node_id }) => {
      const page = await client.get(
        `/api/v1/server-templates?node_id=${encodeURIComponent(node_id)}`,
        serverTemplatePage,
      );
      return result(
        page.items.map((t) => `${t.name} (${t.id})`).join("\n") ||
          "No templates.",
        page,
      );
    }),
  );
}
