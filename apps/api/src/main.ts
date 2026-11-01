import { AuthService, createResetDelivery } from "@craftlayer/auth";
import {
  createLogger,
  installShutdown,
  parseServerConfig,
  within,
} from "@craftlayer/config";
import { createDatabase } from "@craftlayer/db";
import { ProviderFiles, ProviderGateway } from "@craftlayer/providers";
import { RuntimeService, redisPublisher } from "@craftlayer/runtime";
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
  if (
    Boolean(config.CRAFTLAYER_SMTP_URL) !== Boolean(config.CRAFTLAYER_SMTP_FROM)
  )
    throw new Error("Configure both SMTP URL and sender");
  const auth = new AuthService({
    databaseUrl: config.AUTH_DATABASE_URL,
    bootstrapToken: config.CRAFTLAYER_BOOTSTRAP_TOKEN,
    recoveryToken: config.CRAFTLAYER_RECOVERY_TOKEN,
    csrfSecret: config.CRAFTLAYER_CSRF_SECRET,
    ...(config.CRAFTLAYER_SMTP_URL && config.CRAFTLAYER_SMTP_FROM
      ? {
          deliverReset: createResetDelivery(
            config.CRAFTLAYER_SMTP_URL,
            config.CRAFTLAYER_SMTP_FROM,
            config.CRAFTLAYER_PUBLIC_URL,
          ),
        }
      : {}),
  });
  const authReady = await auth.initialize().then(
    () => true,
    () => false,
  );
  const providers = new ProviderGateway({
    databaseUrl: config.DATABASE_URL,
    auth,
    files: new ProviderFiles({
      keys: config.CRAFTLAYER_PROVIDER_KEY_FILE,
      policy: config.CRAFTLAYER_PROVIDER_POLICY_FILE,
    }),
  });
  const runtime = new RuntimeService({
    databaseUrl: config.DATABASE_URL,
    auth,
    providers,
    cursorSecret: config.CRAFTLAYER_CSRF_SECRET,
  });
  let scheduling = false;
  const publish = redisPublisher(config.REDIS_URL);
  const runtimeTimer = setInterval(() => {
    if (scheduling) return;
    scheduling = true;
    void runtime
      .schedulerTick(publish)
      .catch(() =>
        log.warn(
          { code: "RUNTIME_TICK_FAILED" },
          "Runtime maintenance denied; values omitted",
        ),
      )
      .finally(() => {
        scheduling = false;
      });
  }, 1000);
  runtimeTimer.unref();
  let mailBusy = false;
  const mailTimer = config.CRAFTLAYER_SMTP_URL
    ? setInterval(() => {
        if (mailBusy) return;
        mailBusy = true;
        void auth
          .flushResetMail()
          .catch(() =>
            log.warn(
              { code: "RECOVERY_MAIL_FAILED" },
              "Recovery mail processing failed",
            ),
          )
          .finally(() => {
            mailBusy = false;
          });
      }, 5000)
    : undefined;
  mailTimer?.unref();
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
    commandsQueueMaxLength: 10,
  });
  close = async () => {
    clearInterval(runtimeTimer);
    if (mailTimer) clearInterval(mailTimer);
    if (redis.isOpen) redis.destroy();
    await pool.end();
    await auth.close();
    await providers.close();
    await runtime.close();
  };
  redis.on("error", () =>
    log.warn({ code: "REDIS_UNAVAILABLE" }, "Queue unavailable"),
  );
  await redis.connect().catch(() => {});
  const app = await buildApp({
    logger: log,
    auth,
    providers,
    runtime,
    publicUrl: config.CRAFTLAYER_PUBLIC_URL,
    readiness: async () => {
      const [db, pong] = await within(
        Promise.all([
          pool.query(
            "select to_regclass('public.organizations') is not null and to_regclass('public.provider_connections') is not null and to_regclass('public.runtime_idempotency') is not null as migrated",
          ),
          redis.isReady ? redis.ping() : Promise.resolve(null),
        ]),
      );
      return authReady && db.rows[0]?.migrated === true && pong === "PONG";
    },
  });
  close = async () => {
    await app.close();
    clearInterval(runtimeTimer);
    if (mailTimer) clearInterval(mailTimer);
    if (redis.isOpen) redis.destroy();
    await pool.end();
    await auth.close();
    await providers.close();
    await runtime.close();
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
