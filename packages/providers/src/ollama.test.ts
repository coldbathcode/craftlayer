import type { lookup } from "node:dns/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { FakeClock, fixtureRequest } from "./fixtures.js";
import { ProviderError } from "./index.js";
import type { ApprovedLocal } from "./instance.js";
import { OllamaProvider } from "./ollama.js";
import {
  HttpWire,
  type JsonWire,
  statusError,
  type WireRequest,
} from "./wire.js";

export const localEndpoint: ApprovedLocal = {
  id: "fixture-local",
  url: "http://127.0.0.1:11434",
  addresses: ["127.0.0.1"],
  models: ["fixture:local"],
  cloud_disabled: true,
  context_tokens: 32768,
  output_tokens: 1024,
};
export class OllamaWire implements JsonWire {
  calls: WireRequest[] = [];
  tags: unknown = {
    models: [
      {
        name: "fixture:local",
        digest: "a".repeat(64),
        details: { format: "gguf" },
      },
    ],
  };
  show: unknown = {
    capabilities: ["completion", "tools", "structured_outputs"],
    details: { format: "gguf" },
    model_info: {
      "general.architecture": "fixture",
      "fixture.context_length": 32768,
    },
  };
  chat: unknown = {
    model: "fixture:local",
    message: { content: "Synthetic local result" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 20,
    eval_count: 4,
  };
  async json(request: WireRequest) {
    request.signal.throwIfAborted();
    this.calls.push(request);
    return structuredClone(
      request.path === "/api/tags"
        ? this.tags
        : request.path === "/api/show"
          ? this.show
          : this.chat,
    );
  }
}
it("connects to the validated address pin and rejects changed DNS before connecting", async () => {
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"synthetic":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const target = {
      kind: "operator_local" as const,
      url: `http://fixture.invalid:${(server.address() as AddressInfo).port}`,
      addresses: ["127.0.0.1"],
    };
    const request = {
      target,
      path: "/api/tags",
      method: "GET" as const,
      signal: AbortSignal.timeout(1000),
      timeout_ms: 500,
      effectful: false,
    };
    const good = (async () => [
      { address: "127.0.0.1", family: 4 },
    ]) as unknown as typeof lookup;
    expect(await new HttpWire(good).json(request)).toEqual({ synthetic: true });
    const bad = (async () => [
      { address: "169.254.169.254", family: 4 },
    ]) as unknown as typeof lookup;
    await expect(new HttpWire(bad).json(request)).rejects.toMatchObject({
      code: "policy_denied",
      dispatched: false,
    });
    await expect(
      new HttpWire(good).json({
        ...request,
        effectful: true,
        before_dispatch: async () => {
          throw new ProviderError("policy_denied", false);
        },
      }),
    ).rejects.toMatchObject({ code: "policy_denied", dispatched: false });
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("discovers only approved installed local models and sends bounded generation parameters", async () => {
  const clock = new FakeClock(),
    wire = new OllamaWire(),
    provider = new OllamaProvider(localEndpoint, wire, () => clock.now);
  const model = (await provider.discover(AbortSignal.timeout(1000)))[0];
  if (!model) throw new Error("Missing fixture");
  expect(model.zero_cost_enforced).toBe(true);
  expect(model.pricing.source).toBe("operator_local");
  expect(
    (
      await provider.generate(
        model,
        fixtureRequest(),
        AbortSignal.timeout(1000),
      )
    ).usage.quality,
  ).toBe("observed");
  const body = wire.calls.find((c) => c.path === "/api/chat")?.body;
  expect(body).toMatchObject({
    stream: false,
    think: false,
    options: { num_predict: 64, num_ctx: 32768 },
    keep_alive: 0,
  });
  expect(wire.calls.every((c) => c.secret === undefined)).toBe(true);
});
it("rejects remote/cloud, missing local evidence and changed installed model", async () => {
  const wire = new OllamaWire(),
    provider = new OllamaProvider(localEndpoint, wire),
    signal = AbortSignal.timeout(1000);
  const model = (await provider.discover(signal))[0];
  if (!model) throw new Error("Missing fixture");
  wire.show = {
    remote_host: "https://cloud.invalid",
    capabilities: ["completion"],
    details: { format: "gguf" },
    model_info: {
      "general.architecture": "fixture",
      "fixture.context_length": 32768,
    },
  };
  expect(await provider.discover(signal)).toEqual([]);
  await expect(
    provider.generate(model, fixtureRequest(), signal),
  ).rejects.toMatchObject({ code: "policy_denied", dispatched: false });
  expect(wire.calls.filter((c) => c.path === "/api/chat")).toHaveLength(0);
  wire.show = {
    capabilities: ["completion"],
    details: { format: "gguf" },
    model_info: {},
  };
  expect(await provider.discover(signal)).toEqual([]);
});
it("keeps absent usage unknown and rejects incomplete/unknown tool responses", async () => {
  const wire = new OllamaWire(),
    provider = new OllamaProvider(localEndpoint, wire),
    signal = AbortSignal.timeout(1000),
    model = (await provider.discover(signal))[0];
  if (!model) throw new Error("Missing fixture");
  wire.chat = {
    model: model.id,
    message: { content: "Unknown usage" },
    done: true,
    done_reason: "stop",
  };
  expect(
    (await provider.generate(model, fixtureRequest(), signal)).usage,
  ).toEqual({ input_tokens: null, output_tokens: null, quality: "unknown" });
  wire.chat = {
    model: model.id,
    message: { content: "unfinished" },
    done: false,
    done_reason: "stop",
  };
  await expect(
    provider.generate(model, fixtureRequest(), signal),
  ).rejects.toMatchObject({ code: "malformed_response", dispatched: true });
  wire.chat = {
    model: model.id,
    message: {
      content: "",
      tool_calls: [{ function: { name: "self_approve", arguments: {} } }],
    },
    done: true,
    done_reason: "stop",
  };
  await expect(
    provider.generate(model, fixtureRequest(), signal),
  ).rejects.toMatchObject({ code: "malformed_response" });
});
it("bounds real loopback HTTP, refuses redirects/oversize bodies and normalizes failures", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(302, { location: "http://169.254.169.254" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const target = {
      kind: "operator_local" as const,
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      addresses: ["127.0.0.1"],
    };
    const request = {
      target,
      path: "/api/tags",
      method: "GET" as const,
      signal: AbortSignal.timeout(1000),
      timeout_ms: 500,
      effectful: false,
    };
    await expect(new HttpWire().json(request)).rejects.toMatchObject({
      code: "policy_denied",
      dispatched: false,
    });
    server.removeAllListeners("request");
    server.on("request", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(`{"data":"${"a".repeat(2 * 1024 * 1024)}"}`);
    });
    await expect(new HttpWire().json(request)).rejects.toMatchObject({
      code: "malformed_response",
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      new HttpWire().json({ ...request, signal: abort.signal }),
    ).rejects.toMatchObject({ code: "aborted", dispatched: false });
    server.removeAllListeners("request");
    server.on("request", () => {});
    await expect(
      new HttpWire().json({
        ...request,
        timeout_ms: 100,
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const [status, code] of [
    [401, "auth"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [413, "context_exceeded"],
    [504, "timeout"],
  ] as const) {
    expect(statusError(status, "9999999", true)).toMatchObject({
      code,
      retry_after_ms: 300000,
      dispatched: true,
    });
  }
});
