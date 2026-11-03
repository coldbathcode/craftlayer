import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { buildExecutionAuthorityApp } from "../../apps/api/src/execution-authority-app.js";
import { buildNodeAgentApp } from "../../apps/api/src/node-agent-app.js";
import { ConstrainedDockerBroker } from "../../apps/minecraft-node/src/broker.js";
import { BrokerEngine } from "../../apps/minecraft-node/src/broker-engine.js";
import {
  type BrokerPlan,
  BrokerPolicy,
} from "../../apps/minecraft-node/src/broker-policy.js";
import { NodeTransport } from "../../apps/minecraft-node/src/client.js";
import { NodeCommandRunner } from "../../apps/minecraft-node/src/command-runner.js";
import { CommandTransport } from "../../apps/minecraft-node/src/command-transport.js";
import { NodeCommandExecutor } from "../../apps/minecraft-node/src/executor.js";
import { AuthError } from "../../packages/auth/src/index.js";
import {
  signedNodeCommand,
  signedNodeCommandPermit,
  signedNodePollResponse,
} from "../../packages/contracts/src/index.js";
import {
  DeploymentAdmissions,
  DeploymentDispatcher,
  DeploymentJobs,
  type DeploymentQualificationContext,
  MinecraftControl,
} from "../../packages/minecraft-control/src/index.js";
import { RemoteDeploymentAuthorizer } from "../../packages/minecraft-control/src/remote-authorizer.js";
import {
  certificateHash,
  generateNodeKey,
  nodeDigest,
  nodePrivateKey,
  nodeTimeWindow,
  signNodeValue,
  verifyNodeValue,
} from "../../packages/node-protocol/src/index.js";
import { ApiError, deploymentClient } from "../../packages/sdk/src/index.js";
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
    admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: Date.now,
    }),
    authorityKey = generateNodeKey(),
    authorityApp = await buildExecutionAuthorityApp({
      auth: h.auth,
      authorityPrivateKey: authorityKey.private_key,
      controllerPublicKey: f.control.public_key,
      controllerCertificateSha256: certificateHash(await read("other.crt")),
      key: await read("server.key"),
      cert: await read("server.crt"),
      ca: await read("ca.crt"),
    });
  await authorityApp.listen({ host: "127.0.0.1", port: 0 });
  const authorityAddress = authorityApp.server.address();
  if (!authorityAddress || typeof authorityAddress === "string")
    throw new Error("Authority listener missing");
  const remoteOptions = {
      url: `https://127.0.0.1:${authorityAddress.port}/`,
      ca: await read("ca.crt"),
      cert: await read("other.crt"),
      key: await read("other.key"),
      serverCertificateSha256: info.server_certificate_sha256,
      authorityPublicKey: authorityKey.public_key,
      controlPrivateKey: f.control.private_key,
    },
    remote = new RemoteDeploymentAuthorizer(remoteOptions),
    jobs = new DeploymentJobs({
      databaseUrl: url,
      authorizer: remote,
      controlPrivateKey: f.control.private_key,
      policy: options.policy,
      qualifier: options.qualifier,
      clock: Date.now,
    }),
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
    const admitted = await admissions.admit(
      f.adult,
      f.org,
      { intent_id: f.intent.operation_id },
      randomUUID(),
    );
    const dispatchScope = {
      organization_id: f.org,
      project_id: f.project,
      node_id: f.node,
      credential_version: 1,
    };
    await new DeploymentDispatcher(jobs, dispatchScope).tick();
    const linked = await admissions.get(f.adult, f.org, admitted.operation_id);
    if (!linked.job_id) throw new Error("Background issuance missing");
    const job = await admissions.job(f.adult, f.org, linked.job_id);
    const discovered = (await transport.poll()).jobs[0];
    expect(discovered).toEqual({
      operation_id: job.operation_id,
      command_hash: job.command_hash,
      expires_at: job.lease_expires_at,
    });
    if (!discovered) throw new Error("Node discovery missing");
    for (const wrong of [
      { ...connection, cert: "", key: "" },
      {
        ...connection,
        cert: await read("other.crt"),
        key: await read("other.key"),
      },
      { ...connection, server_certificate_sha256: "0".repeat(64) },
    ]) {
      await expect(
        new CommandTransport({ connection: wrong, policy }).poll(),
      ).rejects.toThrow();
      await expect(
        new CommandTransport({ connection: wrong, policy }).fetch(
          job.operation_id,
          job.command_hash,
        ),
      ).rejects.toThrow();
    }
    await expect(
      jobs.prepare(
        f.adult,
        f.org,
        { intent_id: f.intent.operation_id },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_HUMAN_AUTH_NOT_INSTALLED" });
    const stored = (
        await h.tx(h.runtime, f.org, (c) =>
          c.query(
            "select node_grant,server_grant from minecraft_deployment_jobs where id=$1",
            [job.operation_id],
          ),
        )
      ).rows[0],
      grants = [stored.node_grant, stored.server_grant];
    for (const wrong of [
      { ...remoteOptions, cert: "", key: "" },
      { ...remoteOptions, url: "https://127.0.0.1:1/" },
      {
        ...remoteOptions,
        cert: await read("client.crt"),
        key: await read("client.key"),
      },
      { ...remoteOptions, serverCertificateSha256: "0".repeat(64) },
      { ...remoteOptions, authorityPublicKey: generateNodeKey().public_key },
      { ...remoteOptions, controlPrivateKey: generateNodeKey().private_key },
    ])
      await expect(
        new RemoteDeploymentAuthorizer(wrong).guardExecutions(
          grants,
          async () => true,
        ),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_AUTHORITY_UNAVAILABLE" });
    const rawAuthority = async (
      payload: Record<string, unknown>,
      signature = signNodeValue(payload, f.control.private_key),
      cookie?: string,
    ) => {
      const body = JSON.stringify({ payload, grants, signature });
      return new Promise<{ status: number; body: unknown }>(
        (resolve, reject) => {
          const req = httpsRequest(
            new URL("/internal/v1/execution-authority", remoteOptions.url),
            {
              method: "POST",
              agent: false,
              ca: remoteOptions.ca,
              cert: remoteOptions.cert,
              key: remoteOptions.key,
              minVersion: "TLSv1.3",
              maxVersion: "TLSv1.3",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
                ...(cookie !== undefined ? { cookie } : {}),
              },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (b) => chunks.push(b));
              res.once("end", () =>
                resolve({
                  status: res.statusCode ?? 500,
                  body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                }),
              );
              res.once("error", reject);
            },
          );
          req.once("error", reject);
          req.end(body);
        },
      );
    };
    const proofRequest = () => {
      const now = Date.now();
      return {
        schema_version: 1,
        purpose: "identity.execution.check.v1",
        control_id: nodeDigest(f.control.public_key),
        organization_id: f.org,
        request_nonce: randomUUID(),
        grants_hash: nodeDigest(grants),
        issued_at: new Date(now).toISOString(),
        expires_at: new Date(now + 5000).toISOString(),
      };
    };
    const once = proofRequest();
    expect((await rawAuthority(once)).status).toBe(200);
    expect((await rawAuthority(once)).status).toBe(429);
    const oversizedWindow = proofRequest();
    oversizedWindow.expires_at = new Date(
      Date.parse(oversizedWindow.issued_at) + 5001,
    ).toISOString();
    expect((await rawAuthority(oversizedWindow)).status).toBe(403);
    expect(
      (await rawAuthority({ ...proofRequest(), grants_hash: "0".repeat(64) }))
        .status,
    ).toBe(403);
    expect((await rawAuthority(proofRequest(), "0".repeat(86))).status).toBe(
      403,
    );
    expect(
      (await rawAuthority(proofRequest(), undefined, "session=browser")).status,
    ).toBe(401);
    expect(
      (
        await rawAuthority({
          ...proofRequest(),
          issued_at: new Date(Date.now() - 10000).toISOString(),
          expires_at: new Date(Date.now() - 5000).toISOString(),
        })
      ).status,
    ).toBe(401);
    const command = await transport.fetch(
        discovered.operation_id,
        discovered.command_hash,
      ),
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
    let receiptPosts = 0;
    const delivery = {
      poll: (signal?: AbortSignal) => transport.poll(signal),
      fetch: (id: string, hash: string, signal?: AbortSignal) =>
        transport.fetch(id, hash, signal),
      submitReceipt: async (
        receipt: Parameters<CommandTransport["submitReceipt"]>[0],
        signal?: AbortSignal,
      ) => {
        const ack = await transport.submitReceipt(receipt, signal);
        if (++receiptPosts === 1)
          throw new Error("simulated lost settlement acknowledgement");
        return ack;
      },
    };
    await expect(
      new NodeCommandRunner(delivery, executor).tick(),
    ).rejects.toThrow("lost settlement");
    const receipt = (await executor.receiptDelivery()).receipts[0];
    if (!receipt) throw new Error("Durable pending receipt missing");
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
    await executor.close();
    executor = new NodeCommandExecutor({
      directory: join(root, "execution"),
      policy,
      signingKey: f.agent.private_key,
      authority: transport,
      broker,
    });
    await executor.open();
    expect(await new NodeCommandRunner(delivery, executor).tick()).toBe("idle");
    expect(receiptPosts).toBe(2);
    expect((await executor.receiptDelivery()).receipts).toEqual([]);
    expect(await new NodeCommandRunner(delivery, executor).tick()).toBe("idle");
    expect(receiptPosts).toBe(2);
    expect(resources).toHaveLength(2);
    const ack = await transport.submitReceipt(receipt);
    expect(ack).toMatchObject({
      state: "succeeded",
      receipt_state: "succeeded",
    });
    expect(await transport.submitReceipt(receipt)).toEqual(ack);
    expect((await transport.poll()).jobs).toEqual([]);
    expect(
      await admissions.get(f.adult, f.org, admitted.operation_id),
    ).toMatchObject({ job_id: job.operation_id, effects: "metadata_only" });
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
        new CommandTransport({
          connection: { ...connection, url: `https://127.0.0.1:${a.port}/` },
          policy,
        }).poll(),
      ).rejects.toThrow();
      await expect(
        readOnlyTransport.job(
          f.request(job).payload as Parameters<NodeTransport["job"]>[0],
        ),
      ).rejects.toThrow();
    } finally {
      await disabled.close();
    }
    await h.tx(h.identity, f.org, (c) =>
      c.query(
        "delete from role_permissions where organization_id=$1 and permission='node:deploy'",
        [f.org],
      ),
    );
    await expect(
      remote.guardExecutions(grants, async () => true),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_AUTHORITY_UNAVAILABLE" });
    clean = true;
  } finally {
    await executor?.close();
    await broker?.close();
    await app.close();
    await jobs.close();
    await admissions.close();
    await authorityApp.close();
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

it("does not commit controller mutations under an expired remote authority proof", () =>
  fixture(async (f) => {
    const jobs = new DeploymentJobs({
      ...f.options,
      authorizer: {
        guardExecutions: (grants, fn) =>
          h.auth.guardExecutions(grants, (p) =>
            fn({ ...p, validatedUntil: f.now() - 1 }),
          ),
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
      ).rejects.toMatchObject({ code: "DEPLOYMENT_AUTHORITY_EXPIRED" });
      expect(
        (
          await h.tx(h.runtime, f.org, (c) =>
            c.query("select 1 from minecraft_deployment_jobs"),
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await jobs.close();
    }
  }));

it("persists one sealed authority admission/audit/reference-only outbox for concurrent replay without a control key", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      key = randomUUID();
    try {
      const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            admissions.admit(
              f.adult,
              f.org,
              { intent_id: f.intent.operation_id },
              key,
            ),
          ),
        ),
        a = results[0];
      if (!a) throw new Error("Admission missing");
      expect(new Set(results.map((r) => r.operation_id)).size).toBe(1);
      expect(a).toMatchObject({
        authorization_state: "active",
        effects: "metadata_only",
        job_id: null,
      });
      expect(JSON.stringify(a)).not.toContain("signature");
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_authorizations"))
            .rowCount,
        ).toBe(1);
        const outbox = (
          await c.query(
            "select * from minecraft_deployment_authorization_outbox",
          )
        ).rows;
        expect(outbox).toHaveLength(1);
        expect(Object.keys(outbox[0]).sort()).toEqual([
          "authorization_id",
          "created_at",
          "id",
          "organization_id",
          "schema_version",
        ]);
        expect(
          (
            await c.query(
              "select 1 from audit_events where action='server.deployment_authorized'",
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(0);
      });
      const reopened = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      });
      try {
        expect(await reopened.get(f.adult, f.org, a.operation_id)).toEqual(a);
      } finally {
        await reopened.close();
      }
      await expect(
        admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      const jobs = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.jobs.issueAdmission(f.org, a.operation_id),
        ),
      );
      expect(new Set(jobs.map((r) => r.operation_id)).size).toBe(1);
      const job = jobs[0];
      if (!job) throw new Error("Job missing");
      expect(
        await admissions.get(f.adult, f.org, a.operation_id),
      ).toMatchObject({ job_id: job.operation_id });
    } finally {
      await admissions.close();
    }
  }));
