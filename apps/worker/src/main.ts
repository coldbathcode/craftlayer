import { createServer } from "node:http";
import {
  createLogger,
  installShutdown,
  parseWorkerConfig,
  within,
} from "@craftlayer/config";
import { healthSchema } from "@craftlayer/contracts";
import {
  readWorkerCredential,
  startSimulationWorker,
  workerOrigin,
} from "@craftlayer/runtime/worker";
import { createClient } from "redis";

const logger = createLogger();
try {
  const config = parseWorkerConfig(process.env),
    log = createLogger(config.CRAFTLAYER_LOG_LEVEL),
    origin = workerOrigin(config.CRAFTLAYER_WORKER_API_ORIGIN),
    redis = createClient({
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (attempt) => Math.min(5000, 250 * (attempt + 1)),
      },
      commandsQueueMaxLength: 10,
    });
  redis.on("error", () =>
    log.warn({ code: "REDIS_UNAVAILABLE" }, "Queue unavailable"),
  );
  await within(redis.connect()).catch(() => {});
  let consumer: ReturnType<typeof startSimulationWorker> | undefined,
    consumerReady = !config.CRAFTLAYER_WORKER_CREDENTIAL_FILE;
  if (config.CRAFTLAYER_WORKER_CREDENTIAL_FILE) {
    const credential = await readWorkerCredential(
      config.CRAFTLAYER_WORKER_CREDENTIAL_FILE,
    );
    consumer = startSimulationWorker({
      redisUrl: config.REDIS_URL,
      apiOrigin: origin,
      credential,
      onStatus: (state) =>
        log.info(
          { code: "WORKER_TASK_STATE", state },
          "Simulation worker state",
        ),
    });
    void consumer
      .ready()
      .then(() => {
        consumerReady = true;
      })
      .catch(() => {});
  }
  const server = createServer(async (req, res) => {
    if (
      !["/health/live", "/health/ready"].includes(req.url ?? "") ||
      req.method !== "GET"
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    let ready = req.url === "/health/live";
    if (!ready)
      try {
        const [status, pong] = await within(
          Promise.all([
            fetch(`${origin}/health/ready`, {
              redirect: "error",
              signal: AbortSignal.timeout(2000),
            }),
            redis.isReady ? redis.ping() : Promise.resolve(null),
          ]),
        );
        ready = status.ok && pong === "PONG" && consumerReady;
      } catch {}
    res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        healthSchema.parse({
          service: "worker",
          status: ready ? "ok" : "not_ready",
          version: "0.0.0",
        }),
      ),
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  installShutdown(async () => {
    await new Promise<void>((accept, reject) => {
      server.close((error) => (error ? reject(error) : accept()));
      server.closeAllConnections();
    });
    if (consumer) await within(consumer.close(), 3000).catch(() => {});
    if (redis.isOpen) redis.destroy();
  }, log);
  server.listen(
    config.CRAFTLAYER_WORKER_PORT,
    config.CRAFTLAYER_BIND_HOST,
    () =>
      log.info(
        { code: "WORKER_READY", configured: Boolean(consumer) },
        consumer
          ? "Registered simulation worker listening"
          : "Worker healthy; enrollment required for simulation work",
      ),
  );
  server.on("error", () => {
    log.error({ code: "WORKER_LISTEN_FAILED" }, "Worker cannot bind");
    if (redis.isOpen) redis.destroy();
    void consumer?.close();
    process.exitCode = 1;
  });
} catch {
  logger.error(
    { code: "STARTUP_FAILED" },
    "Worker startup failed; validate protected transport configuration. Values omitted.",
  );
  process.exitCode = 1;
}
