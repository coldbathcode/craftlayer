import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";
import { microUsd } from "@craftlayer/contracts";
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
export const instancePolicySchema = z
  .strictObject({
    version: z.number().int().positive(),
    openrouter_enabled: z.boolean(),
    openrouter_models: z.array(z.string().max(180)).max(32).default([]),
    allow_paid: z.boolean(),
    max_paid_micro_usd: microUsd,
    stopped: z.boolean(),
    ollama: z.array(approvedLocalSchema).max(16),
  })
  .refine(
    (p) => new Set(p.ollama.map((e) => e.id)).size === p.ollama.length,
    "Duplicate endpoint IDs",
  );
export type InstancePolicy = z.infer<typeof instancePolicySchema>;
export type ApprovedLocal = z.infer<typeof approvedLocalSchema>;
export const disabledInstance: InstancePolicy = {
  version: 1,
  openrouter_enabled: false,
  openrouter_models: [],
  allow_paid: false,
  max_paid_micro_usd: "0",
  stopped: false,
  ollama: [],
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