it("enforces current adult/session/tenant authority for sealed admission and its metadata view", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      for (const token of ["", f.child, f.viewer])
        await expect(
          admissions.admit(
            token,
            f.org,
            { intent_id: f.intent.operation_id },
            randomUUID(),
          ),
        ).rejects.toMatchObject({ status: token ? 403 : 401 });
      await expect(
        admissions.admit(
          f.adult,
          f.foreignOrg,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 404 });
      const other = await f.member("org_admin");
      await expect(
        admissions.admit(
          other,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_SESSION_DENIED" });
      const key = randomUUID(),
        a = await admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          key,
        );
      for (const token of [f.child, f.viewer])
        await expect(
          admissions.get(token, f.org, a.operation_id),
        ).rejects.toMatchObject({ status: 403 });
      await h.tx(h.identity, f.org, (c) =>
        c.query("update sessions set revoked_at=now() where token_hash=$1", [
          createHash("sha256").update(f.adult).digest("hex"),
        ]),
      );
      await expect(
        admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          key,
        ),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        f.jobs.issueAdmission(f.org, a.operation_id),
      ).rejects.toMatchObject({ code: "GRANT_DENIED" });
    } finally {
      await admissions.close();
    }
  }));
it("never extends expired admission or issues with expired/missing/default qualification", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      const a = await admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
        disabled = new DeploymentJobs({
          databaseUrl: url,
          authorizer: h.auth,
          controlPrivateKey: f.control.private_key,
          policy: f.options.policy,
          clock: f.now,
        });
      try {
        await expect(
          disabled.issueAdmission(f.org, a.operation_id),
        ).rejects.toMatchObject({ code: "DEPLOYMENT_UNQUALIFIED" });
      } finally {
        await disabled.close();
      }
      f.advance(120001);
      await f.touch();
      expect(
        await admissions.get(f.adult, f.org, a.operation_id),
      ).toMatchObject({ authorization_state: "expired", job_id: null });
      await expect(
        f.jobs.issueAdmission(f.org, a.operation_id),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_AUTHORIZATION_STALE" });
      await expect(
        admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
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
      expect(
        (await f.ledger.get(f.adult, f.org, f.r.reservation_id)).state,
      ).toBe("allocated");
    } finally {
      await admissions.close();
    }
  }));
