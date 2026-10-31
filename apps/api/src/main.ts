import { AuthService } from "@craftlayer/auth";
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
  if (
    !config.AUTH_DATABASE_URL ||
    !config.CRAFTLAYER_BOOTSTRAP_TOKEN ||
    !config.CRAFTLAYER_RECOVERY_TOKEN ||
    !config.CRAFTLAYER_CSRF_SECRET
  )
    throw new Error("Run pnpm setup:local to configure identity");
  const auth = new AuthService({
    databaseUrl: config.AUTH_DATABASE_URL,
    bootstrapToken: config.CRAFTLAYER_BOOTSTRAP_TOKEN,
    recoveryToken: config.CRAFTLAYER_RECOVERY_TOKEN,
    csrfSecret: config.CRAFTLAYER_CSRF_SECRET,
  });
  const authReady = await auth.initialize().then(
    () => true,
    () => false,
  );
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
    commandsQueueMaxLength: 10,
  });
  close = async () => {
    if (redis.isOpen) redis.destroy();
    await pool.end();
    await auth.close();
  };
  redis.on("error", () =>
    log.warn({ code: "REDIS_UNAVAILABLE" }, "Queue unavailable"),
  );
  await redis.connect().catch(() => {});
  const app = await buildApp({
    logger: log,
    auth,
    publicUrl: config.CRAFTLAYER_PUBLIC_URL,
    readiness: async () => {
      const [db, pong] = await within(
        Promise.all([
          pool.query(
            "select to_regclass('public.organizations') is not null as migrated",
          ),
          redis.isReady ? redis.ping() : Promise.resolve(null),
        ]),
      );
      return authReady && db.rows[0]?.migrated === true && pong === "PONG";
    },
  });
  close = async () => {
    await app.close();
    if (redis.isOpen) redis.destroy();
    await pool.end();
    await auth.close();
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
