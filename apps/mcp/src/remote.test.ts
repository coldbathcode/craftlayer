import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRemoteServer,
  FixedWindowLimiter,
  type RemoteSettings,
  remoteSettingsFromEnv,
} from "./remote.js";

const org = "6d3d4e9a-2a7b-4f6e-9a1b-2c3d4e5f6a7b";
const token = `cla_${"a".repeat(43)}`;
const otherToken = `cla_${"b".repeat(43)}`;
const serverId = "0b9f2e4a-8c1d-4e5f-9a6b-7c8d9e0f1a2b";
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
    observed_at: new Date().toISOString(),
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
const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
});

/** What the fake API saw and how it answers; reset for every test. */
const apiCalls: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
let apiAnswer: () => { status: number; body: unknown; delayMs?: number };
const logs: Array<{ outcome: string; status: number }> = [];
const servers: Server[] = [];
const closers: Array<() => Promise<unknown>> = [];

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
async function start(overrides: Partial<RemoteSettings> = {}) {
  const apiPort = await listen(
    createServer((request, response) => {
      apiCalls.push({ url: request.url ?? "", headers: request.headers });
      const { status, body, delayMs } = apiAnswer();
      setTimeout(() => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      }, delayMs ?? 0);
    }),
  );
  const settings = {
    ...remoteSettingsFromEnv({
      CRAFTLAYER_URL: `http://127.0.0.1:${apiPort}`,
      CRAFTLAYER_ORGANIZATION: org,
    }),
    ...overrides,
  };
  const port = await listen(
    createRemoteServer(settings, { log: (entry) => logs.push(entry) }),
  );
  return { port, url: `http://127.0.0.1:${port}/mcp` };
}
async function connect(url: string, bearer: string) {
  const client = new Client({ name: "test", version: "0" });
  closers.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }),
  );
  return client;
}
const post = (
  url: string,
  headers: Record<string, string>,
  body = initialize,
) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
/** fetch cannot set Host, so the rebinding checks use a raw request. */
const raw = (port: number, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          ...headers,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once("error", reject);
    request.end(initialize);
  });
const text = (result: unknown) =>
  String((result as { content: Array<{ text: string }> }).content[0]?.text);

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close().catch(() => {})));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    ),
  );
  apiCalls.length = 0;
  logs.length = 0;
});

describe("remote settings", () => {
  const base = { CRAFTLAYER_ORGANIZATION: org };
  it("defaults to loopback with fixed limits and holds no token", () => {
    const settings = remoteSettingsFromEnv({
      ...base,
      CRAFTLAYER_AGENT_TOKEN: token,
    });
    expect(settings).toEqual({
      url: "http://127.0.0.1:3000",
      organization: org,
      host: "127.0.0.1",
      port: 3900,
      allowedHosts: ["127.0.0.1", "localhost", "[::1]"],
      allowedOrigins: [],
      perTokenPerMinute: 60,
      globalPerMinute: 300,
      maxBodyBytes: 65536,
      requestTimeoutMs: 30000,
    });
    expect(JSON.stringify(settings)).not.toContain("cla_");
  });
  it("needs an organization and refuses a wider bind or plain remote API without an explicit opt-in", () => {
    expect(() => remoteSettingsFromEnv({})).toThrow(/CRAFTLAYER_ORGANIZATION/);
    for (const host of ["0.0.0.0", "::", "192.168.1.5", "203.0.113.9"])
      expect(() =>
        remoteSettingsFromEnv({ ...base, CRAFTLAYER_MCP_BIND_HOST: host }),
      ).toThrow(/loopback/);
    expect(
      remoteSettingsFromEnv({
        ...base,
        CRAFTLAYER_MCP_BIND_HOST: "0.0.0.0",
        CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND: "true",
      }).host,
    ).toBe("0.0.0.0");
    expect(() =>
      remoteSettingsFromEnv({ ...base, CRAFTLAYER_URL: "http://api:4000" }),
    ).toThrow(/https/);
    expect(
      remoteSettingsFromEnv({
        ...base,
        CRAFTLAYER_URL: "http://api:4000",
        CRAFTLAYER_MCP_INTERNAL_API_HTTP: "true",
        CRAFTLAYER_MCP_ALLOWED_HOSTS: " Box.Tailnet.ts.net , localhost ",
        CRAFTLAYER_MCP_RATE_PER_TOKEN: "5",
      }),
    ).toMatchObject({
      url: "http://api:4000",
      allowedHosts: ["box.tailnet.ts.net", "localhost"],
      perTokenPerMinute: 5,
    });
    expect(() =>
      remoteSettingsFromEnv({ ...base, CRAFTLAYER_MCP_RATE_GLOBAL: "0" }),
    ).toThrow(/CRAFTLAYER_MCP_RATE_GLOBAL/);
    expect(() =>
      remoteSettingsFromEnv({ ...base, CRAFTLAYER_MCP_ALLOWED_HOSTS: " , " }),
    ).toThrow(/ALLOWED_HOSTS/);
  });
});

