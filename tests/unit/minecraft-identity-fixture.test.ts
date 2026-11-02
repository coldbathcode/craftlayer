import { createHash } from "node:crypto";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  identityCandidate,
  loadIdentityCandidate,
  prepareIdentityFixture,
  verifyIdentityFixture,
} from "../../scripts/minecraft/identity-fixture.js";

const content = Buffer.from("synthetic artifact, never executable");
const sha = createHash("sha256").update(content).digest("hex");
async function synthetic() {
  const profile = await loadIdentityCandidate();
  return {
    ...profile,
    artifacts: profile.artifacts.map((a) => ({
      ...a,
      sha256: sha,
      url:
        a.component === "paper"
          ? `https://fill-data.papermc.io/v1/objects/${sha}/paper-${a.version}-${a.build}.jar`
          : a.url,
    })),
  };
}
async function* reader() {
  yield content;
}
it("pins exact official artifacts and cannot declare a qualified or weakened candidate", async () => {
  const profile = await loadIdentityCandidate();
  expect(profile.artifacts).toHaveLength(3);
  expect(
    identityCandidate.safeParse({ ...profile, qualification: "verified" })
      .success,
  ).toBe(false);
  expect(
    identityCandidate.safeParse({
      ...profile,
      policy: { ...profile.policy, online_mode: false },
    }).success,
  ).toBe(false);
  expect(
    identityCandidate.safeParse({
      ...profile,
      artifacts: [
        { ...profile.artifacts[0], url: "https://example.invalid/evil" },
        ...profile.artifacts.slice(1),
      ],
    }).success,
  ).toBe(false);
});
it("prepares only fresh private non-runnable files, with auth and allowlist enabled, without accepting EULA", async () => {
  const profile = await synthetic(),
    fixture = await prepareIdentityFixture(profile, reader);
  try {
    expect(await verifyIdentityFixture(fixture.directory, profile)).toEqual({
      artifact_integrity: true,
      identity_compatibility_verified: false,
      eula_accepted: false,
    });
    expect(await readFile(join(fixture.directory, "eula.txt"), "utf8")).toBe(
      "eula=false\n",
    );
    expect(
      await readFile(join(fixture.directory, "server.properties"), "utf8"),
    ).toContain("enforce-whitelist=true");
    expect(
      await readFile(join(fixture.directory, "whitelist.json"), "utf8"),
    ).toBe("[]\n");
    await expect(
      readFile(join(fixture.directory, "paper.jar")),
    ).rejects.toThrow();
    await writeFile(join(fixture.directory, "paper.jar.part"), "corrupt");
    await expect(
      verifyIdentityFixture(fixture.directory, profile),
    ).rejects.toThrow("ARTIFACT_HASH_MISMATCH");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
it("refuses linked artifacts and changed profiles", async () => {
  const profile = await synthetic(),
    fixture = await prepareIdentityFixture(profile, reader);
  try {
    await expect(
      verifyIdentityFixture(fixture.directory, { ...profile, id: "changed" }),
    ).rejects.toThrow("FIXTURE_PROFILE_CHANGED");
    await rm(join(fixture.directory, "paper.jar.part"));
    await symlink(
      join(fixture.directory, "plugins", "Geyser-Spigot.jar.part"),
      join(fixture.directory, "paper.jar.part"),
    );
    await expect(
      verifyIdentityFixture(fixture.directory, profile),
    ).rejects.toThrow();
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

it("refuses a changed EULA/authentication/allowlist file rather than repeating a false safety claim", async () => {
  const profile = await synthetic(),
    fixture = await prepareIdentityFixture(profile, reader);
  try {
    await writeFile(join(fixture.directory, "eula.txt"), "eula=true\n");
    await expect(
      verifyIdentityFixture(fixture.directory, profile),
    ).rejects.toThrow("FIXTURE_SAFETY_CONFIG_CHANGED");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
