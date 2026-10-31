import { createServer } from "node:http";
import {
  createLogger,
  installShutdown,
  parseServerConfig,
  within,
} from "@craftlayer/config";
import { healthSchema } from "@craftlayer/contracts";
import { createDatabase } from "@craftlayer/db";
import { createClient } from "redis";

const logger = createLogger();
try {
  const config = parseServerConfig(process.env);
  const log = createLogger(config.CRAFTLAYER_LOG_LEVEL);
  const { pool } = createDatabase(config.DATABASE_URL);
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
    commandsQueueMaxLength: 10,
  });
  redis.on("error", () =>
    log.warn({ code: "REDIS_UNAVAILABLE" }, "Queue unavailable"),
  );
  await redis.connect().catch(() => {});
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
        const [db, pong] = await within(
          Promise.all([
            pool.query(
              "select to_regclass('public.organizations') is not null as migrated",
            ),
            redis.isReady ? redis.ping() : Promise.resolve(null),
          ]),
        );
        ready = db.rows[0]?.migrated === true && pong === "PONG";
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    if (redis.isOpen) redis.destroy();
    await pool.end();
  }, log);
  server.listen(
    config.CRAFTLAYER_WORKER_PORT,
    config.CRAFTLAYER_BIND_HOST,
    () =>
      log.info(
        { code: "WORKER_READY" },
        "Worker shell listening; mission execution arrives in Chapter 03",
      ),
  );
  server.on("error", () => {
    log.error({ code: "WORKER_LISTEN_FAILED" }, "Worker cannot bind");
    if (redis.isOpen) redis.destroy();
    void pool.end();
    process.exitCode = 1;
  });
} catch {
  logger.error(
    { code: "STARTUP_FAILED" },
    "Worker startup failed; validate configuration and local dependencies. Values omitted.",
  );
  process.exitCode = 1;
}
