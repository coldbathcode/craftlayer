import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { openCredential, sealCredential } from "./credentials.js";
import { approvedLocalSchema, ProviderFiles } from "./instance.js";

it("binds ciphertext to tenant/connection/key/version and supports old-key rewrap", () => {
  const org = crypto.randomUUID(),
    id = crypto.randomUUID(),
    secret = "fixture-provider-key-canary",
    ring = {
      active: "one",
      keys: {
        one: randomBytes(32).toString("hex"),
        two: randomBytes(32).toString("hex"),
      },
    };
  const sealed = sealCredential(ring, org, id, 1, secret);
  expect(sealed.payload.includes(Buffer.from(secret))).toBe(false);
  expect(openCredential(ring, org, id, 1, "one", sealed.payload)).toBe(secret);
  for (const args of [
    [crypto.randomUUID(), id, 1, "one"],
    [org, crypto.randomUUID(), 1, "one"],
    [org, id, 2, "one"],
    [org, id, 1, "two"],
  ] as const)
    expect(() =>
      openCredential(ring, args[0], args[1], args[2], args[3], sealed.payload),
    ).toThrow();
  const tampered = Buffer.from(sealed.payload);
  tampered[13] = (tampered[13] ?? 0) ^ 1;
  expect(() => openCredential(ring, org, id, 1, "one", tampered)).toThrow();
  const rotated = sealCredential(
    { ...ring, active: "two" },
    org,
    id,
    2,
    openCredential(ring, org, id, 1, "one", sealed.payload),
  );
  expect(
    openCredential(
      { active: "two", keys: { two: ring.keys.two } },
      org,
      id,
      2,
      "two",
      rotated.payload,
    ),
  ).toBe(secret);
  expect(() =>
    openCredential(
      { active: "two", keys: { two: ring.keys.two } },
      org,
      id,
      1,
      "one",
      sealed.payload,
    ),
  ).toThrow();
});
it("rejects unsafe key-file modes and unapproved URL/address/cloud policy", async () => {
  const path = await mkdtemp(`${tmpdir()}/craftlayer-key-test-`);
  try {
    await writeFile(
      `${path}/keys`,
      JSON.stringify({ active: "one", keys: { one: "a".repeat(64) } }),
      { mode: 0o600 },
    );
    const files = new ProviderFiles({ keys: `${path}/keys` });
    expect((await files.keys()).active).toBe("one");
    await chmod(`${path}/keys`, 0o644);
    await expect(files.keys()).rejects.toMatchObject({ code: "policy_denied" });
    const base = {
      id: "local",
      url: "http://127.0.0.1:11434",
      addresses: ["127.0.0.1"],
      models: ["fixture:one"],
      cloud_disabled: true,
      context_tokens: 32768,
      output_tokens: 1024,
    };
    expect(approvedLocalSchema.safeParse(base).success).toBe(true);
    for (const patch of [
      { url: "http://user:secret@127.0.0.1:11434" },
      { url: "http://127.0.0.1:11434/path" },
      { url: "http://127.0.0.1:11434/?override=1" },
      { addresses: ["169.254.169.254"] },
      { addresses: ["8.8.8.8"] },
      { cloud_disabled: false },
      { models: ["fixture:cloud"] },
    ])
      expect(approvedLocalSchema.safeParse({ ...base, ...patch }).success).toBe(
        false,
      );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