it("retains stop epoch and SQL sealed-authority/immutability bindings across admission and issuance", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      const a = await admissions.admit(
        f.adult,
        f.org,
        { intent_id: f.intent.operation_id },
        randomUUID(),
      );
      expect(
        (
          await h.runtime.query(
            "select 1 from minecraft_deployment_authorizations",
          )
        ).rowCount,
      ).toBe(0);
      for (const table of [
        "minecraft_deployment_authorizations",
        "minecraft_deployment_authorization_outbox",
      ]) {
        await expect(
          h.tx(h.runtime, f.org, (c) => c.query(`delete from ${table}`)),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          h.tx(h.runtime, f.org, (c) =>
            c.query(`update ${table} set created_at=now()`),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(
        h.tx(h.runtime, f.foreignOrg, (c) =>
          c.query(
            "insert into minecraft_deployment_authorization_outbox(id,organization_id,authorization_id,created_at) values($1,$2,$3,now())",
            [randomUUID(), f.foreignOrg, a.operation_id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23503" });
      const scope = randomUUID();
      await h.tx(h.runtime, f.org, async (c) => {
        await c.query(
          "select set_config('app.runtime_internal','enabled',true)",
        );
        await c.query(
          "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('instance',$1,null,1,true,$2,'Admission stop')",
          [scope, randomUUID()],
        );
      });
      try {
        await expect(
          f.jobs.issueAdmission(f.org, a.operation_id),
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
        f.jobs.issueAdmission(f.org, a.operation_id),
      ).rejects.toMatchObject({ code: "DEPLOYMENT_AUTHORIZATION_STALE" });
    } finally {
      await admissions.close();
    }
  }));

it("SQL rejects altered sealed actor/scope and job-authority links before uniqueness can mask binding checks", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      const a = await admissions.admit(
        f.adult,
        f.org,
        { intent_id: f.intent.operation_id },
        randomUUID(),
      );
      for (const expression of [
        "jsonb_set(node_grant,'{userId}',to_jsonb(gen_random_uuid()::text))",
        "jsonb_set(node_grant,'{permission}','\"server:provision\"'::jsonb)",
        "jsonb_set(node_grant,'{resource,id}',to_jsonb(gen_random_uuid()::text))",
      ]) {
        await expect(
          h.tx(h.runtime, f.org, (c) =>
            c.query(
              `insert into minecraft_deployment_authorizations(id,organization_id,project_id,environment_id,node_id,reservation_id,intent_id,actor_id,session_id,request_key,request_hash,stop_hash,node_grant,server_grant,created_at,expires_at) select gen_random_uuid(),organization_id,project_id,environment_id,node_id,reservation_id,intent_id,actor_id,session_id,gen_random_uuid(),request_hash,stop_hash,${expression},server_grant,created_at,expires_at from minecraft_deployment_authorizations where id=$1`,
              [a.operation_id],
            ),
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }
      const job = await f.jobs.issueAdmission(f.org, a.operation_id);
      await expect(
        h.tx(h.runtime, f.org, (c) =>
          c.query(
            "update minecraft_deployment_jobs set authorization_id=null,version=version+1 where id=$1",
            [job.operation_id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const commands = (
        await h.tx(h.runtime, f.org, (c) =>
          c.query(
            "select node_grant,server_grant,authorization_id from minecraft_deployment_jobs where id=$1",
            [job.operation_id],
          ),
        )
      ).rows[0];
      expect(commands.authorization_id).toBe(a.operation_id);
      expect(
        (
          await h.tx(h.runtime, f.org, (c) =>
            c.query("select 1 from minecraft_deployment_authorizations"),
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      await admissions.close();
    }
  }));

it("guards HTTP authority admission with current scope, Origin/CSRF, strict metadata and UUID replay", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      app = await buildApp({
        auth: h.auth,
        deployments: admissions,
        readiness: async () => true,
      }),
      path = "/api/v1/servers/provision/admissions",
      key = randomUUID(),
      headers = {
        cookie: `craftlayer_session=${f.adult}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": h.auth.csrfToken(f.adult),
        "x-craftlayer-organization": f.org,
        "idempotency-key": key,
      },
      payload = { intent_id: f.intent.operation_id };
    try {
      for (const [changed, status] of [
        [{ cookie: "" }, 401],
        [
          {
            cookie: `craftlayer_session=${f.child}`,
            "x-csrf-token": h.auth.csrfToken(f.child),
          },
          403,
        ],
        [
          {
            cookie: `craftlayer_session=${f.viewer}`,
            "x-csrf-token": h.auth.csrfToken(f.viewer),
          },
          403,
        ],
        [{ origin: "https://foreign.invalid" }, 403],
        [{ "x-csrf-token": "" }, 403],
        [{ "x-craftlayer-organization": f.foreignOrg }, 404],
        [{ "x-craftlayer-organization": "" }, 400],
        [{ "idempotency-key": "" }, 400],
      ] as const) {
        const r = await app.inject({
          method: "POST",
          url: path,
          headers: { ...headers, ...changed },
          payload,
        });
        expect(r.statusCode).toBe(status);
      }
      for (const extra of [
        { approval_hash: "b".repeat(64) },
        { qualified: true },
        { command: "start" },
        { organization_id: f.org },
        { node_grant: {} },
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers,
              payload: { ...payload, ...extra },
            })
          ).statusCode,
        ).toBe(400);
      }
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_authorizations"))
            .rowCount,
        ).toBe(0);
      });
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          app.inject({ method: "POST", url: path, headers, payload }),
        ),
      );
      for (const r of responses) {
        expect(r.statusCode).toBe(202);
        expect(r.headers["cache-control"]).toBe("no-store");
        expect(r.headers["x-request-id"]).toBeTruthy();
      }
      const admission = responses[0]?.json();
      expect(new Set(responses.map((r) => r.json().operation_id)).size).toBe(1);
      expect(admission).toMatchObject({
        effects: "metadata_only",
        authorization_state: "active",
        job_id: null,
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers: { ...headers, "idempotency-key": randomUUID() },
            payload,
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${path}/${admission.operation_id}`,
            headers,
          })
        ).json(),
      ).toEqual(admission);
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_authorizations"))
            .rowCount,
        ).toBe(1);
        expect(
          (
            await c.query(
              "select 1 from minecraft_deployment_authorization_outbox",
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(0);
      });
      const schema = (
        await app.inject({ method: "GET", url: "/api/v1/openapi.json" })
      ).json();
      expect(schema.openapi).toBe("3.1.0");
      expect(schema.paths[path].post.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            in: "header",
            name: "idempotency-key",
            required: true,
          }),
          expect.objectContaining({
            in: "header",
            name: "x-craftlayer-organization",
            required: true,
          }),
        ]),
      );
      expect(
        schema.paths[path].post.requestBody.content["application/json"].schema
          .additionalProperties,
      ).toBe(false);
      expect(
        schema.paths["/api/v1/servers/provision/jobs/{id}"].get,
      ).toBeDefined();
      expect(schema.paths["/node/v1/commands/exchange"]).toBeUndefined();
    } finally {
      await app.close();
      await admissions.close();
    }
  }));

it("reads issued and settled deployment metadata through actual HTTP/SDK without exposing sealed authority or weakening operation permissions", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      minecraft = new MinecraftControl({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      app = await buildApp({
        auth: h.auth,
        deployments: admissions,
        minecraft,
        nodes: f.nodes,
        readiness: async () => true,
      }),
      nativeFetch = globalThis.fetch;
    try {
      const base = await app.listen({ host: "127.0.0.1", port: 0 });
      // Supply browser cookies and Origin explicitly in this Node-only SDK journey.
      vi.stubGlobal(
        "fetch",
        (input: string | URL | Request, init?: RequestInit) =>
          nativeFetch(new URL(String(input), base), {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              cookie: `craftlayer_session=${f.adult}`,
              origin: "http://127.0.0.1:3000",
            },
          }),
      );
      const client = deploymentClient(f.org, h.auth.csrfToken(f.adult)),
        admission = await client.admit(f.intent.operation_id, randomUUID());
      expect(await client.operation(admission.operation_id)).toEqual(admission);
      const job = await f.jobs.issueAdmission(f.org, admission.operation_id);
      expect(await client.job(job.operation_id)).toEqual(job);
      expect(await client.operation(job.operation_id)).toEqual(job);
      expect(await client.admission(admission.operation_id)).toMatchObject({
        job_id: job.operation_id,
      });
      const command = signedNodeCommand.parse(
        await f.jobs.exchange(f.request(job), f.peer),
      );
      await f.jobs.recordReceipt(f.receipt(command, "not_dispatched"), f.peer);
      expect(await client.job(job.operation_id)).toMatchObject({
        state: "not_dispatched",
        receipt_state: "not_dispatched",
      });
      for (const view of [
        await client.job(job.operation_id),
        await client.admission(admission.operation_id),
      ]) {
        for (const forbidden of [
          "node_grant",
          "server_grant",
          "signature",
          "session_id",
          "actor_id",
          'receipt"',
          'command"',
        ])
          expect(JSON.stringify(view)).not.toContain(forbidden);
      }
      const paths = [
        `/api/v1/servers/provision/admissions/${admission.operation_id}`,
        `/api/v1/servers/provision/jobs/${job.operation_id}`,
        `/api/v1/operations/${admission.operation_id}`,
        `/api/v1/operations/${job.operation_id}`,
      ];
      for (const path of paths) {
        for (const [token, organization, status] of [
          ["", f.org, 401],
          [f.child, f.org, 403],
          [f.viewer, f.org, 403],
          [f.adult, f.foreignOrg, 404],
        ] as const) {
          expect(
            (
              await app.inject({
                method: "GET",
                url: path,
                headers: {
                  cookie: `craftlayer_session=${token}`,
                  "x-craftlayer-organization": organization,
                },
              })
            ).statusCode,
          ).toBe(status);
        }
      }
      await h.tx(h.identity, f.org, (c) =>
        c.query(
          "delete from role_permissions where organization_id=$1 and permission='server:provision'",
          [f.org],
        ),
      );
      await expect(client.job(job.operation_id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        client.operation(admission.operation_id),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(client.operation(job.operation_id)).rejects.toMatchObject({
        status: 403,
      });
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (
            await c.query(
              "select state from minecraft_reservations where id=$1",
              [f.r.reservation_id],
            )
          ).rows[0]?.state,
        ).toBe("allocated");
      });
    } finally {
      vi.unstubAllGlobals();
      await app.close();
      await minecraft.close();
      await admissions.close();
    }
  }));

