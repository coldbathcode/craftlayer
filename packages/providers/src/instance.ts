import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import {
  budgetLimitsSchema,
  defaultInstanceLimits,
  microUsd,
} from "@craftlayer/contracts";
import { z } from "zod";
import { ProviderError } from "./index.js";

export const localAddress = (address: string) =>
  address === "::1" ||
  /^(fc|fd)[0-9a-f:]+$/i.test(address) ||
  (isIP(address) === 4 &&
    (() => {
      const p = address.split(".").map(Number);
      return (
        p[0] === 127 ||
        p[0] === 10 ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 172 && (p[1] ?? 0) >= 16 && (p[1] ?? 0) <= 31)
      );
    })());
export const approvedLocalSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  url: z.url().refine((value) => {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/"
    );
  }),
  addresses: z
    .array(
      z.string().refine((value) => isIP(value) !== 0 && localAddress(value)),
    )
    .min(1)
    .max(8),
  models: z
    .array(
      z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,179}$/)
        .refine(
          (value) =>
            !value.includes("..") &&
            !value.includes(":cloud") &&
            !value.endsWith("-cloud"),
        ),
    )
    .min(1)
    .max(32),
  cloud_disabled: z.literal(true),
  context_tokens: z.number().int().min(1024).max(131072),
  output_tokens: z.number().int().min(1).max(8192),
});
const priceAmount = z.string().regex(/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,18})?$/);
/** Every price dimension, USD per token (request: per request; image: per image; audio: per second; tool: per call). */
export const priceTableSchema = z.strictObject({
  input: priceAmount,
  output: priceAmount,
  cache_read: priceAmount,
  cache_write: priceAmount,
  request: priceAmount,
  image: priceAmount,
  audio: priceAmount,
  reasoning: priceAmount,
  tool: priceAmount,
});
export const compatibleModelSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,179}$/)
    .refine((value) => !value.includes("..")),
  context_tokens: z.number().int().min(1024).max(2_000_000),
  output_tokens: z.number().int().min(1).max(1_000_000),
  tools: z.boolean(),
  structured: z.boolean(),
  prices: priceTableSchema,
  /** Where the operator took the prices from, and when. */
  price_source: z.string().trim().min(1).max(200),
  price_checked_on: z.iso.date(),
});
/**
 * An OpenAI-compatible chat endpoint the instance operator approves, for
 * example Kong AI Gateway in front of several providers. The operator declares
 * its models and full price table; nothing is discovered from the endpoint.
 */
