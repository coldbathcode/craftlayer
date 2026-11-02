import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildNodeAgentApp } from "../../apps/api/src/node-agent-app.js";
import { ConstrainedDockerBroker } from "../../apps/minecraft-node/src/broker.js";
import { BrokerEngine } from "../../apps/minecraft-node/src/broker-engine.js";
import {
  type BrokerPlan,
  BrokerPolicy,
} from "../../apps/minecraft-node/src/broker-policy.js";
import { NodeTransport } from "../../apps/minecraft-node/src/client.js";
import { CommandTransport } from "../../apps/minecraft-node/src/command-transport.js";
import { NodeCommandExecutor } from "../../apps/minecraft-node/src/executor.js";
import {
  signedNodeCommand,
  signedNodeCommandPermit,
} from "../../packages/contracts/src/index.js";
import {
  DeploymentJobs,
  type DeploymentQualificationContext,
} from "../../packages/minecraft-control/src/index.js";
import {
  generateNodeKey,
  nodeDigest,
  nodePrivateKey,
  nodeTimeWindow,
  signNodeValue,
  verifyNodeValue,
} from "../../packages/node-protocol/src/index.js";
import { createNodeFixture } from "../../scripts/minecraft/node-fixtures.js";
import { reservationHarness } from "./fixtures/reservations.js";

const url = process.env.TEST_DEPLOYMENT_JOBS_DATABASE_URL ?? "",
  identityUrl = process.env.TEST_DEPLOYMENT_JOBS_IDENTITY_DATABASE_URL ?? "",
  h = reservationHarness(url, identityUrl);
