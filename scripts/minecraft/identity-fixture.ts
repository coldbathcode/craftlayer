import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z
  .strictObject({
    component: z.enum(["paper", "geyser", "floodgate"]),
    version: z.string().regex(/^[0-9.]+$/),
    build: z.number().int().positive(),
    filename: z.enum([
      "paper.jar",
      "Geyser-Spigot.jar",
      "floodgate-spigot.jar",
    ]),
    sha256: hash,
    url: z.url(),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .superRefine((v, c) => {
    const expected =
      v.component === "paper"
        ? `https://fill-data.papermc.io/v1/objects/${v.sha256}/paper-${v.version}-${v.build}.jar`
        : `https://download.geysermc.org/v2/projects/${v.component}/versions/${v.version}/builds/${v.build}/downloads/spigot`;
    const filename = {
      paper: "paper.jar",
      geyser: "Geyser-Spigot.jar",
      floodgate: "floodgate-spigot.jar",
    }[v.component];
    if (v.url !== expected || v.filename !== filename)
      c.addIssue({
        code: "custom",
        message: "Artifact is not a pinned official download",
      });
  });
export const identityCandidate = z
  .strictObject({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9_-]{1,100}$/),
    qualification: z.literal("unqualified"),
    researched_at: z.iso.date(),
    java_major: z.literal(25),
    java_image: z
      .string()
      .regex(/^eclipse-temurin:25-jre@sha256:[a-f0-9]{64}$/),
    minecraft_java: z.string().regex(/^[0-9.]+$/),
    bedrock_versions: z
      .array(z.string().regex(/^[0-9.]+$/))
      .min(1)
      .max(30),
    artifacts: z.array(artifact).length(3),
    policy: z.strictObject({
      online_mode: z.literal(true),
      white_list: z.literal(true),
      enforce_whitelist: z.literal(true),
      public_rcon: z.literal(false),
      account_linking: z.literal("blocked_pending_review"),
      eula_accepted: z.literal(false),
    }),
    sources: z.record(z.string(), z.url()),
  })
  .superRefine((v, c) => {
    if (new Set(v.artifacts.map((a) => a.component)).size !== 3)
      c.addIssue({
        code: "custom",
        message: "Each component must be pinned once",
      });
  });
export type IdentityCandidate = z.infer<typeof identityCandidate>;
const maxArtifactBytes = 128 * 1024 * 1024;
const guardFiles = {
  "eula.txt": "eula=false\n",
  "server.properties":
    "online-mode=true\nwhite-list=true\nenforce-whitelist=true\nenable-rcon=false\nenable-query=false\nserver-ip=127.0.0.1\n",
  "whitelist.json": "[]\n",
  "ops.json": "[]\n",
};
async function protectedText(path: string, owner: number) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const s = await file.stat();
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.size > 4096 ||
      s.uid !== owner ||
      (s.mode & 0o077) !== 0
    )
      throw new Error("UNTRUSTED_FIXTURE_FILE");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