describe("limiter", () => {
  it("counts per key inside a window, reports the wait and stays bounded", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(2, 60_000, 2, () => now);
    expect([limiter.take("a"), limiter.take("a")]).toEqual([0, 0]);
    now = 15_000;
    expect(limiter.take("a")).toBe(45);
    expect(limiter.take("b")).toBe(0);
    // Full of live windows: a third key is refused rather than tracked.
    expect(limiter.take("c")).toBe(60);
    now = 60_000;
    expect(limiter.take("a")).toBe(0);
    // "b" is still live, so the table is still full.
    expect(limiter.take("c")).toBe(60);
    now = 75_000;
    expect(limiter.take("c")).toBe(0);
  });
});

describe("remote MCP over Streamable HTTP", () => {
  it("lists tools and reads through the API with the caller's own bearer", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const { url, port } = await start();
    const health = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect([health.status, await health.json()]).toEqual([
      200,
      { status: "ok" },
    ]);

    const client = await connect(url, token);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("get_server_status");
    expect(tools.length).toBeGreaterThanOrEqual(12);
    expect(apiCalls).toHaveLength(0);

    const result = await client.callTool({
      name: "get_server_status",
      arguments: { server_id: serverId },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Family Survival: online, 2 playing");
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]?.url).toBe(`/api/v1/servers/${serverId}`);
    expect(apiCalls[0]?.headers).toMatchObject({
      authorization: `Bearer ${token}`,
      "x-craftlayer-organization": org,
    });

    // A second caller's token is forwarded as their own, never the first one.
    const second = await connect(url, otherToken);
    await second.callTool({
      name: "get_server_status",
      arguments: { server_id: serverId },
    });
    expect(apiCalls[1]?.headers.authorization).toBe(`Bearer ${otherToken}`);

    // Logs carry codes only.
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("cla_");
    expect(JSON.stringify(logs)).not.toContain(serverId);
    for (const entry of logs)
      expect(Object.keys(entry).sort()).toEqual(["outcome", "status"]);
  });

  it("answers 401 with a challenge before any MCP handling when the bearer is missing or malformed", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const { url } = await start();
    for (const authorization of [
      undefined,
      "Bearer nope",
      `Bearer cla_${"a".repeat(42)}`,
      `Basic ${token}`,
      `bearer ${token} extra`,
    ]) {
      const response = await post(
        url,
        authorization === undefined ? {} : { authorization },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer /);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    await expect(connect(url, "not-a-token")).rejects.toThrow();
    expect(apiCalls).toHaveLength(0);
    expect(logs.every((entry) => entry.status === 401)).toBe(true);
  });

  it("surfaces a revoked token as a tool error on the next call, not a crash", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const { url } = await start();
    const client = await connect(url, token);
    const call = () =>
      client.callTool({
        name: "get_server_status",
        arguments: { server_id: serverId },
      });
    expect((await call()).isError).toBeFalsy();
    apiAnswer = () => ({
      status: 401,
      body: {
        error: { code: "UNAUTHENTICATED", message: "x", request_id: "r" },
      },
    });
    const revoked = await call();
    expect(revoked.isError).toBe(true);
    expect(text(revoked)).toContain("invalid, expired or revoked");
    expect(text(revoked)).not.toContain(token.slice(4));
    // The server is still serving.
    apiAnswer = () => ({ status: 200, body: serverRow });
    expect((await call()).isError).toBeFalsy();
  });

  it("limits each token and everyone together with 429 and Retry-After", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const perToken = await start({ perTokenPerMinute: 2 });
    const auth = { authorization: `Bearer ${token}` };
    expect((await post(perToken.url, auth)).status).toBe(200);
    expect((await post(perToken.url, auth)).status).toBe(200);
    const limited = await post(perToken.url, auth);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(
      1,
    );
    expect(Number(limited.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(await limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    // Another token has its own allowance.
    expect(
      (await post(perToken.url, { authorization: `Bearer ${otherToken}` }))
        .status,
    ).toBe(200);

    const global = await start({ globalPerMinute: 2 });
    expect((await post(global.url, auth)).status).toBe(200);
    // Unauthenticated traffic also spends the shared allowance.
    expect((await post(global.url, {})).status).toBe(401);
    const everyone = await post(global.url, {
      authorization: `Bearer ${otherToken}`,
    });
    expect(everyone.status).toBe(429);
    expect(everyone.headers.get("retry-after")).toBeTruthy();
    // The health probe is never limited.
    expect(
      (await fetch(`http://127.0.0.1:${global.port}/health/live`)).status,
    ).toBe(200);
  });

  it("rejects a foreign Host or Origin before looking at the token", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const { port } = await start({
      allowedHosts: ["127.0.0.1", "box.tailnet.ts.net"],
      allowedOrigins: ["https://box.tailnet.ts.net"],
    });
    expect(await raw(port, {})).toBe(200);
    expect(await raw(port, { host: "Box.Tailnet.ts.net:8443" })).toBe(200);
    expect(await raw(port, { host: "evil.example" })).toBe(403);
    expect(await raw(port, { host: "evil.example", authorization: "" })).toBe(
      403,
    );
    expect(await raw(port, { origin: "https://evil.example" })).toBe(403);
    expect(await raw(port, { origin: "https://box.tailnet.ts.net" })).toBe(200);
    expect(logs.map((entry) => entry.outcome)).toEqual([
      "HANDLED",
      "HANDLED",
      "HOST_REJECTED",
      "HOST_REJECTED",
      "ORIGIN_REJECTED",
      "HANDLED",
    ]);
    // With no origin allowlist, every browser origin is refused.
    const strict = await start();
    expect(await raw(strict.port, { origin: "http://127.0.0.1" })).toBe(403);
  });

  it("rejects an oversized body, declared or streamed", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow });
    const { url, port } = await start({ maxBodyBytes: 1024 });
    const auth = { authorization: `Bearer ${token}` };
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_projects", arguments: { pad: "x".repeat(4096) } },
    });
    expect((await post(url, auth, big)).status).toBe(413);
    const streamed = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "transfer-encoding": "chunked",
            ...auth,
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.end(big);
    });
    expect(streamed).toBe(413);
    expect(apiCalls).toHaveLength(0);
    expect((await post(url, auth)).status).toBe(200);
  });

  it("serves only POST /mcp and gives up on a request that takes too long", async () => {
    apiAnswer = () => ({ status: 200, body: serverRow, delayMs: 1500 });
    const { url, port } = await start({ requestTimeoutMs: 200 });
    const auth = { authorization: `Bearer ${token}` };
    expect(
      (await fetch(url, { headers: { ...auth, accept: "text/event-stream" } }))
        .status,
    ).toBe(405);
    expect((await fetch(url, { method: "DELETE", headers: auth })).status).toBe(
      405,
    );
    expect(
      (await fetch(`http://127.0.0.1:${port}/other`, { headers: auth })).status,
    ).toBe(404);
    const slow = await post(
      url,
      auth,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_server_status",
          arguments: { server_id: serverId },
        },
      }),
    );
    expect(slow.status).toBe(504);
    expect(await slow.json()).toMatchObject({
      error: { code: "REQUEST_TIMEOUT" },
    });
    expect(logs.at(-1)).toEqual({ outcome: "REQUEST_TIMEOUT", status: 504 });
  });
});
