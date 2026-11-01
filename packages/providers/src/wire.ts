import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { ProviderError } from "./index.js";
import { localAddress } from "./instance.js";

export type WireTarget =
  | { kind: "operator_local"; url: string; addresses: string[] }
  | { kind: "hosted"; url: "https://openrouter.ai/api/v1" };
export interface WireRequest {
  target: WireTarget;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  secret?: string | undefined;
  signal: AbortSignal;
  timeout_ms: number;
  effectful: boolean;
  before_dispatch?: (() => Promise<void>) | undefined;
}
export interface JsonWire {
  json(request: WireRequest): Promise<unknown>;
}
export function statusError(
  status: number,
  retry: string | undefined,
  effectful: boolean,
): ProviderError {
  const retryMs =
    retry && /^\d+$/.test(retry)
      ? Math.min(300000, Number(retry) * 1000)
      : null;
  const code =
    status === 429
      ? "rate_limited"
      : status === 401 || status === 403
        ? "auth"
        : status === 408 || status === 504
          ? "timeout"
          : status === 400 || status === 413
            ? "context_exceeded"
            : status >= 300 && status < 400
              ? "policy_denied"
              : "unavailable";
  return new ProviderError(code, effectful, retryMs);
}
export const abortCode = (signal: AbortSignal) =>
  signal.reason?.name === "TimeoutError"
    ? ("timeout" as const)
    : ("aborted" as const);
function publicAddress(value: string) {
  if (localAddress(value)) return false;
  if (isIP(value) === 4) {
    const p = value.split(".").map(Number);
    return (
      (p[0] ?? 0) > 0 &&
      (p[0] ?? 255) < 224 &&
      p[0] !== 169 &&
      p[0] !== 100 &&
      p[0] !== 192 &&
      p[0] !== 198 &&
      p[0] !== 203
    );
  }
  return (
    isIP(value) === 6 &&
    /^[23][0-9a-f:]+$/i.test(value) &&
    !value.toLowerCase().startsWith("2001:db8:")
  );
}
export class HttpWire implements JsonWire {
  constructor(private resolve: typeof lookup = lookup) {}
  async json(input: WireRequest): Promise<unknown> {
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(Math.min(input.timeout_ms, 60000)),
    ]);
    if (signal.aborted) throw new ProviderError(abortCode(signal), false);
    const base = new URL(input.target.url),
      url = new URL(input.path, `${input.target.url.replace(/\/$/, "")}/`);
    const allowed =
      input.target.kind === "hosted"
        ? ["/api/v1/models", "/api/v1/chat/completions"]
        : ["/api/tags", "/api/show", "/api/chat"];
    if (
      !["http:", "https:"].includes(base.protocol) ||
      url.origin !== base.origin ||
      !allowed.includes(url.pathname) ||
      base.username ||
      base.password ||
      url.hash ||
      (input.target.kind === "hosted" &&
        input.target.url !== "https://openrouter.ai/api/v1") ||
      (input.target.kind === "operator_local" &&
        (base.pathname !== "/" || base.search))
    )
      throw new ProviderError("policy_denied", false);
    if (input.secret && input.target.kind !== "hosted")
      throw new ProviderError("policy_denied", false);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([
            this.resolve(hostname, {
              all: true,
              verbatim: true,
              family: input.target.kind === "hosted" ? 4 : 0,
            }),
            new Promise<never>((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () =>
                  reject(
                    new ProviderError(
                      input.signal.aborted
                        ? abortCode(input.signal)
                        : "timeout",
                      false,
                    ),
                  ),
                { once: true },
              ),
            ),
          ]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", false);
    }
    if (signal.aborted)
      throw new ProviderError(
        input.signal.aborted ? abortCode(input.signal) : "timeout",
        false,
      );
    if (
      !addresses.length ||
      addresses.some((a) =>
        input.target.kind === "operator_local"
          ? !localAddress(a.address) ||
            !input.target.addresses.includes(a.address)
          : !publicAddress(a.address),
      )
    )
      throw new ProviderError("policy_denied", false);
    const selected = addresses[0];
    if (!selected) throw new ProviderError("policy_denied", false);
    const body =
      input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body && Buffer.byteLength(body) > 262144)
      throw new ProviderError("policy_denied", false);
    if (input.effectful && input.before_dispatch) await input.before_dispatch();
    if (signal.aborted) throw new ProviderError(abortCode(signal), false);
    return new Promise((resolve, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      let dispatched = false;
      const request = transport.request(
        url,
        {
          method: input.method,
          agent: false,
          signal,
          maxHeaderSize: 16384,
          family: selected.family,
          lookup: (_host, _options, callback) =>
            callback(null, selected.address, selected.family),
          headers: {
            accept: "application/json",
            "accept-encoding": "identity",
            ...(body
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(body),
                }
              : {}),
            ...(input.secret
              ? { authorization: `Bearer ${input.secret}` }
              : {}),
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(
              statusError(
                response.statusCode ?? 500,
                response.headers["retry-after"],
                input.effectful,
              ),
            );
            return;
          }
          if (
            !String(response.headers["content-type"] ?? "")
              .toLowerCase()
              .startsWith("application/json") ||
            response.headers["content-encoding"]
          ) {
            reject(new ProviderError("malformed_response", input.effectful));
            response.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              reject(new ProviderError("malformed_response", input.effectful));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on("aborted", () =>
            reject(
              new ProviderError(
                signal.aborted ? abortCode(signal) : "unavailable",
                input.effectful,
              ),
            ),
          );
          response.on("error", () =>
            reject(
              new ProviderError(
                signal.aborted
                  ? input.signal.aborted
                    ? "aborted"
                    : "timeout"
                  : "unavailable",
                dispatched,
              ),
            ),
          );
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new ProviderError("malformed_response", input.effectful));
            }
          });
        },
      );
      request.on("error", () =>
        reject(
          new ProviderError(
            signal.aborted
              ? input.signal.aborted
                ? "aborted"
                : "timeout"
              : "unavailable",
            dispatched,
          ),
        ),
      );
      dispatched = input.effectful;
      request.end(body);
    });
  }
}