async function fixture(
  fn: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await fn(f);
  } finally {
    await f.jobs.close();
    await f.nodes.close();
    await f.ledger.close();
  }
}
async function setup(binding?: Parameters<typeof h.setup>[0]) {
  const f = await h.setup(binding),
    r = await f.ledger.reserve(f.adult, f.org, f.input(), randomUUID());
  f.config.approval = "b".repeat(64);
  const dispatch = await f.ledger.change(
      f.adult,
      f.org,
      r.reservation_id,
      "dispatch",
      1,
      randomUUID(),
    ),
    intent = await f.ledger.queueDeployment(
      f.adult,
      f.org,
      {
        reservation_id: r.reservation_id,
        dispatch_operation_id: dispatch.operation_id,
        reservation_version: 2,
      },
      randomUUID(),
    );
  const qualification = {
    calls: 0,
    approval: "b".repeat(64),
    hook: undefined as
      | ((c: DeploymentQualificationContext) => Promise<void>)
      | undefined,
  };
  const options = {
      databaseUrl: url,
      auth: h.auth,
      controlPrivateKey: f.control.private_key,
      clock: f.now,
      policy: { revision: 1, hash: f.config.policy, stop_generation: 0 },
      qualifier: {
        inspect: async (c: DeploymentQualificationContext) => {
          qualification.calls++;
          await qualification.hook?.(c);
          return {
            qualified: true,
            request_hash: c.request_hash,
            policy_hash: c.policy_hash,
            template_hash: c.template_hash,
            approval_hash: qualification.approval,
            issued_at: new Date(f.now()).toISOString(),
            expires_at: new Date(f.now() + 5000).toISOString(),
          };
        },
      },
    },
    jobs = new DeploymentJobs(options),
    peer = {
      certificate_sha256: f.fingerprint,
      certificate_expires_at: f.now() + 86400000,
    };
  const prepare = (key = randomUUID()) =>
    jobs.prepare(f.adult, f.org, { intent_id: intent.operation_id }, key);
  const request = (
    job: { operation_id: string; command_hash: string },
    purpose: "fetch" | "permit" = "fetch",
    changes: Record<string, unknown> = {},
  ) => {
    const payload = {
      schema_version: 1,
      purpose:
        purpose === "fetch"
          ? "node.command.fetch.v1"
          : "node.command.permit.request.v1",
      control_id: nodeDigest(f.control.public_key),
      organization_id: f.org,
      project_id: f.project,
      node_id: f.node,
      credential_version: 1,
      request_id: randomUUID(),
      job_id: job.operation_id,
      command_hash: job.command_hash,
      permit_nonce: purpose === "fetch" ? null : randomUUID(),
      ...nodeTimeWindow(f.now()),
      ...changes,
    };
    return { payload, signature: signNodeValue(payload, f.agent.private_key) };
  };
  const receipt = (
    command: ReturnType<typeof signedNodeCommand.parse>,
    state:
      | "succeeded"
      | "rolled_back"
      | "not_dispatched"
      | "uncertain" = "succeeded",
  ) => {
    const v = command.payload,
      payload = {
        schema_version: 1,
        purpose: "node.command.receipt.v1",
        control_id: v.control_id,
        organization_id: v.organization_id,
        project_id: v.project_id,
        node_id: v.node_id,
        credential_version: v.credential_version,
        command_id: v.command_id,
        operation_id: v.operation_id,
        deployment_id: v.deployment_id,
        server_id: v.server_id,
        world_id: v.world_id,
        command_hash: nodeDigest(v),
        action: v.action,
        fence: v.fence,
        state,
        evidence_hash: ["succeeded", "rolled_back"].includes(state)
          ? "c".repeat(64)
          : null,
        finished_at: new Date(f.now()).toISOString(),
      };
    return { payload, signature: signNodeValue(payload, f.agent.private_key) };
  };
  return {
    ...f,
    r,
    intent,
    qualification,
    options,
    jobs,
    peer,
    prepare,
    request,
    receipt,
  };
}
it("issues one durable signed first-provision command for concurrent replay without nested identity pool leases", () =>
  fixture(async (f) => {
    const key = randomUUID(),
      jobs = await Promise.all(Array.from({ length: 6 }, () => f.prepare(key)));
    expect(new Set(jobs.map((x) => x.operation_id)).size).toBe(1);
    const job = jobs[0];
    if (!job) throw new Error("Job missing");
    expect(job.state).toBe("issued");
    const fetched = signedNodeCommand.parse(
      await f.jobs.exchange(f.request(job), f.peer),
    );
    expect(
      verifyNodeValue(fetched.payload, fetched.signature, f.control.public_key),
    ).toBe(true);
    expect(fetched.payload).toMatchObject({
      operation_id: job.operation_id,
      deployment_id: f.r.deployment_id,
      action: "provision",
      fence: 1,
      attempt: 1,
    });
    await h.tx(h.runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
      ).toBe(1);
      const outbox = (
        await c.query(
          "select * from minecraft_deployment_job_outbox where job_id=$1",
          [job.operation_id],
        )
      ).rows;
      expect(outbox).toHaveLength(1);
      expect(Object.keys(outbox[0]).sort()).toEqual([
        "created_at",
        "id",
        "job_id",
        "kind",
        "organization_id",
        "schema_version",
      ]);
      expect(
        (
          await c.query(
            "select 1 from audit_events where action='server.deployment_issued'",
          )
        ).rowCount,
      ).toBe(1);
    });
    const reopened = new DeploymentJobs(f.options);
    try {
      expect(await reopened.get(f.adult, f.org, job.operation_id)).toEqual(job);
    } finally {
      await reopened.close();
    }
    await expect(f.prepare()).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(JSON.stringify(job)).not.toContain("signature");
    expect(JSON.stringify(job)).not.toContain("grant");
  }));
