import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { CraftLayerClient, settingsFromEnv } from "./client.js";
import { registerTools } from "./tools.js";

const org = "6d3d4e9a-2a7b-4f6e-9a1b-2c3d4e5f6a7b";
const token = `cla_${"a".repeat(43)}`;
const serverId = "0b9f2e4a-8c1d-4e5f-9a6b-7c8d9e0f1a2b";
const observed = new Date().toISOString();
const serverRow = {
  id: serverId,
  project_id: "1b9f2e4a-8c1d-4e5f-9a6b-7c8d9e0f1a2b",
  environment_id: "2b9f2e4a-8c1d-4e5f-9a6b-7c8d9e0f1a2b",
  name: "Family Survival",
  management_mode: "adopted_read_only",
  registered: true,
  version: 3,
  target_id: "contabo-playtest",
  observation: {
    source: "captured_inventory",
    observed_at: observed,
    state: "online",
    java: null,
    bedrock: { host: "203.0.113.10", port: 19133 },
    online_authentication: true,
    allowlist_enabled: true,
    enforce_allowlist: true,
    rcon_public: false,
    backup_verified: false,
    identity_verified: false,
    freshness: "fresh",
    player_count: 2,
    family_ready: false,
  },
  can_observe: false,
  can_unregister: false,
};
const calls: Array<{ url: string; headers: Record<string, string> }> = [];
let responder: (url: URL) => { status: number; body: unknown } = () => ({
  status: 404,
  body: { error: { code: "NOT_FOUND", message: "no", request_id: "r" } },
});
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push({
    url: url.pathname + url.search,
    headers: Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    ),
  });
  const { status, body } = responder(url);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};
async function connect() {
  const settings = settingsFromEnv({
    CRAFTLAYER_URL: "http://127.0.0.1:3000",
    CRAFTLAYER_ORGANIZATION: org,
    CRAFTLAYER_AGENT_TOKEN: token,
  });
  const server = new McpServer({ name: "craftlayer", version: "test" });
  registerTools(server, new CraftLayerClient(settings, fakeFetch));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}
let close: (() => Promise<unknown>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
  calls.length = 0;
});
describe("settings", () => {
  it("requires a cla_ token and an organization, and https off this machine", () => {
    expect(() =>
      settingsFromEnv({
        CRAFTLAYER_ORGANIZATION: org,
        CRAFTLAYER_AGENT_TOKEN: "x",
      }),
    ).toThrow(/CRAFTLAYER_AGENT_TOKEN/);
    expect(() =>
      settingsFromEnv({
        CRAFTLAYER_URL: "http://craftlayer.example",
        CRAFTLAYER_ORGANIZATION: org,
        CRAFTLAYER_AGENT_TOKEN: token,
      }),
    ).toThrow(/https/);
    expect(
      settingsFromEnv({
        CRAFTLAYER_URL: "https://craftlayer.example/",
        CRAFTLAYER_ORGANIZATION: org,
        CRAFTLAYER_AGENT_TOKEN: token,
      }).url,
    ).toBe("https://craftlayer.example");
  });
});
describe("read-only tools", () => {
  it("exposes only read-only tools and sends the bearer with the organization", async () => {
    const session = await connect();
    close = session.close;
    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_connection_info",
      "get_node_capacity",
      "get_operation_status",
      "get_server_status",
      "list_backups",
      "list_environments",
      "list_nodes",
      "list_players",
      "list_projects",
      "list_server_templates",
      "list_servers",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
    responder = () => ({ status: 200, body: serverRow });
    const r = await session.client.callTool({
      name: "get_server_status",
      arguments: { server_id: serverId },
    });
    expect(r.isError).toBeFalsy();
    const text = String((r.content as Array<{ text: string }>)[0]?.text);
    expect(text).toContain("Family Survival: online, 2 playing");
    expect(text).toContain("203.0.113.10 port 19133");
    expect(text).toContain("Allowlist enforced");
    expect(calls[0]).toMatchObject({
      url: `/api/v1/servers/${serverId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-craftlayer-organization": org,
      },
    });
  });
  it("turns API refusals into plain errors without leaking the token", async () => {
    const session = await connect();
    close = session.close;
    responder = () => ({
      status: 403,
      body: {
        error: { code: "PERMISSION_DENIED", message: "nope", request_id: "r" },
      },
    });
    const denied = await session.client.callTool({
      name: "list_servers",
      arguments: { environment_id: serverRow.environment_id },
    });
    expect(denied.isError).toBe(true);
    const text = String((denied.content as Array<{ text: string }>)[0]?.text);
    expect(text).toContain("not allowed to read that");
    expect(text).toContain("PERMISSION_DENIED");
    expect(text).not.toContain(token.slice(4));
    responder = () => ({
      status: 401,
      body: {
        error: { code: "UNAUTHENTICATED", message: "x", request_id: "r" },
      },
    });
    const revoked = await session.client.callTool({
      name: "list_projects",
      arguments: {},
    });
    expect(
      String((revoked.content as Array<{ text: string }>)[0]?.text),
    ).toContain("invalid, expired or revoked");
    responder = () => ({ status: 200, body: { unexpected: true } });
    const odd = await session.client.callTool({
      name: "list_environments",
      arguments: {},
    });
    expect(odd.isError).toBe(true);
    expect(String((odd.content as Array<{ text: string }>)[0]?.text)).toContain(
      "does not understand",
    );
  });
  it("rejects malformed IDs before any request is made", async () => {
    const session = await connect();
    close = session.close;
    const bad = await session.client.callTool({
      name: "list_players",
      arguments: { server_id: "not-a-uuid" },
    });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
