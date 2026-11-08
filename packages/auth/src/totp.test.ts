import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  totpAt,
  verifyTotp,
} from "./totp.js";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890" (8-digit values; we take the last 6).
const secret = Buffer.from("12345678901234567890", "ascii");
const vectors: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];
describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    for (const [seconds, eight] of vectors)
      expect(totpAt(secret, seconds * 1000)).toBe(eight.slice(2));
    expect(hotp(secret, 1n, 8)).toBe("94287082");
  });
  it("round-trips base32 and produces a standard otpauth URI", () => {
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-GY3TQOJQGEZDGNBVGY3TQOJQ")).toEqual(secret);
    expect(() => base32Decode("1!")).toThrow("BASE32_INVALID");
    const uri = otpauthUri("CraftLayer", "oli@family", secret);
    expect(uri.startsWith("otpauth://totp/CraftLayer:oli%40family?")).toBe(
      true,
    );
    expect(uri).toContain("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(uri).toContain("issuer=CraftLayer");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
  it("accepts one step of drift, refuses replay, bad formats and far-off codes", () => {
    const now = 1111111111 * 1000;
    const current = totpAt(secret, now),
      previous = totpAt(secret, now - 30000),
      next = totpAt(secret, now + 30000),
      far = totpAt(secret, now + 90000);
    const step = verifyTotp(secret, current, now, 0n);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, previous, now, 0n)).not.toBeNull();
    expect(verifyTotp(secret, next, now, 0n)).not.toBeNull();
    expect(verifyTotp(secret, far, now, 0n)).toBeNull();
    // Replay: once a step is accepted, that code and older ones are dead.
    expect(verifyTotp(secret, current, now, step ?? 0n)).toBeNull();
    expect(verifyTotp(secret, previous, now, step ?? 0n)).toBeNull();
    expect(verifyTotp(secret, "12345", now, 0n)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now, 0n)).toBeNull();
  });
  it("makes distinct, typeable recovery codes and normalises what people type", () => {
    const codes = newRecoveryCodes(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes)
      expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(normalizeRecoveryCode(" AbCd-EFGH 2345 6777 ")).toBe(
      "abcdefgh23456777",
    );
  });
});