it("defaults unavailable and rejects child/viewer/anonymous/foreign/current session authority", () =>
  fixture(async (f) => {
    const disabled = new DeploymentJobs({
      databaseUrl: url,
      auth: h.auth,
      controlPrivateKey: f.options.controlPrivateKey,
      policy: f.options.policy,
      clock: f.now,
    });
    try {
      await expect(
        disabled.prepare(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_UNQUALIFIED" });
    } finally {
      await disabled.close();
    }
    for (const token of ["", f.child, f.viewer])
      await expect(
        f.jobs.prepare(
          token,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: token ? 403 : 401 });
    await expect(
      f.jobs.prepare(
        f.adult,
        f.foreignOrg,
        { intent_id: f.intent.operation_id },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.jobs.prepare(
        f.adult,
        f.org,
        { intent_id: f.intent.operation_id, approval: true },
        randomUUID(),
      ),
    ).rejects.toThrow();
    expect(
      (
        await h.tx(h.runtime, f.org, (c) =>
          c.query("select 1 from minecraft_deployment_jobs"),
        )
      ).rowCount,
    ).toBe(0);
  }));
it("fresh node-signed nonce permits bind exact job/current authority and cannot replay", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      q = f.request(job, "permit"),
      permit = signedNodeCommandPermit.parse(await f.jobs.exchange(q, f.peer));
    expect(permit.payload.request_nonce).toBe(q.payload.permit_nonce);
    expect(
      verifyNodeValue(permit.payload, permit.signature, f.control.public_key),
    ).toBe(true);
    expect(
      Date.parse(permit.payload.expires_at) -
        Date.parse(permit.payload.issued_at),
    ).toBeLessThanOrEqual(5000);
    await expect(f.jobs.exchange(q, f.peer)).rejects.toMatchObject({
      code: "NODE_COMMAND_REQUEST_REPLAY",
    });
    await expect(
      f.jobs.exchange(
        f.request(job, "permit", { permit_nonce: q.payload.permit_nonce }),
        f.peer,
      ),
    ).rejects.toMatchObject({ code: "NODE_COMMAND_REQUEST_REPLAY" });
    const forged = {
      ...q,
      payload: { ...q.payload, request_id: randomUUID() },
    };
    await expect(f.jobs.exchange(forged, f.peer)).rejects.toMatchObject({
      status: 401,
    });
    for (const changes of [
      { command_hash: "0".repeat(64) },
      { project_id: randomUUID() },
      { node_id: randomUUID() },
      { credential_version: 2 },
      { control_id: "0".repeat(64) },
      { issued_at: new Date(f.now() + 1000).toISOString() },
    ])
      await expect(
        f.jobs.exchange(f.request(job, "permit", changes), f.peer),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      f.jobs.exchange(f.request(job), {
        ...f.peer,
        certificate_sha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      f.jobs.exchange(f.request(job), {
        ...f.peer,
        certificate_expires_at: f.now() - 1,
      }),
    ).rejects.toMatchObject({ status: 401 });
  }));
it("rechecks revocation after qualifier I/O without holding identity or runtime transactions", () =>
  fixture(async (f) => {
    const job = await f.prepare();
    f.qualification.hook = async () => {
      await h.tx(h.identity, f.org, (c) =>
        c.query(
          "delete from role_permissions where organization_id=$1 and permission='server:provision'",
          [f.org],
        ),
      );
    };
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "GRANT_DENIED" });
    expect(
      (
        await h.tx(h.runtime, f.org, (c) =>
          c.query("select 1 from minecraft_deployment_job_requests"),
        )
      ).rowCount,
    ).toBe(0);
  }));
it("rejects changed independent approval and revoked initiating sessions", () =>
  fixture(async (f) => {
    const job = await f.prepare();
    f.qualification.approval = "0".repeat(64);
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_QUALIFICATION_STALE" });
    f.qualification.approval = "b".repeat(64);
    await h.tx(h.identity, f.org, (c) =>
      c.query("update sessions set revoked_at=now() where token_hash=$1", [
        createHash("sha256").update(f.adult).digest("hex"),
      ]),
    );
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "GRANT_DENIED" });
  }));
it.each(["rotate", "revoke"] as const)(
  "denies fetch/permits/receipts after node %s",
  (kind) =>
    fixture(async (f) => {
      const job = await f.prepare(),
        cmd = signedNodeCommand.parse(
          await f.jobs.exchange(f.request(job), f.peer),
        ),
        node = await f.nodes.get(f.adult, f.org, f.node);
      await f.nodes.change(
        f.adult,
        f.org,
        f.node,
        kind,
        {
          expected_version: node.version,
          ...(kind === "rotate"
            ? {
                public_key: generateNodeKey().public_key,
                certificate_sha256: nodeDigest(randomUUID()),
              }
            : {}),
        },
        randomUUID(),
      );
      await expect(
        f.jobs.exchange(f.request(job, "permit"), f.peer),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        f.jobs.recordReceipt(f.receipt(cmd), f.peer),
      ).rejects.toMatchObject({ status: 401 });
    }),
);
it("durable shared stop and epoch changes prevent old-job resumption even after explicit unlatch", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      scope = randomUUID();
    await h.tx(h.runtime, f.org, async (c) => {
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      await c.query(
        "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('instance',$1,null,1,true,$2,'Controller test stop')",
        [scope, randomUUID()],
      );
    });
    try {
      await expect(
        f.jobs.exchange(f.request(job, "permit"), f.peer),
      ).rejects.toMatchObject({ code: "STOP_LATCHED" });
    } finally {
      await h.tx(h.runtime, f.org, async (c) => {
        await c.query(
          "select set_config('app.runtime_internal','enabled',true)",
        );
        await c.query(
          "update runtime_stop_latches set latched=false,epoch=epoch+1 where kind='instance' and scope_id=$1",
          [scope],
        );
      });
    }
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_STOP_CHANGED" });
  }));
