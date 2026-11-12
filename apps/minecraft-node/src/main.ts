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
import { ActionJournal } from "./action-journal.js";
import {
  gameChannel,
  gameServerConfig,
  runServerAction,
} from "./action-runner.js";
import { ActionWorker } from "./action-worker.js";
import { BackupJournal } from "./backup-journal.js";
import {
  assertBackupDirectories,
  type BackupTarget,
  resumeSaving,
  runBackup,
} from "./backup-runner.js";
import { BackupWorker } from "./backup-worker.js";
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
        /** Game servers this node may act on through a private control channel. */
        game_servers: z.array(gameServerConfig).max(8).optional(),
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
    const games = config.game_servers ?? [];
    if (new Set(games.map((g) => g.server_id)).size !== games.length)
      throw new Error("NODE_GAME_SERVERS_DUPLICATED");
    const channels = new Map(games.map((g) => [g.server_id, gameChannel(g)]));
    const worker = games.length
      ? new ActionWorker({
          serverIds: games.map((g) => g.server_id),
          journal: new ActionJournal(config.journal_directory, config.node_id),
          poll: async (server_ids) =>
            transport.actionPoll({
              ...base(),
              purpose: "node.actions.poll.v1",
              sequence: await journal.next(),
              server_ids,
            }),
          report: async (result) =>
            transport.actionResult({
              ...base(),
              purpose: "node.actions.result.v1",
              sequence: await journal.next(),
              ...result,
            }),
          run: (offer) => {
            const channel = channels.get(offer.server_id);
            if (!channel) throw new Error("NODE_GAME_SERVER_UNKNOWN");
            return runServerAction(offer, channel);
          },
          log: (code) => console.error(`${code}; values omitted`),
        })
      : null;
    // Backups only for servers whose world and archive directories the operator named.
    const targets = new Map<string, BackupTarget>();
    for (const g of games) {
      if (!g.data_directory !== !g.backup_directory)
        throw new Error("NODE_BACKUP_DIRECTORIES_INCOMPLETE");
      const channel = channels.get(g.server_id);
      if (!g.data_directory || !g.backup_directory || !channel) continue;
      assertBackupDirectories(g.data_directory, g.backup_directory);
      targets.set(g.server_id, {
        channel,
        dataDirectory: g.data_directory,
        backupDirectory: g.backup_directory,
      });
    }
    const log = (code: string) => console.error(`${code}; values omitted`);
    const backups = targets.size
      ? new BackupWorker({
          serverIds: [...targets.keys()],
          journal: new BackupJournal(config.journal_directory, config.node_id),
          poll: async (server_ids) =>
            transport.backupPoll({
              ...base(),
              purpose: "node.backups.poll.v1",
              sequence: await journal.next(),
              server_ids,
            }),
          report: async (result) =>
            transport.backupResult({
              ...base(),
              purpose: "node.backups.result.v1",
              sequence: await journal.next(),
              ...result,
            }),
          run: (offer) => {
            const target = targets.get(offer.server_id);
            if (!target) throw new Error("NODE_GAME_SERVER_UNKNOWN");
            return runBackup(offer, target, { log });
          },
          resume: async (serverId) => {
            const target = targets.get(serverId);
            return target ? resumeSaving(target.channel) : false;
          },
          log,
        })
      : null;
    let enrolled = false,
      backoff = 1000,
      heartbeatDue = 0,
      actionsDue = 0,
      backupsDue = 0;
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
              worker
                ? `NODE_ACTIVE: inventory${backups ? ", backups" : ""} and typed game actions for configured servers; no Docker mutation capability`
                : "NODE_ACTIVE: inventory-only; no game or Docker mutation capability",
            );
          }
          if (Date.now() >= heartbeatDue) {
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
            heartbeatDue = Date.now() + 10000;
          }
          if (worker && Date.now() >= actionsDue) {
            try {
              // Work through a short burst, then yield to the heartbeat.
              for (let i = 0; i < 4 && !stopped && (await worker.tick()); i++);
            } catch (e) {
              // A gateway without action dispatch answers 404: keep the inventory link
              // and ask again later rather than stopping the agent.
              if (!(e instanceof NodeTransportFailure) || e.status !== 404)
                throw e;
              console.error("NODE_ACTIONS_NOT_OFFERED; asking again later");
              actionsDue = Date.now() + 60000;
            }
          }
          if (backups && Date.now() >= backupsDue) {
            backupsDue = Date.now() + 15000;
            try {
              await backups.tick();
            } catch (e) {
              if (!(e instanceof NodeTransportFailure) || e.status !== 404)
                throw e;
              console.error("NODE_BACKUPS_NOT_OFFERED; asking again later");
              backupsDue = Date.now() + 60000;
            }
          }
          backoff = 1000;
          await wait(worker ? 2000 : 10000);
        } catch (e) {
          if (!(e instanceof NodeTransportFailure) || !e.retryable) throw e;
          console.error("NODE_LINK_UNAVAILABLE: bounded retry; values omitted");
          enrolled = false;
          await wait(backoff);
          backoff = Math.min(backoff * 2, 10000);
        }
      }
    } finally {
      // Let a backup in flight resume saving and record its outcome before leaving.
      await backups?.settle();
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