it("keeps expired HTTP admissions historical, remote management blocked and browser command routes absent", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      app = await buildApp({
        auth: h.auth,
        deployments: admissions,
        readiness: async () => true,
      }),
      remote = await buildApp({
        auth: h.auth,
        deployments: admissions,
        publicUrl: "https://management.invalid",
        readiness: async () => true,
      }),
      path = "/api/v1/servers/provision/admissions",
      headers = {
        cookie: `craftlayer_session=${f.adult}`,
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": h.auth.csrfToken(f.adult),
        "x-craftlayer-organization": f.org,
        "idempotency-key": randomUUID(),
      },
      payload = { intent_id: f.intent.operation_id };
    try {
      const created = await app.inject({
        method: "POST",
        url: path,
        headers,
        payload,
      });
      expect(created.statusCode).toBe(202);
      const a = created.json();
      const disabled = new DeploymentJobs({
        databaseUrl: url,
        authorizer: h.auth,
        controlPrivateKey: f.control.private_key,
        policy: f.options.policy,
        clock: f.now,
      });
      try {
        await expect(
          disabled.issueAdmission(f.org, a.operation_id),
        ).rejects.toMatchObject({ code: "DEPLOYMENT_UNQUALIFIED" });
      } finally {
        await disabled.close();
      }
      for (const [method, target] of [
        ["GET", `${path}/${a.operation_id}`],
        ["POST", path],
      ] as const) {
        const denied = await remote.inject({
          method,
          url: target,
          headers: { ...headers, origin: "https://management.invalid" },
          ...(method === "POST" ? { payload } : {}),
        });
        expect(denied.statusCode).toBe(503);
        expect(denied.json().error.code).toBe("MANAGEMENT_REMOTE_UNQUALIFIED");
      }
      for (const target of [
        "/node/v1/commands/poll",
        "/node/v1/commands/exchange",
        "/node/v1/commands/receipt",
        "/api/v1/servers/provision/jobs",
        "/api/v1/servers/provision",
      ]) {
        expect(
          (await app.inject({ method: "POST", url: target, headers, payload }))
            .statusCode,
        ).toBe(404);
      }
      f.advance(120001);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `${path}/${a.operation_id}`,
            headers,
          })
        ).json(),
      ).toMatchObject({
        authorization_state: "expired",
        job_id: null,
        expires_at: a.expires_at,
      });
      expect(
        (await app.inject({ method: "POST", url: path, headers, payload }))
          .statusCode,
      ).toBe(409);
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(0);
      });
      expect(
        (await f.ledger.get(f.adult, f.org, f.r.reservation_id)).state,
      ).toBe("allocated");
    } finally {
      await remote.close();
      await app.close();
      await admissions.close();
    }
  }));

