import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  certificateHash,
  generateNodeKey,
} from "../../packages/node-protocol/src/index.js";
/** Local certificate fixture only. Never overwrites a directory or installs host trust. */
export async function createNodeFixture(directory: string) {
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
    "-x509",
    "-newkey",
    "rsa:3072",
    "-nodes",
    "-sha256",
    "-days",
    "2",
    "-subj",
    "/CN=CraftLayer local test CA",
    "-config",
    "openssl.cnf",
    "-addext",
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
  ]);
  for (const name of ["server", "client", "other"] as const) {
    run([
      "req",
      "-new",
      "-newkey",
      "rsa:3072",
      "-nodes",
      "-sha256",
      "-subj",
      `/CN=CraftLayer local ${name}`,
      "-config",
      "openssl.cnf",
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
    ]);
    await writeFile(
      join(directory, `${name}.ext`),
      `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=${name === "server" ? "serverAuth" : "clientAuth"}\n${name === "server" ? "subjectAltName=IP:127.0.0.1,DNS:localhost\n" : ""}`,
      { mode: 0o600, flag: "wx" },
    );
    run([
      "x509",
      "-req",
      "-in",
      `${name}.csr`,
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-set_serial",
      `0x${randomBytes(16).toString("hex")}`,
      "-days",
      "2",
      "-sha256",
      "-extfile",
      `${name}.ext`,
      "-out",
      `${name}.crt`,
    ]);
  }
  const control = generateNodeKey(),
    agent = generateNodeKey();
  await writeFile(join(directory, "control.key"), control.private_key, {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(join(directory, "agent.key"), agent.private_key, {
    mode: 0o600,
    flag: "wx",
  });
  const info = {
    purpose: "local-node-test" as const,
    public_key: agent.public_key,
    certificate_sha256: certificateHash(
      await readFile(join(directory, "client.crt")),
    ),
    control_public_key: control.public_key,
    server_certificate_sha256: certificateHash(
      await readFile(join(directory, "server.crt")),
    ),
  };
  await writeFile(join(directory, "public.json"), JSON.stringify(info), {
    mode: 0o600,
    flag: "wx",
  });
  for (const name of await readdir(directory))
    await chmod(join(directory, name), 0o600);
  return info;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  void (async () => {
    const path = process.argv[2];
    if (!path?.startsWith("/") || process.argv.length !== 3)
      throw new Error("New absolute fixture directory required");
    console.log(JSON.stringify(await createNodeFixture(path)));
  })().catch(() => {
    console.error(
      "NODE_LOCAL_PKI_FIXTURE_FAILED; no host trust installed or existing files replaced",
    );
    process.exitCode = 1;
  });
