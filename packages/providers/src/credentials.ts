import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { ProviderError } from "./index.js";
import type { KeyRing } from "./instance.js";

export const providerSecret = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);
const binding = (
  org: string,
  connection: string,
  version: number,
  key: string,
) =>
  JSON.stringify([
    "craftlayer/provider/v1",
    z.uuid().parse(org),
    z.uuid().parse(connection),
    version,
    key,
  ]);
export function sealCredential(
  ring: KeyRing,
  org: string,
  connection: string,
  version: number,
  secret: string,
) {
  providerSecret.parse(secret);
  const key = ring.keys[ring.active];
  if (!key) throw new ProviderError("policy_denied", false);
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), nonce);
  cipher.setAAD(Buffer.from(binding(org, connection, version, ring.active)));
  return {
    key_id: ring.active,
    payload: Buffer.concat([
      nonce,
      cipher.update(secret, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]),
  };
}
export function openCredential(
  ring: KeyRing,
  org: string,
  connection: string,
  version: number,
  keyId: string,
  payload: Buffer,
) {
  try {
    const key = ring.keys[keyId];
    if (!key || payload.length < 29) throw new Error("Unavailable key");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      payload.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(binding(org, connection, version, keyId)));
    cipher.setAuthTag(payload.subarray(-16));
    return providerSecret.parse(
      Buffer.concat([
        cipher.update(payload.subarray(12, -16)),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new ProviderError("auth", false);
  }
}
