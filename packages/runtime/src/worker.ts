import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  type AttemptHandle,
  attemptHandle,
  dispatchReference,
  finishView,
  leaseView,
  modelDecision,
  okSchema,
  prepareView,
  type WorkerClaim,
  workerClaim,
  workerCredential,
} from "@craftlayer/contracts";
import { Worker } from "bullmq";
import { z } from "zod";
import { queueName, redisConnection } from "./queue.js";

export class LeaseWatchdog {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly absolute: number;
  private expires: number;
  private last: number;
  constructor(
    initial: { lease_ms: number; deadline_ms: number; request_started: number },
    private readonly clock = () => performance.now(),
  ) {
    this.last = clock();
    this.absolute = initial.request_started + initial.deadline_ms;
    this.expires =
      initial.request_started + Math.min(initial.lease_ms, initial.deadline_ms);
    this.renew(initial.lease_ms, initial.deadline_ms, initial.request_started);
  }
  renew(lease: number, deadline: number, started: number) {
    const now = this.clock();
    if (this.signal.aborted) return;
    if (
      !Number.isFinite(started) ||
      started > now ||
      now < this.last ||
      !Number.isInteger(lease) ||
      lease <= 0 ||
      lease > 15000 ||
      !Number.isInteger(deadline) ||
      deadline <= 0 ||
      deadline > 10000
    ) {
      this.controller.abort();
      return;
    }
    this.last = now;
    this.expires = Math.min(this.absolute, started + lease, started + deadline);
    if (this.timer) clearTimeout(this.timer);
    if (this.expires <= now) this.controller.abort();
    else
      this.timer = setTimeout(
        () => this.controller.abort(),
        this.expires - now,
      );
  }
  assert() {
    const now = this.clock();
    if (now < this.last || now >= this.expires) this.controller.abort();
    this.last = now;
    if (this.signal.aborted) throw new Error("LEASE_LOST");
  }
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.controller.abort();
  }
}
export function workerOrigin(input: string) {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["api", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Trusted control origin required");
  return url.origin;
}
export async function readWorkerCredential(path: string) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid?.() ||
      (s.mode & 0o077) !== 0 ||
      s.size > 4096
    )
      throw new Error("Protected worker credential required");
    const v = workerCredential.parse(JSON.parse(await f.readFile("utf8")));
    if (!v.token.startsWith(`v1.${v.organization_id}.${v.worker_id}.`))
      throw new Error("Worker binding invalid");
    return v;
  } finally {
    await f.close();
  }
}
export class WorkerRpcError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super("Worker control request denied");
  }
}
export interface WorkerPort {
  heartbeat(
    h: AttemptHandle,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof leaseView>>;
  prepare(
    h: AttemptHandle,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof prepareView>>;
  decide(
    h: AttemptHandle,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof modelDecision>>;
  finish(
    v: AttemptHandle & {
      outcome: "succeeded" | "transient" | "failed" | "uncertain" | "cancelled";
      value?: string;
    },
    signal?: AbortSignal,
  ): Promise<z.infer<typeof finishView>>;
  stopped(h: AttemptHandle): Promise<unknown>;
}
export class WorkerRpc implements WorkerPort {
  #credential: z.infer<typeof workerCredential>;
  #origin: string;
  constructor(origin: string, credential: z.infer<typeof workerCredential>) {
    this.#origin = workerOrigin(origin);
    this.#credential = workerCredential.parse(credential);
  }
  private async post<T extends z.ZodType>(
    path: string,
    body: unknown,
    schema: T,
    signal?: AbortSignal,
  ): Promise<z.infer<T>> {
    const response = await fetch(`${this.#origin}/api/v1/worker/${path}`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#credential.token}`,
        "x-craftlayer-worker-protocol": "1",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(path === "decide" ? 10000 : 2000),
          ])
        : AbortSignal.timeout(path === "decide" ? 10000 : 2000),
    });
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > 16384) {
            await reader.cancel();
            throw new WorkerRpcError(502, "INVALID_RESPONSE");
          }
          chunks.push(item.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new WorkerRpcError(502, "INVALID_RESPONSE");
    }
    if (!response.ok) {
      const error = z
        .object({
          error: z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/) }),
        })
        .safeParse(value);
      throw new WorkerRpcError(
        response.status,
        error.success ? error.data.error.code : "WORKER_DENIED",
      );
    }
    return schema.parse(value);
  }
  claim(ref: unknown, signal?: AbortSignal) {
    return this.post(
      "claim",
      dispatchReference.parse(ref),
      z.strictObject({ claim: workerClaim.nullable() }),
      signal,
    );
  }
  heartbeat(h: AttemptHandle, s?: AbortSignal) {
    return this.post("heartbeat", h, leaseView, s);
  }
  prepare(h: AttemptHandle, s?: AbortSignal) {
    return this.post("prepare", h, prepareView, s);
  }
  decide(h: AttemptHandle, s?: AbortSignal) {
    return this.post("decide", h, modelDecision, s);
  }
  finish(
    v: AttemptHandle & {
      outcome: "succeeded" | "transient" | "failed" | "uncertain" | "cancelled";
      value?: string;
    },
    s?: AbortSignal,
  ) {
    return this.post("finish", v, finishView, s);
  }
  stopped(h: AttemptHandle) {
    return this.post("stopped", h, okSchema);
  }
}
async function simulationWait(
  duration: number,
  signal: AbortSignal,
  effect: () => void,
) {
  if (duration === 0) {
    effect();
    return;
  }
  await new Promise<void>((accept, reject) => {
    let elapsed = 0;
    const cleanup = () => {
        clearInterval(timer);
        signal.removeEventListener("abort", abort);
      },
      abort = () => {
        cleanup();
        reject(new Error("STOPPED"));
      },
      timer = setInterval(() => {
        try {
          effect();
          elapsed += 100;
          if (elapsed >= duration) {
            cleanup();
            accept();
          }
        } catch {
          abort();
        }
      }, 100);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function runSimulationClaim(
  port: WorkerPort,
  input: WorkerClaim,
  options: {
    signal?: AbortSignal;
    requestStarted?: number;
    clock?: () => number;
    onEffect?: (at: number) => void;
  } = {},
) {
  const claim = workerClaim.parse(input),
    clock = options.clock ?? (() => performance.now()),
    h = attemptHandle.parse({
      attempt_id: claim.attempt_id,
      task_id: claim.task_id,
      fence: claim.fence,
      generation: claim.generation,
    }),
    watchdog = new LeaseWatchdog(
      {
        lease_ms: claim.lease_ms,
        deadline_ms: claim.deadline_ms,
        request_started: options.requestStarted ?? clock(),
      },
      clock,
    ),
    signal = options.signal
      ? AbortSignal.any([options.signal, watchdog.signal])
      : watchdog.signal;
  let heartbeatActive = false;
  const heartbeat = setInterval(() => {
    if (heartbeatActive || signal.aborted) return;
    heartbeatActive = true;
    const started = clock();
    void port
      .heartbeat(h, signal)
      .then((lease) =>
        watchdog.renew(lease.lease_ms, lease.deadline_ms, started),
      )
      .catch(() => watchdog.controller.abort())
      .finally(() => {
        heartbeatActive = false;
      });
  }, 1000);
  const effect = () => {
    if (signal.aborted) throw new Error("STOPPED");
    watchdog.assert();
    options.onEffect?.(clock());
  };
  try {
    if (signal.aborted) throw new Error("STOPPED");
    watchdog.assert();
    if (
      claim.action.kind === "fixture.fail" &&
      claim.attempt_number <= claim.action.failures &&
      claim.action.failure !== "uncertain"
    )
      return await port.finish(
        {
          ...h,
          outcome:
            claim.action.failure === "transient" ? "transient" : "failed",
        },
        signal,
      );
    if (claim.action.kind === "fixture.model") {
      const started = clock(),
        decision = await port.decide(h, signal);
      if ("blocked" in decision)
        return { ok: true as const, state: "blocked" as const };
      watchdog.renew(decision.lease_ms, decision.deadline_ms, started);
    }
    const started = clock(),
      permit = await port.prepare(h, signal);
    if ("blocked" in permit)
      return { ok: true as const, state: "blocked" as const };
    watchdog.renew(permit.lease_ms, permit.deadline_ms, started);
    watchdog.assert();
    if (!permit.cached) {
      if (claim.action.kind === "fixture.wait")
        await simulationWait(claim.action.duration_ms, signal, effect);
      else effect();
    }
    if (
      claim.action.kind === "fixture.fail" &&
      claim.attempt_number <= claim.action.failures &&
      claim.action.failure === "uncertain"
    )
      return await port.finish({ ...h, outcome: "uncertain" }, signal);
    watchdog.assert();
    return await port.finish(
      { ...h, outcome: "succeeded", value: permit.value ?? "" },
      signal,
    );
  } catch {
    await port.stopped(h).catch(() => {});
    return { ok: true as const, state: "blocked" as const };
  } finally {
    clearInterval(heartbeat);
    watchdog.close();
  }
}
export function startSimulationWorker(options: {
  redisUrl: string;
  apiOrigin: string;
  credential: z.infer<typeof workerCredential>;
  onStatus?: (state: string) => void;
}) {
  const credential = workerCredential.parse(options.credential),
    rpc = new WorkerRpc(options.apiOrigin, credential),
    controller = new AbortController();
  const worker = new Worker(
    queueName(credential.organization_id, credential.environment_id),
    async (job) => {
      const ref = dispatchReference.safeParse(job.data);
      if (
        !ref.success ||
        ref.data.organization_id !== credential.organization_id
      )
        throw new Error("QUEUE_REFERENCE_DENIED");
      const started = performance.now(),
        response = await rpc.claim(ref.data, controller.signal);
      if (!response.claim) return { state: "not_claimed" };
      const result = await runSimulationClaim(rpc, response.claim, {
        requestStarted: started,
        signal: controller.signal,
      });
      options.onStatus?.(result.state);
      return { state: result.state };
    },
    {
      connection: redisConnection(options.redisUrl, true),
      concurrency: 2,
      lockDuration: 15000,
      maxStalledCount: 1,
    },
  );
  worker.on("error", () => options.onStatus?.("transport_unavailable"));
  return {
    close: async () => {
      controller.abort();
      await worker.close(true);
    },
    ready: () => worker.waitUntilReady(),
  };
}
