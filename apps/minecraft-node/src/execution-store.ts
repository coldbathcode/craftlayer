import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  type NodeExecutionPolicy,
  nodeCommand,
  signedNodeCommandReceipt,
} from "@craftlayer/contracts";
import { z } from "zod";
import { NodeJournal } from "./journal.js";

const record = z.strictObject({
  command: nodeCommand,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  intent_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum([
    "prepared",
    "dispatching",
    "succeeded",
    "not_dispatched",
    "uncertain",
  ]),
  receipt: signedNodeCommandReceipt.nullable(),
});
const snapshot = z.strictObject({
  schema_version: z.literal(1),
  node_id: z.uuid(),
  organization_id: z.uuid(),
  project_id: z.uuid(),
  control_id: z.string(),
  credential_floor: z.number().int().positive(),
  policy_floor: z.number().int().positive(),
  last_wall_ms: z.number().int().nonnegative(),
  stopped: z.boolean(),
  stop_generation: z.number().int().nonnegative().max(2147483646),
  resources: z
    .record(
      z.uuid(),
      z.strictObject({
        server_id: z.uuid(),
        world_id: z.uuid(),
        fence: z.number().int().positive(),
        provisioned: z.boolean(),
        retired: z.boolean(),
        unresolved: z.uuid().nullable(),
      }),
    )
    .refine((v) => Object.keys(v).length <= 128),
  commands: z
    .record(z.uuid(), record)
    .refine((v) => Object.keys(v).length <= 128),
});
export type ExecutionSnapshot = z.infer<typeof snapshot>;
const maxBytes = 512 * 1024;

/** Operator-private, bounded, fsynced snapshots. A missing/corrupt old store never resets safety state. */
export class ExecutionStore {
  #journal: NodeJournal;
  #open = false;
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
    if (this.#open) throw new Error("NODE_EXECUTION_STORE_ALREADY_OPEN");
    const created = await this.#journal.lock();
    try {
      if (created)
        await this.#write({
          schema_version: 1,
          node_id: this.policy.node_id,
          organization_id: this.policy.organization_id,
          project_id: this.policy.project_id,
          control_id: this.policy.control_id,
          credential_floor: this.policy.credential_version,
          policy_floor: this.policy.policy_revision,
          last_wall_ms: 0,
          stopped: false,
          stop_generation: 0,
          resources: {},
          commands: {},
        });
      const state = await this.#read();
      if (
        state.node_id !== this.policy.node_id ||
        state.organization_id !== this.policy.organization_id ||
        state.project_id !== this.policy.project_id ||
        state.control_id !== this.policy.control_id ||
        this.policy.credential_version < state.credential_floor ||
        this.policy.policy_revision < state.policy_floor
      )
        throw new Error("NODE_EXECUTION_BINDING_DENIED");
      state.credential_floor = this.policy.credential_version;
      state.policy_floor = this.policy.policy_revision;
      await this.#write(state);
      this.#open = true;
    } catch (e) {
      await this.#journal.close();
      throw e;
    }
  }
  async #read() {
    const file = await open(
      join(this.directory, "execution.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > maxBytes
      )
        throw new Error("NODE_EXECUTION_STORE_NOT_PRIVATE");
      const value = snapshot.parse(JSON.parse(await file.readFile("utf8")));
      if (
        value.node_id !== this.policy.node_id ||
        value.organization_id !== this.policy.organization_id ||
        value.project_id !== this.policy.project_id ||
        value.control_id !== this.policy.control_id
      )
        throw new Error("NODE_EXECUTION_BINDING_DENIED");
      return value;
    } finally {
      await file.close();
    }
  }
  async #write(value: ExecutionSnapshot) {
    const body = JSON.stringify(snapshot.parse(value));
    if (Buffer.byteLength(body) > maxBytes)
      throw new Error("NODE_EXECUTION_STORE_FULL");
    const path = join(this.directory, `.execution-${randomUUID()}`),
      file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(body);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(path, join(this.directory, "execution.json"));
    const directory = await open(this.directory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async transaction<T>(fn: (state: ExecutionSnapshot) => T): Promise<T> {
    if (!this.#open) throw new Error("NODE_EXECUTION_STORE_CLOSED");
    const previous = this.#tail;
    let release = () => {};
    this.#tail = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    try {
      if (!this.#open) throw new Error("NODE_EXECUTION_STORE_CLOSED");
      const state = await this.#read(),
        result = fn(state);
      await this.#write(state);
      return result;
    } finally {
      release();
    }
  }
  async close() {
    await this.#tail;
    this.#open = false;
    await this.#journal.close();
  }
}
