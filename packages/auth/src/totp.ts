import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30-second steps), the
 * profile every authenticator app supports. No dependency; vectors from the RFC. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30,
  TOTP_DIGITS = 6;
export function base32Encode(bytes: Uint8Array) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error("BASE32_INVALID");
  const out: number[] = [];
  let bits = 0,
    value = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function newTotpSecret() {
  return randomBytes(20);
}
export function hotp(
  secret: Uint8Array,
  counter: bigint,
  digits = TOTP_DIGITS,
) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const mac = createHmac("sha1", Buffer.from(secret)).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}
export const totpStep = (nowMs: number) =>
  BigInt(Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS));
export function totpAt(secret: Uint8Array, nowMs: number) {
  return hotp(secret, totpStep(nowMs));
}
/**
 * Accepts the current step and one step either side (clock drift), but never a step
 * at or before the last accepted one, so a code cannot be replayed within its window.
 * Returns the accepted step or null.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  lastStep: bigint,
) {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  for (const delta of [0n, -1n, 1n]) {
    const step = current + delta;
    if (step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (
      expected.length === code.length &&
      timingSafeEqual(expected, Buffer.from(code))
    )
      return step;
  }
  return null;
}
export function otpauthUri(issuer: string, label: string, secret: Uint8Array) {
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params}`;
}
/** Recovery codes: ten groups of easy-to-type characters, shown once, stored hashed. */
export function newRecoveryCodes(count = 8) {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(10)).slice(0, 16).toLowerCase();
    codes.push(
      `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`,
    );
  }
  return codes;
}
export const normalizeRecoveryCode = (code: string) =>
  code.toLowerCase().replace(/[^a-z2-7]/g, "");