it.each(["succeeded", "rolled_back", "not_dispatched", "uncertain"] as const)(
  "settles signed %s receipts idempotently and retains allocations/ports",
  (state) =>
    fixture(async (f) => {
      const job = await f.prepare(),
        cmd = signedNodeCommand.parse(
          await f.jobs.exchange(f.request(job), f.peer),
        ),
        receipt = f.receipt(cmd, state),
        view = await f.jobs.recordReceipt(receipt, f.peer);
      expect(view.state).toBe(state);
      expect(await f.jobs.recordReceipt(receipt, f.peer)).toEqual(view);
      await expect(
        f.jobs.exchange(f.request(job, "permit"), f.peer),
      ).rejects.toMatchObject({ status: 409 });
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (
            await c.query(
              "select 1 from minecraft_deployment_job_outbox where kind='receipt'",
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (
            await c.query(
              "select 1 from minecraft_reservation_ports where reservation_id=$1",
              [f.r.reservation_id],
            )
          ).rowCount,
        ).toBe(2);
        expect(
          (
            await c.query(
              "select state from minecraft_reservations where id=$1",
              [f.r.reservation_id],
            )
          ).rows[0].state,
        ).toBe(state === "uncertain" ? "uncertain" : "allocated");
      });
    }),
);
it("expires unknown issued commands without takeover or allocation release, and retains late receipt evidence", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      cmd = signedNodeCommand.parse(
        await f.jobs.exchange(f.request(job), f.peer),
      ),
      receipt = f.receipt(cmd);
    await expect(
      f.jobs.settleExpired(f.adult, f.org, job.operation_id),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_LEASE_ACTIVE" });
    f.advance(31000);
    await f.touch();
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_LEASE_DENIED" });
    const expired = await f.jobs.settleExpired(
      f.adult,
      f.org,
      job.operation_id,
    );
    expect(expired.state).toBe("uncertain");
    expect(
      await f.jobs.settleExpired(f.adult, f.org, job.operation_id),
    ).toEqual(expired);
    const late = await f.jobs.recordReceipt(receipt, f.peer);
    expect(late).toMatchObject({
      state: "uncertain",
      receipt_state: "succeeded",
    });
    await expect(f.prepare()).rejects.toThrow();
    expect((await f.ledger.get(f.adult, f.org, f.r.reservation_id)).state).toBe(
      "uncertain",
    );
  }));
