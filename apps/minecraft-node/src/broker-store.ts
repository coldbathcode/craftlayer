import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import type { NodeExecutionPolicy } from "@craftlayer/contracts";
import { z } from "zod";
import { NodeJournal } from "./journal.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  dockerId = z.string().regex(/^[a-f0-9]{64}$/);
export const brokerProof = z.strictObject({
  verified: z.literal(true),
  outcome: z.enum(["applied", "rolled_back", "not_dispatched"]),
  evidence_hash: hash,
});
const deployment = z.strictObject({
  manifest_hash: hash,
  owner_nonce: z.uuid(),
  server_id: z.uuid(),
  world_id: z.uuid(),
  container_id: dockerId.nullable(),
  network_id: dockerId.nullable(),
  provisioned: z.boolean(),
  retired: z.boolean(),
  fence: z.number().int().positive(),
  command_id: z.uuid(),
  command_hash: hash,
  pending: z.boolean(),
  intent: z
    .enum([
      "image",
      "network_create",
      "container_create",
      "start",
      "stop",
      "container_remove",
      "network_remove",
    ])
    .nullable(),
  proof: brokerProof.nullable(),
});
const snapshot = z.strictObject({
  schema_version: z.literal(1),
  organization_id: z.uuid(),
  project_id: z.uuid(),
  node_id: z.uuid(),
  control_id: hash,
  credential_floor: z.number().int().positive(),
  policy_floor: z.number().int().positive(),
  deployments: z
    .record(z.uuid(), deployment)
    .refine((v) => Object.keys(v).length <= 128),
});
export type BrokerSnapshot = z.infer<typeof snapshot>;
export type BrokerDeployment = z.infer<typeof deployment>;
export type BrokerProof = z.infer<typeof brokerProof>;

/** Separate private journal: deleting/resetting this file is never recovery. */
export class BrokerStore {
  #journal: NodeJournal;
  #opened = false;
  #tail = Promise.resolve();
  constructor(
    private readonly directory: string,
    private readonly policy: NodeExecutionPolicy,
  ) {
    this.#journal = new NodeJournal(
      directory,
      policy.node_id,
      policy.credential_version,
    );
  }
  async open() {
    if (this.#opened) throw new Error("NODE_BROKER_STORE_ALREADY_OPEN");
    const created = await this.#journal.lock();
    try {
      if (created)
        await this.#write({
          schema_version: 1,
          organization_id: this.policy.organization_id,
          project_id: this.policy.project_id,
          node_id: this.policy.node_id,
          control_id: this.policy.control_id,
          credential_floor: this.policy.credential_version,
          policy_floor: this.policy.policy_revision,
          deployments: {},
        });
      const s = await this.#read();
      if (
        this.policy.credential_version < s.credential_floor ||
        this.policy.policy_revision < s.policy_floor
      )
        throw new Error("NODE_BROKER_BINDING_DENIED");
      s.credential_floor = this.policy.credential_version;
      s.policy_floor = this.policy.policy_revision;
      await this.#write(s);
      this.#opened = true;
    } catch (e) {
      await this.#journal.close();
      throw e;
    }
  }
  async #read() {
    const file = await open(
      join(this.directory, "broker.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = await file.stat();
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        st.uid !== process.getuid?.() ||
        (st.mode & 0o077) !== 0 ||
        st.size > 1024 * 1024
      )
        throw new Error("NODE_BROKER_STORE_NOT_PRIVATE");
      const s = snapshot.parse(JSON.parse(await file.readFile("utf8")));
      for (const key of [
        "organization_id",
        "project_id",
        "node_id",
        "control_id",
      ] as const)
        if (s[key] !== this.policy[key])
          throw new Error("NODE_BROKER_BINDING_DENIED");
      return s;
    } finally {
      await file.close();
    }
  }
  async #write(s: BrokerSnapshot) {
    const body = JSON.stringify(snapshot.parse(s));
    if (Buffer.byteLength(body) > 1024 * 1024)
      throw new Error("NODE_BROKER_STORE_FULL");
    const path = join(this.directory, `.broker-${randomUUID()}`),
      file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(body);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(path, join(this.directory, "broker.json"));
    const dir = await open(this.directory, constants.O_RDONLY);
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async transaction<T>(fn: (s: BrokerSnapshot) => T): Promise<T> {
    const previous = this.#tail;
    let release = () => {};
    this.#tail = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    try {
      if (!this.#opened) throw new Error("NODE_BROKER_STORE_CLOSED");
      const s = await this.#read(),
        result = fn(s);
      await this.#write(s);
      return result;
    } finally {
      release();
    }
  }
  async close() {
    await this.#tail;
    this.#opened = false;
    await this.#journal.close();
  }
}
