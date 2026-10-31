import {
  createLogger,
  installShutdown,
  parseServerConfig,
  within,
} from "@craftlayer/config";
import { createDatabase } from "@craftlayer/db";
import { createClient } from "redis";
import { buildApp } from "./app.js";

const logger = createLogger();
let close = async () => {};
try {
  const config = parseServerConfig(process.env);
  const log = createLogger(config.CRAFTLAYER_LOG_LEVEL);
  const { pool } = createDatabase(config.DATABASE_URL);
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
    commandsQueueMaxLength: 10,
  });
  close = async () => {
    if (redis.isOpen) redis.destroy();
    await pool.end();
  };
  redis.on("error", () =>
    log.warn({ code: "REDIS_UNAVAILABLE" }, "Queue unavailable"),
  );
  await redis.connect().catch(() => {});
  const app = await buildApp({
    logger: log,
    readiness: async () => {
      const [db, pong] = await within(
        Promise.all([
          pool.query(
            "select to_regclass('public.organizations') is not null as migrated",
          ),
          redis.isReady ? redis.ping() : Promise.resolve(null),
        ]),
      );
      return db.rows[0]?.migrated === true && pong === "PONG";
    },
  });
  close = async () => {
    await app.close();
    if (redis.isOpen) redis.destroy();
    await pool.end();
  };
  installShutdown(() => close(), log);
  await app.listen({
    host: config.CRAFTLAYER_BIND_HOST,
    port: config.CRAFTLAYER_API_PORT,
  });
  log.info({ code: "API_READY" }, "API shell listening");
} catch {
  await close().catch(() => {});
  logger.error(
    { code: "STARTUP_FAILED" },
    "API startup failed; validate configuration and local dependencies. Values omitted.",
  );
  process.exitCode = 1;
}