const dispatchScope = (f: Awaited<ReturnType<typeof setup>>) => ({
  organization_id: f.org,
  project_id: f.project,
  node_id: f.node,
  credential_version: 1,
});
it("dispatches immutable outbox references concurrently and recovers a lost worker acknowledgement without issuing a second command", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      const a = await admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
        scope = dispatchScope(f);
      const crash = new DeploymentDispatcher(
        {
          settleExpiredForNode: (s) => f.jobs.settleExpiredForNode(s),
          dispatchPending: async (s, page, signal) => {
            await f.jobs.dispatchPending(s, page, signal);
            throw new Error("simulated worker acknowledgement loss");
          },
        },
        scope,
      );
      await expect(crash.tick()).rejects.toThrow("acknowledgement loss");
      await Promise.all(
        Array.from({ length: 4 }, () =>
          new DeploymentDispatcher(f.jobs, scope).tick(),
        ),
      );
      const linked = await admissions.get(f.adult, f.org, a.operation_id);
      expect(linked.job_id).toBeTruthy();
      const first = await admissions.job(f.adult, f.org, linked.job_id ?? "");
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        new DeploymentDispatcher(f.jobs, scope).tick(cancelled.signal),
      ).rejects.toThrow();
      const stop = new AbortController();
      await new DeploymentDispatcher(f.jobs, scope).run(stop.signal, () =>
        stop.abort(),
      );
      expect(await new DeploymentDispatcher(f.jobs, scope).tick()).toEqual({
        issued: 0,
        blocked: 0,
        expired: 0,
      });
      expect(await admissions.job(f.adult, f.org, linked.job_id ?? "")).toEqual(
        first,
      );
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(1);
        expect(
          (
            await c.query(
              "select 1 from audit_events where action='server.deployment_issued'",
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (
            await c.query(
              "select 1 from minecraft_deployment_authorization_outbox",
            )
          ).rowCount,
        ).toBe(1);
      });
    } finally {
      await admissions.close();
    }
  }));
