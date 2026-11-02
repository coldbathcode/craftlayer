import { execFileSync } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  certificateHash,
  generateNodeKey,
  protectedNodeFile,
} from "../../packages/node-protocol/src/index.js";

// Explicit local fixture renewal, never a production certificate issuer.
const [directory, caDirectory, ...extra] = process.argv.slice(2);
try {
  if (
    !directory?.startsWith("/") ||
    !caDirectory?.startsWith("/") ||
    extra.length
  )
    throw new Error("NEW_LOCAL_IDENTITY_DIRECTORY_REQUIRED");
  const metadata = JSON.parse(
    await protectedNodeFile(join(caDirectory, "public.json")),
  );
  const ca = new X509Certificate(
    await protectedNodeFile(join(caDirectory, "ca.crt")),
  );
  await protectedNodeFile(join(caDirectory, "ca.key"));
  if (
    metadata.purpose !== "local-node-test" ||
    ca.subject !== "CN=CraftLayer local test CA" ||
    Date.parse(ca.validTo) <= Date.now()
  )
    throw new Error("VALID_LOCAL_FIXTURE_CA_REQUIRED");
  await mkdir(directory, { mode: 0o700 });
  const run = (args: string[]) =>
    execFileSync("openssl", args, {
      cwd: directory,
      stdio: "ignore",
      timeout: 30000,
    });
  await writeFile(
    join(directory, "openssl.cnf"),
    "[req]\ndistinguished_name=dn\n[dn]\n",
    { mode: 0o600, flag: "wx" },
  );
  run([
    "req",
    "-new",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-sha256",
    "-subj",
    "/CN=CraftLayer local renewed client",
    "-config",
    "openssl.cnf",
    "-keyout",
    "client.key",
    "-out",
    "client.csr",
  ]);
  await writeFile(
    join(directory, "client.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n",
    { mode: 0o600, flag: "wx" },
  );
  run([
    "x509",
    "-req",
    "-in",
    "client.csr",
    "-CA",
    join(caDirectory, "ca.crt"),
    "-CAkey",
    join(caDirectory, "ca.key"),
    "-set_serial",
    `0x${randomBytes(16).toString("hex")}`,
    "-days",
    "1",
    "-sha256",
    "-extfile",
    "client.ext",
    "-out",
    "client.crt",
  ]);
  const pair = generateNodeKey();
  await writeFile(join(directory, "agent.key"), pair.private_key, {
    mode: 0o600,
    flag: "wx",
  });
  const info = {
    public_key: pair.public_key,
    certificate_sha256: certificateHash(
      await readFile(join(directory, "client.crt")),
    ),
  };
  await writeFile(join(directory, "public.json"), JSON.stringify(info), {
    mode: 0o600,
    flag: "wx",
  });
  for (const name of await readdir(directory))
    await chmod(join(directory, name), 0o600);
  console.log(JSON.stringify(info));
} catch {
  console.error(
    "NODE_LOCAL_IDENTITY_FIXTURE_FAILED; existing identity and host trust retained",
  );
  process.exitCode = 1;
}