export async function loadIdentityCandidate() {
  return identityCandidate.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../infra/minecraft/identity-candidate.lock.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
}
const relative = (a: IdentityCandidate["artifacts"][number]) =>
  a.component === "paper" ? a.filename : join("plugins", a.filename);
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
type ReadArtifact = (url: string) => AsyncIterable<Uint8Array>;
async function* download(url: string) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "User-Agent":
        "CraftLayer-fixture/0.1 (https://github.com/coldbathcode/craftlayer)",
    },
  });
  if (!r.ok || !r.body) throw new Error("ARTIFACT_DOWNLOAD_UNAVAILABLE");
  if (Number(r.headers.get("content-length") ?? 0) > maxArtifactBytes) {
    await r.body.cancel();
    throw new Error("ARTIFACT_TOO_LARGE");
  }
  for await (const chunk of r.body) yield chunk;
}
/** Always creates a new private temp directory; never opens an existing world. */
export async function prepareIdentityFixture(
  input: unknown,
  read: ReadArtifact = download,
) {
  const profile = identityCandidate.parse(input),
    directory = await mkdtemp(join(tmpdir(), "craftlayer-identity-candidate-"));
  const operation = randomUUID();
  await writeFile(
    join(directory, "fixture.json"),
    JSON.stringify({
      schema_version: 1,
      operation_id: operation,
      profile_hash: digest(profile),
      qualification: "unqualified",
      eula_accepted: false,
    }),
    { mode: 0o600, flag: "wx" },
  );
  await mkdir(join(directory, "plugins"), { mode: 0o700 });
  for (const [name, content] of Object.entries(guardFiles))
    await writeFile(join(directory, name), content, {
      mode: 0o600,
      flag: "wx",
    });
  for (const a of profile.artifacts) {
    const target = join(directory, `${relative(a)}.part`),
      file = await open(target, "wx", 0o600),
      hasher = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of read(a.url)) {
        bytes += chunk.length;
        if (bytes > maxArtifactBytes) throw new Error("ARTIFACT_TOO_LARGE");
        hasher.update(chunk);
        await file.writeFile(chunk);
      }
      if (bytes === 0 || hasher.digest("hex") !== a.sha256)
        throw new Error("ARTIFACT_HASH_MISMATCH");
    } finally {
      await file.close();
    }
    // Keep the .part name deliberately: preparation cannot be mistaken for a runnable server.
  }
  return {
    directory,
    operation_id: operation,
    profile_hash: digest(profile),
    qualification: "unqualified" as const,
  };
}
export async function verifyIdentityFixture(directory: string, input: unknown) {
  const profile = identityCandidate.parse(input),
    stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error("UNTRUSTED_FIXTURE_DIRECTORY");
  const plugins = await lstat(join(directory, "plugins"));
  if (
    !plugins.isDirectory() ||
    plugins.isSymbolicLink() ||
    plugins.uid !== stat.uid ||
    (plugins.mode & 0o077) !== 0
  )
    throw new Error("UNTRUSTED_PLUGIN_DIRECTORY");
  const marker = z
    .strictObject({
      schema_version: z.literal(1),
      operation_id: z.uuid(),
      profile_hash: hash,
      qualification: z.literal("unqualified"),
      eula_accepted: z.literal(false),
    })
    .parse(
      JSON.parse(
        await protectedText(join(directory, "fixture.json"), stat.uid),
      ),
    );
  if (marker.profile_hash !== digest(profile))
    throw new Error("FIXTURE_PROFILE_CHANGED");
  for (const [name, content] of Object.entries(guardFiles))
    if ((await protectedText(join(directory, name), stat.uid)) !== content)
      throw new Error("FIXTURE_SAFETY_CONFIG_CHANGED");
  for (const a of profile.artifacts) {
    const path = join(directory, `${relative(a)}.part`);
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const hasher = createHash("sha256");
    let bytes = 0;
    try {
      const s = await file.stat();
      if (
        !s.isFile() ||
        s.nlink !== 1 ||
        s.size > maxArtifactBytes ||
        s.uid !== stat.uid ||
        (s.mode & 0o077) !== 0
      )
        throw new Error("UNTRUSTED_ARTIFACT");
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > maxArtifactBytes) throw new Error("ARTIFACT_TOO_LARGE");
        hasher.update(chunk);
      }
      const after = await file.stat();
      if (
        s.size !== after.size ||
        s.mtimeMs !== after.mtimeMs ||
        s.ctimeMs !== after.ctimeMs
      )
        throw new Error("ARTIFACT_CHANGED");
      if (!bytes || hasher.digest("hex") !== a.sha256)
        throw new Error("ARTIFACT_HASH_MISMATCH");
    } finally {
      await file.close();
    }
  }
  // This is an artifact-integrity result only, never a runtime/client qualification.
  return {
    artifact_integrity: true as const,
    identity_compatibility_verified: false as const,
    eula_accepted: false as const,
  };
}
async function main() {
  const profile = await loadIdentityCandidate();
  const [command, path, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    (command === "prepare" && path) ||
    (command !== "prepare" && (command !== "verify" || !path))
  )
    throw new Error("Use prepare, or verify <private fixture directory>");
  if (command === "prepare")
    console.log(JSON.stringify(await prepareIdentityFixture(profile)));
  else
    console.log(
      JSON.stringify(await verifyIdentityFixture(path ?? "", profile)),
    );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  void main().catch(() => {
    console.error(
      "Identity fixture preparation/verification failed. No runtime was started; partial artifacts are retained in a task-created temporary directory.",
    );
    process.exitCode = 1;
  });