export const compatibleEndpointSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    label: z.string().trim().min(1).max(80),
    flavor: z.enum([
      "kong_ai_gateway",
      "generic",
      "openai",
      "anthropic",
      "google_gemini",
    ]),
    /**
     * Request format. "openai_chat" (default) for OpenAI-format chat completions:
     * Kong AI Gateway, OpenRouter-style gateways, OpenAI and Gemini's OpenAI endpoint.
     * "anthropic_messages" for Anthropic's Messages API (path "messages", x-api-key).
     */
    api: z.enum(["openai_chat", "anthropic_messages"]).default("openai_chat"),
    url: z.url().refine((value) => {
      const u = new URL(value);
      return (
        ["http:", "https:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }),
    /** Chat completions path relative to url, e.g. "chat/completions" or "v1/chat/completions". */
    chat_path: z
      .string()
      .regex(/^[a-zA-Z0-9._~-]+(\/[a-zA-Z0-9._~-]+)*$/)
      .refine((value) => !value.split("/").includes(".."))
      .default("chat/completions"),
    /** Header that carries the credential: Kong key-auth uses "apikey". */
    auth_header: z.enum(["authorization", "apikey", "x-api-key"]),
    /** public: must resolve to public addresses. private: only the listed LAN/tailnet addresses. */
    network: z.enum(["public", "private"]),
    addresses: z.array(z.string()).max(8).default([]),
    models: z.array(compatibleModelSchema).min(1).max(32),
  })
  .refine(
    (e) =>
      e.network === "public"
        ? e.addresses.length === 0
        : e.addresses.length > 0 &&
          e.addresses.every((a) => isIP(a) !== 0 && privateAddress(a)),
    "Private endpoints list their LAN/tailnet addresses; public endpoints list none",
  )
  .refine(
    (e) => new URL(e.url).protocol === "https:" || e.network === "private",
    "Public endpoints require HTTPS",
  )
  .refine(
    (e) =>
      e.api === "openai_chat" ||
      (e.auth_header === "x-api-key" && e.chat_path.endsWith("messages")),
    "Anthropic Messages endpoints use the x-api-key header and a messages path",
  )
  .refine(
    (e) => new Set(e.models.map((m) => m.id)).size === e.models.length,
    "Duplicate model IDs",
  );
/** LAN, loopback or Tailscale (100.64.0.0/10) address. */
export const privateAddress = (address: string) =>
  localAddress(address) ||
  (isIP(address) === 4 &&
    (() => {
      const p = address.split(".").map(Number);
      return p[0] === 100 && (p[1] ?? 0) >= 64 && (p[1] ?? 0) <= 127;
    })());
export type CompatibleEndpoint = z.infer<typeof compatibleEndpointSchema>;
export const instancePolicySchema = z
  .strictObject({
    limits: budgetLimitsSchema.default(defaultInstanceLimits),
    version: z.number().int().positive(),
    openrouter_enabled: z.boolean(),
    openrouter_models: z.array(z.string().max(180)).max(32).default([]),
    allow_paid: z.boolean(),
    max_paid_micro_usd: microUsd,
    stopped: z.boolean(),
    ollama: z.array(approvedLocalSchema).max(16),
    openai_compatible: z.array(compatibleEndpointSchema).max(16).default([]),
  })
  .refine(
    (p) => new Set(p.ollama.map((e) => e.id)).size === p.ollama.length,
    "Duplicate endpoint IDs",
  )
  .refine(
    (p) =>
      new Set(p.openai_compatible.map((e) => e.id)).size ===
      p.openai_compatible.length,
    "Duplicate compatible endpoint IDs",
  );
export type InstancePolicy = z.infer<typeof instancePolicySchema>;
export type ApprovedLocal = z.infer<typeof approvedLocalSchema>;
export const disabledInstance: InstancePolicy = {
  limits: { ...defaultInstanceLimits },
  version: 1,
  openrouter_enabled: false,
  openrouter_models: [],
  allow_paid: false,
  max_paid_micro_usd: "0",
  stopped: false,
  ollama: [],
  openai_compatible: [],
};
const keyRingSchema = z
  .strictObject({
    active: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
    keys: z.record(
      z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
      z.string().regex(/^[a-f0-9]{64}$/),
    ),
  })
  .refine(
    (r) => Object.hasOwn(r.keys, r.active) && Object.keys(r.keys).length <= 16,
    "Invalid active key",
  );
export type KeyRing = z.infer<typeof keyRingSchema>;
export async function protectedJson(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid?.() ||
      info.size > 65536
    )
      throw new Error("Unsafe protected file");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
export class ProviderFiles {
  constructor(
    private paths: { keys?: string | undefined; policy?: string | undefined },
  ) {}
  async policy(): Promise<InstancePolicy> {
    if (!this.paths.policy) return structuredClone(disabledInstance);
    try {
      return instancePolicySchema.parse(await protectedJson(this.paths.policy));
    } catch {
      throw new ProviderError("policy_denied", false);
    }
  }
  async stamp() {
    return createHash("sha256")
      .update(
        JSON.stringify([
          await this.policy(),
          this.paths.keys ? await this.keys() : null,
        ]),
      )
      .digest("hex");
  }
  async keys(): Promise<KeyRing> {
    if (!this.paths.keys) throw new ProviderError("policy_denied", false);
    try {
      return keyRingSchema.parse(await protectedJson(this.paths.keys));
    } catch {
      throw new ProviderError("policy_denied", false);
    }
  }
}