it("keeps unavailable qualification and revoked authority closed in background work and rejects forged placement/page bounds", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
        databaseUrl: url,
        auth: h.auth,
        clock: f.now,
      }),
      disabled = new DeploymentJobs({
        databaseUrl: url,
        authorizer: h.auth,
        controlPrivateKey: f.control.private_key,
        policy: f.options.policy,
        clock: f.now,
      });
    try {
      await admissions.admit(
        f.adult,
        f.org,
        { intent_id: f.intent.operation_id },
        randomUUID(),
      );
      const scope = dispatchScope(f);
      expect(await disabled.dispatchPending(scope)).toMatchObject({
        issued: 0,
        blocked: 1,
      });
      for (const changed of [
        { project_id: randomUUID() },
        { node_id: randomUUID() },
        { organization_id: f.foreignOrg },
        { credential_version: 2 },
      ])
        await expect(
          f.jobs.dispatchPending({ ...scope, ...changed }),
        ).rejects.toMatchObject({ status: 403 });
      await expect(
        f.jobs.dispatchPending({ ...scope, command: "start" }),
      ).rejects.toThrow();
      await expect(
        f.jobs.dispatchPending(scope, { limit: 9 }),
      ).rejects.toThrow();
      await h.tx(h.identity, f.org, (c) =>
        c.query("update sessions set revoked_at=now() where token_hash=$1", [
          createHash("sha256").update(f.adult).digest("hex"),
        ]),
      );
      expect(await f.jobs.dispatchPending(scope)).toMatchObject({
        issued: 0,
        blocked: 1,
      });
      f.advance(120001);
      expect(await f.jobs.dispatchPending(scope)).toMatchObject({
        issued: 0,
        blocked: 0,
      });
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(0);
        expect(
          (await c.query("select state from minecraft_reservations")).rows[0]
            ?.state,
        ).toBe("allocated");
      });
    } finally {
      await disabled.close();
      await admissions.close();
    }
  }));
it("advances bounded admission scans past a blocked reference and wraps without losing later work", () =>
  fixture(async (f) => {
    const admissions = new DeploymentAdmissions({
      databaseUrl: url,
      auth: h.auth,
      clock: f.now,
    });
    try {
      const second = await f.ledger.reserve(
          f.adult,
          f.org,
          f.input(25600),
          randomUUID(),
        ),
        dispatch = await f.ledger.change(
          f.adult,
          f.org,
          second.reservation_id,
          "dispatch",
          1,
          randomUUID(),
        ),
        intent = await f.ledger.queueDeployment(
          f.adult,
          f.org,
          {
            reservation_id: second.reservation_id,
            dispatch_operation_id: dispatch.operation_id,
            reservation_version: 2,
          },
          randomUUID(),
        ),
        a = await admissions.admit(
          f.adult,
          f.org,
          { intent_id: f.intent.operation_id },
          randomUUID(),
        ),
        b = await admissions.admit(
          f.adult,
          f.org,
          { intent_id: intent.operation_id },
          randomUUID(),
        ),
        blockedReservation =
          a.operation_id < b.operation_id
            ? f.r.reservation_id
            : second.reservation_id,
        scope = dispatchScope(f);
      f.qualification.hook = async (c) => {
        if (c.reservation_id === blockedReservation)
          throw new AuthError(
            403,
            "APPROVAL_DENIED",
            "Synthetic approval denied",
          );
      };
      const first = await f.jobs.dispatchPending(scope, { limit: 1 });
      expect(first).toMatchObject({ issued: 0, blocked: 1 });
      const next = await f.jobs.dispatchPending(scope, {
        limit: 1,
        after: first.after,
      });
      expect(next).toMatchObject({ issued: 1, blocked: 0 });
      expect(
        await f.jobs.dispatchPending(scope, { limit: 1, after: next.after }),
      ).toEqual({ issued: 0, blocked: 0, after: null });
      f.qualification.hook = undefined;
      expect(await f.jobs.dispatchPending(scope)).toMatchObject({
        issued: 1,
        blocked: 0,
      });
      expect(
        (await admissions.get(f.adult, f.org, a.operation_id)).job_id,
      ).toBeTruthy();
      expect(
        (await admissions.get(f.adult, f.org, b.operation_id)).job_id,
      ).toBeTruthy();
    } finally {
      await admissions.close();
    }
  }));
