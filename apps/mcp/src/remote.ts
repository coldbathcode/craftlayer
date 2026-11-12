import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIP } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CraftLayerClient, CraftLayerError } from "./client.js";
import { registerTools } from "./tools.js";

/** The one path that speaks MCP. Everything else is the health probe or 404. */
export const mcpPath = "/mcp";

const flag = z.enum(["true", "false"]).transform((value) => value === "true");
const count = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const list = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
const environment = z.object({
  CRAFTLAYER_URL: z.url().default("http://127.0.0.1:3000"),
  CRAFTLAYER_ORGANIZATION: z.uuid(),
  CRAFTLAYER_MCP_INTERNAL_API_HTTP: flag.default(false),
  CRAFTLAYER_MCP_BIND_HOST: z.string().min(1).default("127.0.0.1"),
  CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND: flag.default(false),
  CRAFTLAYER_MCP_PORT: z.coerce.number().int().min(0).max(65535).default(3900),
  CRAFTLAYER_MCP_ALLOWED_HOSTS: list("127.0.0.1,localhost,[::1]"),
  CRAFTLAYER_MCP_ALLOWED_ORIGINS: list(""),
  CRAFTLAYER_MCP_RATE_PER_TOKEN: count(60, 100_000),
  CRAFTLAYER_MCP_RATE_GLOBAL: count(300, 1_000_000),
  CRAFTLAYER_MCP_MAX_BODY_BYTES: count(65_536, 4_194_304),
  CRAFTLAYER_MCP_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(30_000),
});

export interface RemoteSettings {
  /** Internal CraftLayer API origin every tool call is forwarded to. */
  url: string;
  /** The one family this deployment serves; the API still checks the token belongs to it. */
  organization: string;
  host: string;
  port: number;
  /** Hostnames accepted in `Host`, lower case, without a port. */
  allowedHosts: string[];
  /** Exact origins accepted in `Origin`; empty refuses every browser origin. */
  allowedOrigins: string[];
  perTokenPerMinute: number;
  globalPerMinute: number;
  maxBodyBytes: number;
  requestTimeoutMs: number;
}

const loopbackHost = (host: string) =>
  host === "localhost" ||
  host === "::1" ||
  host === "[::1]" ||
  (isIP(host) === 4 && host.startsWith("127."));

/** Reads the remote server's settings. There is deliberately no token here: the
 * server holds none and every caller brings their own. */
export function remoteSettingsFromEnv(
  env: Record<string, string | undefined>,
): RemoteSettings {
  const parsed = environment.safeParse(env);
  if (!parsed.success)
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      `Remote MCP settings are invalid: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}. CRAFTLAYER_ORGANIZATION (uuid) is required.`,
    );
  const value = parsed.data;
  const url = new URL(value.CRAFTLAYER_URL);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (loopbackHost(url.hostname) || value.CRAFTLAYER_MCP_INTERNAL_API_HTTP)
    )
  )
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      "CRAFTLAYER_URL must use https unless it points at this machine, or at a private container network with CRAFTLAYER_MCP_INTERNAL_API_HTTP=true.",
    );
  if (
    !loopbackHost(value.CRAFTLAYER_MCP_BIND_HOST) &&
    !value.CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND
  )
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      "CRAFTLAYER_MCP_BIND_HOST must be a loopback address. Inside a container whose port is published on the host's loopback only, set CRAFTLAYER_MCP_ALLOW_NON_LOOPBACK_BIND=true.",
    );
  if (value.CRAFTLAYER_MCP_ALLOWED_HOSTS.length === 0)
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      "CRAFTLAYER_MCP_ALLOWED_HOSTS must name at least one hostname.",
    );
  return {
    url: url.origin,
    organization: value.CRAFTLAYER_ORGANIZATION,
    host: value.CRAFTLAYER_MCP_BIND_HOST,
    port: value.CRAFTLAYER_MCP_PORT,
    allowedHosts: value.CRAFTLAYER_MCP_ALLOWED_HOSTS,
    allowedOrigins: value.CRAFTLAYER_MCP_ALLOWED_ORIGINS,
    perTokenPerMinute: value.CRAFTLAYER_MCP_RATE_PER_TOKEN,
    globalPerMinute: value.CRAFTLAYER_MCP_RATE_GLOBAL,
    maxBodyBytes: value.CRAFTLAYER_MCP_MAX_BODY_BYTES,
    requestTimeoutMs: value.CRAFTLAYER_MCP_REQUEST_TIMEOUT_MS,
  };
}

/** Fixed-window counter held in memory. Keys are bounded so a caller cannot grow
 * it without limit; when it is full of live windows, new keys are refused. */
