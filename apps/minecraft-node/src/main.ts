import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  certificateHash,
  generateNodeKey,
  nodeDigest,
  nodeTimeWindow,
  protectedNodeFile,
} from "@craftlayer/node-protocol";
import { z } from "zod";
import { NodeTransport, NodeTransportFailure } from "./client.js";
import { DockerInventory } from "./docker.js";
import { NodeJournal } from "./journal.js";

const [command, path, certificate, ...extra] = process.argv.slice(2);
try {
  if (!path?.startsWith("/") || extra.length)
    throw new Error("NODE_CONFIG_REQUIRED");
  if (command === "keygen") {
    if (!certificate) throw new Error("NODE_CERTIFICATE_REQUIRED");
    const cert = await protectedNodeFile(certificate),
      pair = generateNodeKey();
    await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, "node.key"), pair.private_key, {
      mode: 0o600,
      flag: "wx",
    });
    const info = {
      public_key: pair.public_key,
      certificate_sha256: certificateHash(cert),
    };
    await writeFile(join(path, "public.json"), JSON.stringify(info), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(JSON.stringify(info));
  } else if (command === "run") {
    const config = z
      .strictObject({
        organization_id: z.uuid(),
        node_id: z.uuid(),
        credential_version: z.number().int().positive(),
        control_url: z.string(),
        control_public_key: z.string(),
        server_certificate_sha256: z.string(),
        ca_file: z.string(),
        certificate_file: z.string(),
        tls_key_file: z.string(),
        signing_key_file: z.string(),
        journal_directory: z.string().startsWith("/"),
        docker_socket: z.string().startsWith("/"),
      })
      .parse(JSON.parse(await protectedNodeFile(path)));
    const [ca, cert, key, privateKey] = await Promise.all(
      [
        config.ca_file,
        config.certificate_file,
        config.tls_key_file,
        config.signing_key_file,
      ].map((p) => protectedNodeFile(p)),
    );
    if (!ca || !cert || !key || !privateKey)
      throw new Error("NODE_PRIVATE_FILES_REQUIRED");
    const transport = new NodeTransport({
        url: config.control_url,
        ca,
        cert,
        key,
        private_key: privateKey,
        control_public_key: config.control_public_key,
        server_certificate_sha256: config.server_certificate_sha256,
      }),
      inventory = new DockerInventory(config.docker_socket),
      journal = new NodeJournal(
        config.journal_directory,
        config.node_id,
        config.credential_version,
      );
    await journal.lock();
    let stopped = false;
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        stopped = true;
      });
    const base = () => {
      return {
        schema_version: 1 as const,
        control_id: nodeDigest(config.control_public_key),
        organization_id: config.organization_id,
        node_id: config.node_id,
        credential_version: config.credential_version,
        ...nodeTimeWindow(),
      };
    };
    let enrolled = false,
      backoff = 1000;
    const wait = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms && !stopped; elapsed += 100)
        await new Promise((done) => setTimeout(done, 100));
    };
    try {
      while (!stopped) {
        try {
          if (!enrolled) {
            try {
              await transport.send({
                ...base(),
                purpose: "node.enroll.v1",
                sequence: 0,
              });
            } catch (e) {
              if (
                !(e instanceof Error) ||
                e.message !== "NODE_ALREADY_ENROLLED"
              )
                throw e;
            }
            enrolled = true;
            console.log(
              "NODE_ACTIVE: inventory-only; no game or Docker mutation capability",
            );
          }
          let capacity = null;
          try {
            capacity = await inventory.read();
          } catch {
            console.error("NODE_INVENTORY_UNAVAILABLE; values omitted");
          }
          await transport.send({
            ...base(),
            purpose: "node.heartbeat.v1",
            sequence: await journal.next(),
            capacity,
          });
          backoff = 1000;
          await wait(10000);
        } catch (e) {
          if (!(e instanceof NodeTransportFailure) || !e.retryable) throw e;
          console.error("NODE_LINK_UNAVAILABLE: bounded retry; values omitted");
          enrolled = false;
          await wait(backoff);
          backoff = Math.min(backoff * 2, 10000);
        }
      }
    } finally {
      await journal.close();
    }
  } else
    throw new Error(
      "Use keygen <new-private-directory> <client-certificate>, or run <private-config-file>",
    );
} catch {
  console.error(
    "NODE_AGENT_DENIED; validate private configuration, mTLS, enrollment and journal. Values omitted.",
  );
  process.exitCode = 1;
}