it("sweeps expired signed jobs once after actor revocation, retains allocation and never promotes late success out of uncertainty", () =>
  fixture(async (f) => {
    const job = await f.prepare(),
      command = signedNodeCommand.parse(
        await f.jobs.exchange(f.request(job), f.peer),
      ),
      scope = dispatchScope(f),
      wrong = new DeploymentJobs({
        ...f.options,
        controlPrivateKey: generateNodeKey().private_key,
      });
    try {
      expect(await f.jobs.settleExpiredForNode(scope)).toBe(0);
      f.advance(30001);
      await h.tx(h.identity, f.org, (c) =>
        c.query("update sessions set revoked_at=now() where token_hash=$1", [
          createHash("sha256").update(f.adult).digest("hex"),
        ]),
      );
      await expect(wrong.settleExpiredForNode(scope)).rejects.toMatchObject({
        code: "DEPLOYMENT_DISPATCH_CONTROL_DENIED",
      });
      expect(
        (
          await Promise.all([
            f.jobs.settleExpiredForNode(scope),
            f.jobs.settleExpiredForNode(scope),
          ])
        ).sort(),
      ).toEqual([0, 1]);
      expect(
        await f.jobs.recordReceipt(f.receipt(command), f.peer),
      ).toMatchObject({ state: "uncertain", receipt_state: "succeeded" });
      expect(await new DeploymentDispatcher(f.jobs, scope).tick()).toEqual({
        expired: 0,
        issued: 0,
        blocked: 0,
      });
      await h.tx(h.runtime, f.org, async (c) => {
        expect(
          (await c.query("select state from minecraft_reservations")).rows[0]
            ?.state,
        ).toBe("uncertain");
        expect(
          (await c.query("select 1 from minecraft_reservation_ports")).rowCount,
        ).toBe(2);
        expect(
          (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
        ).toBe(1);
        expect(
          (
            await c.query(
              "select 1 from minecraft_deployment_job_outbox where kind='expired'",
            )
          ).rowCount,
        ).toBe(1);
      });
    } finally {
      await wrong.close();
    }
  }));

function pollRequest(
  f: Awaited<ReturnType<typeof setup>>,
  changes: Record<string, unknown> = {},
) {
  const payload = {
    schema_version: 1,
    purpose: "node.command.poll.v1",
    control_id: nodeDigest(f.control.public_key),
    organization_id: f.org,
    project_id: f.project,
    node_id: f.node,
    credential_version: 1,
    request_id: randomUUID(),
    issued_at: new Date(f.now()).toISOString(),
    expires_at: new Date(f.now() + 5000).toISOString(),
    ...changes,
  };
  return { payload, signature: signNodeValue(payload, f.agent.private_key) };
}
it("discovers only an exact signed assigned job reference and retires discovery after settlement without issuing another command", () =>
  fixture(async (f) => {
    expect((await f.jobs.poll(pollRequest(f), f.peer)).payload.jobs).toEqual(
      [],
    );
    const job = await f.prepare(),
      request = pollRequest(f),
      response = signedNodePollResponse.parse(
        await f.jobs.poll(request, f.peer),
      );
    expect(
      verifyNodeValue(
        response.payload,
        response.signature,
        f.control.public_key,
      ),
    ).toBe(true);
    expect(response.payload.request_hash).toBe(nodeDigest(request.payload));
    expect(response.payload.jobs).toEqual([
      {
        operation_id: job.operation_id,
        command_hash: job.command_hash,
        expires_at: job.lease_expires_at,
      },
    ]);
    expect(Object.keys(response.payload.jobs[0] ?? {}).sort()).toEqual([
      "command_hash",
      "expires_at",
      "operation_id",
    ]);
    await expect(f.jobs.poll(request, f.peer)).rejects.toMatchObject({
      code: "NODE_POLL_REPLAY",
    });
    const command = signedNodeCommand.parse(
      await f.jobs.exchange(f.request(job), f.peer),
    );
    await f.jobs.recordReceipt(f.receipt(command, "not_dispatched"), f.peer);
    expect((await f.jobs.poll(pollRequest(f), f.peer)).payload.jobs).toEqual(
      [],
    );
    await h.tx(h.runtime, f.org, async (c) => {
      expect(
        (await c.query("select 1 from minecraft_deployment_jobs")).rowCount,
      ).toBe(1);
      expect(
        (await c.query("select state from minecraft_reservations")).rows[0]
          ?.state,
      ).toBe("allocated");
    });
  }));
it("denies forged, foreign, expired or wrong-certificate discovery and cannot turn a node hint into revoked human authority", () =>
  fixture(async (f) => {
    const job = await f.prepare();
    for (const changes of [
      { control_id: "0".repeat(64) },
      { organization_id: f.foreignOrg },
      { project_id: randomUUID() },
      { node_id: randomUUID() },
      { credential_version: 2 },
      { issued_at: new Date(f.now() + 1).toISOString() },
      { expires_at: new Date(f.now()).toISOString() },
      { expires_at: new Date(f.now() + 5001).toISOString() },
      { purpose: "node.command.fetch.v1" },
      { job_id: job.operation_id },
      { command: "start" },
    ])
      await expect(
        f.jobs.poll(pollRequest(f, changes), f.peer),
      ).rejects.toThrow();
    const valid = pollRequest(f);
    await expect(
      f.jobs.poll({ ...valid, signature: "A".repeat(86) }, f.peer),
    ).rejects.toMatchObject({ code: "NODE_POLL_IDENTITY_DENIED" });
    await expect(
      f.jobs.poll(valid, { ...f.peer, certificate_sha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "NODE_POLL_IDENTITY_DENIED" });
    await expect(
      f.jobs.poll(valid, { ...f.peer, certificate_expires_at: f.now() }),
    ).rejects.toMatchObject({ code: "NODE_POLL_IDENTITY_DENIED" });
    expect((await f.jobs.poll(valid, f.peer)).payload.jobs).toHaveLength(1);
    await h.tx(h.identity, f.org, (c) =>
      c.query("update sessions set revoked_at=now() where token_hash=$1", [
        createHash("sha256").update(f.adult).digest("hex"),
      ]),
    );
    expect(
      (await f.jobs.poll(pollRequest(f), f.peer)).payload.jobs,
    ).toHaveLength(1);
    await expect(f.jobs.exchange(f.request(job), f.peer)).rejects.toMatchObject(
      { code: "GRANT_DENIED" },
    );
    await h.tx(h.runtime, f.org, (c) =>
      c.query(
        "update minecraft_nodes set state='revoked',version=version+1 where id=$1",
        [f.node],
      ),
    );
    await expect(f.jobs.poll(pollRequest(f), f.peer)).rejects.toMatchObject({
      code: "DEPLOYMENT_DISPATCH_SCOPE_DENIED",
    });
  }));
it("bounds read-only discovery nonce retention and respects current stop epochs and command expiry", () =>
  fixture(async (f) => {
    const job = await f.prepare();
    for (let n = 0; n < 16; n++) await f.jobs.poll(pollRequest(f), f.peer);
    await expect(f.jobs.poll(pollRequest(f), f.peer)).rejects.toMatchObject({
      code: "NODE_POLL_CAPACITY",
    });
    f.advance(5001);
    expect(
      (await f.jobs.poll(pollRequest(f), f.peer)).payload.jobs,
    ).toHaveLength(1);
    await h.tx(h.runtime, f.org, async (c) => {
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      await c.query(
        "insert into runtime_stop_latches(kind,scope_id,organization_id,epoch,latched,operation_id,reason) values('environment',$1,$2,1,true,$3,'Poll stop')",
        [f.environment, f.org, randomUUID()],
      );
    });
    await expect(f.jobs.poll(pollRequest(f), f.peer)).rejects.toMatchObject({
      code: "STOP_LATCHED",
    });
    await h.tx(h.runtime, f.org, async (c) => {
      await c.query("select set_config('app.runtime_internal','enabled',true)");
      await c.query(
        "update runtime_stop_latches set latched=false,epoch=epoch+1 where kind='environment' and scope_id=$1",
        [f.environment],
      );
    });
    await expect(f.jobs.poll(pollRequest(f), f.peer)).rejects.toMatchObject({
      code: "DEPLOYMENT_STOP_CHANGED",
    });
    f.advance(25000);
    expect((await f.jobs.poll(pollRequest(f), f.peer)).payload.jobs).toEqual(
      [],
    );
    await h.tx(h.runtime, f.org, async (c) => {
      expect(
        (
          await c.query(
            "select lease_expires_at,state from minecraft_deployment_jobs",
          )
        ).rows[0],
      ).toMatchObject({
        state: "issued",
        lease_expires_at: new Date(job.lease_expires_at),
      });
    });
  }));

it("rejects valid-TLS poll responses with altered signer, scope, nonce binding or lifetime", async () => {
  const root = await mkdtemp(join(tmpdir(), "craftlayer-poll-proof-")),
    pki = join(root, "pki"),
    info = await createNodeFixture(pki),
    read = (name: string) => readFile(join(pki, name), "utf8"),
    f = await setup({
      fingerprint: info.certificate_sha256,
      control: nodePrivateKey(await read("control.key")),
      agent: nodePrivateKey(await read("agent.key")),
    });
  let mode = "valid";
  const app = await buildNodeAgentApp({
    control: f.nodes,
    jobs: {
      exchange: (input, peer, signal) => f.jobs.exchange(input, peer, signal),
      recordReceipt: (input, peer) => f.jobs.recordReceipt(input, peer),
      poll: async (input) => {
        const v = input as ReturnType<typeof pollRequest>,
          p = v.payload,
          now = Date.now(),
          payload = {
            schema_version: 1 as const,
            purpose: "node.command.poll.response.v1" as const,
            control_id: nodeDigest(f.control.public_key),
            organization_id: f.org,
            project_id: f.project,
            node_id: mode === "scope" ? randomUUID() : f.node,
            credential_version: 1,
            request_hash: mode === "nonce" ? "0".repeat(64) : nodeDigest(p),
            jobs: [],
            issued_at: new Date(now).toISOString(),
            expires_at: new Date(
              now + (mode === "lifetime" ? 6000 : 1000),
            ).toISOString(),
          };
        return {
          payload,
          signature: signNodeValue(
            payload,
            mode === "signer"
              ? generateNodeKey().private_key
              : f.control.private_key,
          ),
        };
      },
    },
    key: await read("server.key"),
    cert: await read("server.crt"),
    ca: await read("ca.crt"),
  });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 }),
      transport = new CommandTransport({
        connection: {
          url: new URL("/", address).href,
          ca: await read("ca.crt"),
          cert: await read("client.crt"),
          key: await read("client.key"),
          private_key: f.agent.private_key,
          control_public_key: f.control.public_key,
          server_certificate_sha256: info.server_certificate_sha256,
        },
        policy: {
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
      });
    expect((await transport.poll()).jobs).toEqual([]);
    for (mode of ["signer", "scope", "nonce", "lifetime"])
      await expect(transport.poll()).rejects.toThrow("NODE_POLL_RESPONSE");
  } finally {
    await app.close();
    await f.jobs.close();
    await f.nodes.close();
    await f.ledger.close();
    await rm(root, { recursive: true, force: true });
  }
});