export class FixedWindowLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** Returns 0 when the request may proceed, otherwise the seconds to wait. */
  take(key: string): number {
    const now = this.now();
    const current = this.#windows.get(key);
    if (current && now - current.start < this.windowMs) {
      if (current.count < this.limit) {
        current.count += 1;
        return 0;
      }
      return Math.max(
        1,
        Math.ceil((current.start + this.windowMs - now) / 1000),
      );
    }
    if (!current && this.#windows.size >= this.maxKeys) {
      for (const [other, window] of this.#windows)
        if (now - window.start >= this.windowMs) this.#windows.delete(other);
      if (this.#windows.size >= this.maxKeys)
        return Math.max(1, Math.ceil(this.windowMs / 1000));
    }
    this.#windows.set(key, { start: now, count: 1 });
    return 0;
  }
}

/** One line per request: an outcome code and a status, never a token, body or argument. */
export type RemoteLog = (entry: { outcome: string; status: number }) => void;

export interface RemoteDependencies {
  fetchImpl?: typeof fetch;
  log?: RemoteLog;
  now?: () => number;
}

const bearerPattern = /^Bearer (cla_[A-Za-z0-9_-]{43})$/;
const windowMs = 60_000;
const maxTrackedTokens = 10_000;

function hostname(header: string | undefined): string | undefined {
  if (!header) return undefined;
  try {
    return new URL(`http://${header}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Builds the HTTP server; the caller decides when and where it listens. */
export function createRemoteServer(
  settings: RemoteSettings,
  dependencies: RemoteDependencies = {},
): Server {
  const log = dependencies.log ?? (() => {});
  const now = dependencies.now ?? Date.now;
  const everyone = new FixedWindowLimiter(
    settings.globalPerMinute,
    windowMs,
    1,
    now,
  );
  const perToken = new FixedWindowLimiter(
    settings.perTokenPerMinute,
    windowMs,
    maxTrackedTokens,
    now,
  );
  const refuse = (
    response: ServerResponse,
    status: number,
    code: string,
    message: string,
    headers: Record<string, string> = {},
  ) => {
    log({ outcome: code, status });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    // The request body may be unread; closing stops a refused caller streaming it.
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      connection: "close",
      ...headers,
    });
    response.end(JSON.stringify({ error: { code, message } }));
  };
  const limited = (response: ServerResponse, wait: number) =>
    refuse(
      response,
      429,
      "RATE_LIMITED",
      "Too many requests. Wait and try again.",
      {
        "retry-after": String(wait),
      },
    );

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/health/live") {
      if (request.method !== "GET" && request.method !== "HEAD")
        return refuse(response, 405, "METHOD_NOT_ALLOWED", "Use GET.", {
          allow: "GET, HEAD",
        });
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    // DNS-rebinding protection: a browser tricked into calling this address still
    // sends the attacker's hostname and its own Origin.
    const host = hostname(request.headers.host);
    if (!host || !settings.allowedHosts.includes(host))
      return refuse(
        response,
        403,
        "HOST_REJECTED",
        "This host name is not served here.",
      );
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      !settings.allowedOrigins.includes(origin.toLowerCase())
    )
      return refuse(
        response,
        403,
        "ORIGIN_REJECTED",
        "This origin is not allowed.",
      );
    if (path !== mcpPath)
      return refuse(response, 404, "NOT_FOUND", "Nothing is served here.");
    const busy = everyone.take("all");
    if (busy) return limited(response, busy);
    const token = bearerPattern.exec(request.headers.authorization ?? "")?.[1];
    if (!token)
      return refuse(
        response,
        401,
        "UNAUTHENTICATED",
        "Send a CraftLayer agent token as a bearer header.",
        { "www-authenticate": 'Bearer realm="craftlayer-mcp"' },
      );
    // Stateless JSON mode: there is no session to resume or stream to open.
    if (request.method !== "POST")
      return refuse(response, 405, "METHOD_NOT_ALLOWED", "Use POST.", {
        allow: "POST",
      });
    // Only a hash of the token is kept, and only for the length of one window.
    const wait = perToken.take(
      createHash("sha256").update(token).digest("base64url"),
    );
    if (wait) return limited(response, wait);
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > settings.maxBodyBytes)
      return refuse(
        response,
        413,
        "BODY_TOO_LARGE",
        "The request is too large.",
      );

    // A fresh server per request, holding this caller's token only until the reply.
    const mcp = new McpServer({ name: "craftlayer", version: "0.0.0" });
    registerTools(
      mcp,
      new CraftLayerClient(
        { url: settings.url, organization: settings.organization, token },
        dependencies.fetchImpl,
      ),
    );
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: settings.maxBodyBytes,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      refuse(response, 504, "REQUEST_TIMEOUT", "The request took too long.");
    }, settings.requestTimeoutMs);
    response.once("close", () => {
      clearTimeout(timer);
      void transport.close().catch(() => {});
      void mcp.close().catch(() => {});
    });
    response.once("finish", () => {
      if (!timedOut) log({ outcome: "HANDLED", status: response.statusCode });
    });
    await mcp.connect(transport);
    await transport.handleRequest(request, response);
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      // The cause may quote caller input, so only the code is recorded.
      if (response.writableEnded) return;
      refuse(response, 500, "INTERNAL", "The request could not be handled.");
    });
  });
  server.requestTimeout = settings.requestTimeoutMs;
  server.headersTimeout = Math.min(settings.requestTimeoutMs, 10_000);
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}
