import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  X509Certificate,
} from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { nodePublicKey } from "@craftlayer/contracts";
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (
      encoded === undefined ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new Error("NODE_JSON_REQUIRED");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export const nodeDigest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function publicKey(input: string) {
  const text = nodePublicKey.parse(input),
    bytes = Buffer.from(text, "base64url"),
    key = createPublicKey({ key: bytes, format: "der", type: "spki" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    key.export({ format: "der", type: "spki" }).toString("base64url") !== text
  )
    throw new Error("NODE_ED25519_REQUIRED");
  return key;
}
export function generateNodeKey() {
  const pair = generateKeyPairSync("ed25519");
  return {
    public_key: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
    private_key: pair.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
}
export function signNodeValue(value: unknown, privateKey: string) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("NODE_ED25519_REQUIRED");
  return sign(null, Buffer.from(canonical(value)), key).toString("base64url");
}
export function verifyNodeValue(
  value: unknown,
  signature: string,
  key: string,
) {
  try {
    return verify(
      null,
      Buffer.from(canonical(value)),
      publicKey(key),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
export function nodeTimeWindow(now = Date.now()) {
  return {
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 30000).toISOString(),
  };
}
export function assertNodeTime(issued: string, expires: string, now: number) {
  const start = Date.parse(issued),
    end = Date.parse(expires);
  if (
    start > now + 5000 ||
    start < now - 30000 ||
    end <= now ||
    end <= start ||
    end - start > 30000
  )
    throw new Error("NODE_PROOF_EXPIRED");
}
export function certificateHash(raw: Buffer | string) {
  const cert = new X509Certificate(raw);
  return createHash("sha256").update(cert.raw).digest("hex");
}
export async function protectedNodeFile(
  path: string,
  owner = process.getuid?.(),
) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const s = await file.stat();
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== owner ||
      (s.mode & 0o077) !== 0 ||
      s.size > 16384
    )
      throw new Error("NODE_FILE_NOT_PRIVATE");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
export function nodePrivateKey(input: string) {
  const key = createPrivateKey(input);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("NODE_ED25519_REQUIRED");
  return {
    private_key: input,
    public_key: createPublicKey(key)
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
  };
}
export { privateNodeAddress } from "./network.js";