it("rejects forged or cross-command receipts and immutable SQL binding/transition changes", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      cmd = signedNodeCommand.parse(
        await f.jobs.exchange(f.request(job), f.peer),
      ),
      receipt = f.receipt(cmd);
    await expect(
      f.jobs.recordReceipt(
        {
          ...receipt,
          signature: signNodeValue(
            receipt.payload,
            generateNodeKey().private_key,
          ),
        },
        f.peer,
      ),
    ).rejects.toMatchObject({ status: 401 });
    const payload = { ...receipt.payload, world_id: randomUUID() };
    await expect(
      f.jobs.recordReceipt(
        { payload, signature: signNodeValue(payload, f.agent.private_key) },
        f.peer,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await h.runtime.query("select 1 from minecraft_deployment_jobs"))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await h.tx(h.runtime, f.foreignOrg, (c) =>
          c.query("select 1 from minecraft_deployment_jobs"),
        )
      ).rowCount,
    ).toBe(0);
    for (const sql of [
      "update minecraft_deployment_jobs set fence=2,version=version+1 where id=$1",
      "update minecraft_deployment_jobs set lease_expires_at=lease_expires_at+interval '1 minute',version=version+1 where id=$1",
      "update minecraft_deployment_jobs set state='succeeded',version=version+1 where id=$1",
    ])
      await expect(
        h.tx(h.runtime, f.org, (c) => c.query(sql, [job.operation_id])),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.tx(h.runtime, f.org, (c) =>
        c.query("delete from minecraft_deployment_jobs where id=$1", [
          job.operation_id,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await f.jobs.recordReceipt(receipt, f.peer);
    await expect(
      h.tx(h.runtime, f.org, (c) =>
        c.query(
          "update minecraft_deployment_jobs set state='uncertain',version=version+1 where id=$1",
          [job.operation_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  }));
it("batch execution guards reject mixed identity/scope grants without starting the callback", () =>
  fixture(async (f) => {
    const n = await h.auth.issueExecutionGrant(f.adult, f.org, "node:deploy", {
        kind: "project",
        id: f.project,
      }),
      s = await h.auth.issueExecutionGrant(f.adult, f.org, "server:provision", {
        kind: "environment",
        id: f.environment,
      }),
      other = await f.member("org_admin"),
      foreign = await h.auth.issueExecutionGrant(other, f.org, "node:deploy", {
        kind: "project",
        id: f.project,
      });
    let calls = 0;
    await expect(
      h.auth.guardExecutions([n, s], async () => ++calls),
    ).resolves.toBe(1);
    for (const grants of [[], [n, foreign], [n, { ...s, signature: "bad" }]])
      await expect(
        h.auth.guardExecutions(grants, async () => ++calls),
      ).rejects.toMatchObject({ code: "GRANT_DENIED" });
    expect(calls).toBe(1);
  }));

it("rolls back issuance when initiating authority changes during qualification I/O", () =>
  fixture(async (f) => {
    f.qualification.hook = async () => {
      await h.tx(h.identity, f.org, (c) =>
        c.query(
          "delete from role_permissions where organization_id=$1 and permission='node:deploy'",
          [f.org],
        ),
      );
    };
    await expect(f.prepare()).rejects.toMatchObject({ code: "GRANT_DENIED" });
    await h.tx(h.runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
      ).toBe(0);
      expect(
        (await c.query("select 1 from minecraft_deployment_job_outbox"))
          .rowCount,
      ).toBe(0);
      expect(
        (
          await c.query(
            "select 1 from audit_events where action='server.deployment_issued'",
          )
        ).rowCount,
      ).toBe(0);
    });
  }));
it("refuses rollback clocks, canceled requests and bounded request-journal exhaustion", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      abort = new AbortController();
    abort.abort();
    await expect(
      f.jobs.exchange(f.request(job), f.peer, abort.signal),
    ).rejects.toMatchObject({ code: "NODE_COMMAND_REQUEST_ABORTED" });
    for (let n = 0; n < 64; n++)
      await f.jobs.exchange(f.request(job, "permit"), f.peer);
    await expect(
      f.jobs.exchange(f.request(job, "permit"), f.peer),
    ).rejects.toMatchObject({ code: "NODE_COMMAND_REQUEST_LIMIT" });
    f.advance(-1);
    await expect(f.jobs.exchange(f.request(job), f.peer)).rejects.toMatchObject(
      { code: "DEPLOYMENT_CLOCK_ROLLBACK" },
    );
  }));

it("refuses stale/future/changed qualification bindings before storing a command", () =>
  fixture(async (f) => {
    for (const change of ["expired", "future", "binding"]) {
      const jobs = new DeploymentJobs({
        ...f.options,
        qualifier: {
          inspect: async (c) => ({
            qualified: true,
            request_hash:
              change === "binding" ? "0".repeat(64) : c.request_hash,
            policy_hash: c.policy_hash,
            template_hash: c.template_hash,
            approval_hash: "b".repeat(64),
            issued_at: new Date(
              f.now() + (change === "future" ? 1 : -10000),
            ).toISOString(),
            expires_at: new Date(
              f.now() + (change === "expired" ? -1 : 5000),
            ).toISOString(),
          }),
        },
      });
      try {
        await expect(
          jobs.prepare(
            f.adult,
            f.org,
            { intent_id: f.intent.operation_id },
            randomUUID(),
          ),
        ).rejects.toMatchObject({ code: "DEPLOYMENT_QUALIFICATION_STALE" });
      } finally {
        await jobs.close();
      }
    }
    expect(
      (
        await h.tx(h.runtime, f.org, (c) =>
          c.query("select 1 from minecraft_deployment_jobs"),
        )
      ).rowCount,
    ).toBe(0);
  }));

it("provisions a real scratch-only Docker fixture through DB leases, outbound mTLS, current permits and signed settlement", async () => {
  const endpoint = process.env.DOCKER_HOST;
  if (!endpoint || !/^unix:\/\/\/[^\r\n]+$/.test(endpoint))
    throw new Error("Pinned local Unix Docker required");
  const root = await mkdtemp(join(tmpdir(), "craftlayer-command-e2e-")),
    pki = join(root, "pki"),
    info = await createNodeFixture(pki),
    read = (name: string) => readFile(join(pki, name), "utf8"),
    f = await setup({
      fingerprint: info.certificate_sha256,
      control: nodePrivateKey(await read("control.key")),
      agent: nodePrivateKey(await read("agent.key")),
    });
  const options = {
      ...f.options,
      clock: Date.now,
      qualifier: {
        inspect: async (c: DeploymentQualificationContext) => {
          const now = Date.now();
          return {
            qualified: true,
            request_hash: c.request_hash,
            policy_hash: c.policy_hash,
            template_hash: c.template_hash,
            approval_hash: "b".repeat(64),
            issued_at: new Date(now).toISOString(),
            expires_at: new Date(now + 5000).toISOString(),
          };
        },
      },
    },
    jobs = new DeploymentJobs(options),
    app = await buildNodeAgentApp({
      control: f.nodes,
      jobs,
      key: await read("server.key"),
      cert: await read("server.crt"),
      ca: await read("ca.crt"),
    });
  let executor: NodeCommandExecutor | undefined,
    broker: ConstrainedDockerBroker | undefined,
    clean = false;
  const resources: {
    kind: "container" | "network";
    id: string;
    plan: BrokerPlan;
  }[] = [];
  const record = async (
    kind: "container" | "network",
    id: string,
    plan: BrokerPlan,
  ) => {
    resources.push({ kind, id, plan });
    await writeFile(
      join(root, "fixture-ownership.json"),
      JSON.stringify(
        resources.map((r) => ({
          kind: r.kind,
          id: r.id,
          manifest: r.plan.manifest,
          owner_nonce: r.plan.owner_nonce,
        })),
      ),
      { mode: 0o600 },
    );
  };
  class FixtureEngine extends BrokerEngine {
    override async createNetwork(
      plan: BrokerPlan,
      guard: () => Promise<void>,
      signal: AbortSignal,
    ) {
      const id = await super.createNetwork(plan, guard, signal);
      await record("network", id, plan);
      return id;
    }
    override async createContainer(
      plan: BrokerPlan,
      guard: () => Promise<void>,
      signal: AbortSignal,
    ) {
      const id = await super.createContainer(plan, guard, signal);
      await record("container", id, plan);
      return id;
    }
  }
  const native = new BrokerEngine(endpoint.slice("unix://".length));
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Private listener missing");
    const connection = {
        url: `https://127.0.0.1:${address.port}/`,
        ca: await read("ca.crt"),
        cert: await read("client.crt"),
        key: await read("client.key"),
        server_certificate_sha256: info.server_certificate_sha256,
        control_public_key: f.control.public_key,
        private_key: f.agent.private_key,
      },
      policy = {
        schema_version: 1,
        organization_id: f.org,
        project_id: f.project,
        node_id: f.node,
        credential_version: 1,
        control_id: nodeDigest(f.control.public_key),
        control_public_key: f.control.public_key,
        node_public_key: f.agent.public_key,
        policy_revision: 1,
        policy_hash: f.config.policy,
        enabled: true,
        allowed_actions: ["provision"],
      },
      transport = new CommandTransport({ connection, policy });
    const job = await jobs.prepare(
      f.adult,
      f.org,
      { intent_id: f.intent.operation_id },
      randomUUID(),
    );
    for (const wrong of [
      { ...connection, cert: "", key: "" },
      {
        ...connection,
        cert: await read("other.crt"),
        key: await read("other.key"),
      },
      { ...connection, server_certificate_sha256: "0".repeat(64) },
    ])
      await expect(
        new CommandTransport({ connection: wrong, policy }).fetch(
          job.operation_id,
          job.command_hash,
        ),
      ).rejects.toThrow();
    const command = await transport.fetch(job.operation_id, job.command_hash),
      v = command.payload,
      image = JSON.parse(
        await readFile(
          new URL("../../infra/images.lock.json", import.meta.url),
          "utf8",
        ),
      ).redis.image as string;
    execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], {
      stdio: "ignore",
      timeout: 5000,
    });
    const manifest = {
      organization_id: f.org,
      project_id: f.project,
      node_id: f.node,
      deployment_id: v.deployment_id,
      server_id: v.server_id,
      world_id: v.world_id,
      reservation_id: v.reservation_id,
      plan_hash: v.plan_hash,
      template_hash: v.template_hash,
      policy_hash: v.policy_hash,
      profile: "disposable_fixture",
      image,
      cpu_milli: 100,
      memory_mb: 64,
      disk_mb: 1,
      identity_proof_hash: null,
      restore_proof_hash: null,
      eula_acceptance_hash: null,
      quota_proof_hash: null,
    };
    broker = new ConstrainedDockerBroker({
      directory: join(root, "ownership"),
      executionPolicy: policy,
      policy: new BrokerPolicy({
        organization_id: f.org,
        project_id: f.project,
        node_id: f.node,
        policy_hash: f.config.policy,
        policy_revision: 1,
        allowed_images: [image],
        allowed_profiles: ["disposable_fixture"],
        max_cpu_milli: 100,
        max_memory_mb: 64,
        max_disk_mb: 1,
      }),
      catalog: { resolve: async () => manifest },
      engine: new FixtureEngine(endpoint.slice("unix://".length)),
    });
    await broker.open();
    executor = new NodeCommandExecutor({
      directory: join(root, "execution"),
      policy,
      signingKey: f.agent.private_key,
      authority: transport,
      broker,
    });
    await executor.open();
    const receipt = await executor.execute(command);
    expect(receipt.payload.state).toBe("succeeded");
    expect(resources).toHaveLength(2);
    const resource = resources.find((r) => r.kind === "container");
    if (!resource) throw new Error("Fixture container missing");
    expect(
      await native.container(
        resource.plan,
        new AbortController().signal,
        resource.id,
      ),
    ).toEqual({
      id: resource.id,
      owned: true,
      specification_matches: true,
      running: false,
    });
    expect(await executor.execute(command)).toEqual(receipt);
    expect(resources).toHaveLength(2);
    const ack = await transport.submitReceipt(receipt);
    expect(ack).toMatchObject({
      state: "succeeded",
      receipt_state: "succeeded",
    });
    expect(await transport.submitReceipt(receipt)).toEqual(ack);
    expect(await jobs.get(f.adult, f.org, job.operation_id)).toEqual(ack);
    const retained = await f.ledger.get(f.adult, f.org, f.r.reservation_id);
    expect(retained.state).toBe("allocated");
    await expect(
      transport.fetch(job.operation_id, job.command_hash),
    ).rejects.toThrow();
    const disabled = await buildNodeAgentApp({
      control: f.nodes,
      key: await read("server.key"),
      cert: await read("server.crt"),
      ca: await read("ca.crt"),
    });
    try {
      await disabled.listen({ host: "127.0.0.1", port: 0 });
      const a = disabled.server.address();
      if (!a || typeof a === "string") throw new Error("Listener missing");
      const readOnlyTransport = new NodeTransport({
        ...connection,
        url: `https://127.0.0.1:${a.port}/`,
      });
      await expect(
        readOnlyTransport.job(
          f.request(job).payload as Parameters<NodeTransport["job"]>[0],
        ),
      ).rejects.toThrow();
    } finally {
      await disabled.close();
    }
    clean = true;
  } finally {
    await executor?.close();
    await broker?.close();
    await app.close();
    await jobs.close();
    await f.jobs.close();
    await f.nodes.close();
    await f.ledger.close();
    // Harness-only exact-ID disposal, separate from product settlement/reconciliation.
    const signal = AbortSignal.timeout(15000);
    for (const r of [...resources].reverse()) {
      if (r.kind === "container") {
        const c = await native.container(r.plan, signal, r.id);
        if (c) {
          expect(c.running).toBe(false);
          await native.removeStopped(r.plan, r.id, async () => {}, signal);
        }
        expect(await native.container(r.plan, signal, r.id)).toBe(null);
      } else {
        if (await native.network(r.plan, signal, r.id))
          await native.removeEmptyNetwork(r.plan, r.id, async () => {}, signal);
        expect(await native.network(r.plan, signal, r.id)).toBe(null);
      }
    }
    if (clean) await rm(root, { recursive: true });
  }
}, 30000);
