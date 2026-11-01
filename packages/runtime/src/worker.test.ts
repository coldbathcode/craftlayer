import type { WorkerClaim } from "@craftlayer/contracts";
import { afterEach, expect, it, vi } from "vitest";
import {
  LeaseWatchdog,
  runSimulationClaim,
  type WorkerPort,
} from "./worker.js";

afterEach(() => vi.useRealTimers());
it("uses monotonic request time and cannot renew beyond the original action deadline or resurrect expiry", async () => {
  vi.useFakeTimers();
  let now = 100;
  const w = new LeaseWatchdog(
    { request_started: 0, lease_ms: 15000, deadline_ms: 5000 },
    () => now,
  );
  now = 4000;
  w.renew(15000, 10000, 4000);
  now = 5000;
  expect(() => w.assert()).toThrow("LEASE_LOST");
  expect(w.signal.aborted).toBe(true);
  w.renew(15000, 10000, 5000);
  expect(() => w.assert()).toThrow();
  w.close();
});
it("a hung heartbeat cannot sustain simulation effects beyond the watchdog deadline", async () => {
  vi.useFakeTimers();
  let now = 0;
  const effects: number[] = [];
  const port: WorkerPort = {
    heartbeat: () => new Promise(() => {}),
    prepare: async () => ({
      receipt_id: crypto.randomUUID(),
      cached: false,
      value: "bounded",
      lease_ms: 15000,
      deadline_ms: 10000,
    }),
    decide: async () => ({ blocked: true, reason: "provider" }),
    finish: vi.fn(async () => ({
      ok: true as const,
      state: "succeeded" as const,
    })),
    stopped: vi.fn(async () => ({ ok: true })),
  };
  const claim: WorkerClaim = {
    attempt_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    fence: 1,
    generation: 1,
    attempt_number: 1,
    lease_ms: 15000,
    deadline_ms: 6000,
    action: { kind: "fixture.wait", duration_ms: 10000, value: "bounded" },
  };
  const result = runSimulationClaim(port, claim, {
    clock: () => now,
    onEffect: (at) => effects.push(at),
    requestStarted: 0,
  });
  for (let i = 0; i < 80; i++) {
    now += 100;
    await vi.advanceTimersByTimeAsync(100);
  }
  expect((await result).state).toBe("blocked");
  expect(effects.length).toBeGreaterThan(0);
  expect(Math.max(...effects)).toBeLessThan(6000);
  expect(port.finish).not.toHaveBeenCalled();
  expect(port.stopped).toHaveBeenCalledTimes(1);
  const count = effects.length;
  now += 20000;
  await vi.advanceTimersByTimeAsync(20000);
  expect(effects).toHaveLength(count);
});
it("connected authority loss aborts within a heartbeat interval and cannot dispatch after cancellation", async () => {
  vi.useFakeTimers();
  let now = 0;
  const effects: number[] = [];
  const port: WorkerPort = {
    heartbeat: async () => {
      throw new Error("REVOKED");
    },
    prepare: async () => ({
      receipt_id: crypto.randomUUID(),
      cached: false,
      value: "bounded",
      lease_ms: 15000,
      deadline_ms: 10000,
    }),
    decide: async () => ({ blocked: true, reason: "provider" }),
    finish: vi.fn(async () => ({
      ok: true as const,
      state: "succeeded" as const,
    })),
    stopped: vi.fn(async () => ({ ok: true })),
  };
  const claim: WorkerClaim = {
    attempt_id: crypto.randomUUID(),
    task_id: crypto.randomUUID(),
    fence: 1,
    generation: 1,
    attempt_number: 1,
    lease_ms: 15000,
    deadline_ms: 10000,
    action: { kind: "fixture.wait", duration_ms: 5000, value: "bounded" },
  };
  const result = runSimulationClaim(port, claim, {
    clock: () => now,
    onEffect: (at) => effects.push(at),
    requestStarted: 0,
  });
  for (let i = 0; i < 20; i++) {
    now += 100;
    await vi.advanceTimersByTimeAsync(100);
  }
  expect((await result).state).toBe("blocked");
  expect(Math.max(...effects)).toBeLessThanOrEqual(1000);
  expect(port.finish).not.toHaveBeenCalled();
});

it("loads only protected credentials bound to their organization and worker identity", async () => {
  const { mkdtemp, writeFile, chmod, rm, symlink } = await import(
      "node:fs/promises"
    ),
    { tmpdir } = await import("node:os"),
    { readWorkerCredential, workerOrigin } = await import("./worker.js");
  const directory = await mkdtemp(`${tmpdir()}/craftlayer-worker-credential-`),
    org = crypto.randomUUID(),
    id = crypto.randomUUID(),
    credential = {
      worker_id: id,
      organization_id: org,
      environment_id: crypto.randomUUID(),
      protocol: 1,
      token: `v1.${org}.${id}.${"a".repeat(43)}`,
    };
  try {
    const path = `${directory}/credential`;
    await writeFile(path, JSON.stringify(credential), { mode: 0o600 });
    expect((await readWorkerCredential(path)).worker_id).toBe(id);
    await chmod(path, 0o644);
    await expect(readWorkerCredential(path)).rejects.toThrow();
    await chmod(path, 0o600);
    await symlink(path, `${directory}/link`);
    await expect(readWorkerCredential(`${directory}/link`)).rejects.toThrow();
    await writeFile(
      path,
      JSON.stringify({ ...credential, worker_id: crypto.randomUUID() }),
    );
    await expect(readWorkerCredential(path)).rejects.toThrow();
    for (const url of [
      "http://outside.invalid/",
      "https://user:secret@outside.invalid/",
      "https://outside.invalid/path",
      "https://outside.invalid/?token=fixture",
    ])
      expect(() => workerOrigin(url)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
