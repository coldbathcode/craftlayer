import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";
import { z } from "zod";

const runtimeUrl = z.url().refine((value) => {
  const u = new URL(value);
  return (
    ["postgres:", "postgresql:"].includes(u.protocol) &&
    u.username === "craftlayer_runtime" &&
    !!u.password
  );
}, "requires the restricted craftlayer_runtime database role");
const ownerRecoverySchema = z.strictObject({
  AUTH_DATABASE_URL: z.url().refine((value) => {
    const u = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(u.protocol) &&
      u.username === "craftlayer_identity" &&
      Boolean(u.password)
    );
  }),
  CRAFTLAYER_BOOTSTRAP_TOKEN: z.string().regex(/^[a-f0-9]{64}$/),
  CRAFTLAYER_RECOVERY_TOKEN: z.string().regex(/^[a-f0-9]{64}$/),
  CRAFTLAYER_CSRF_SECRET: z.string().regex(/^[a-f0-9]{64}$/),
});
export function parseOwnerRecoveryConfig(
  env: Record<string, string | undefined>,
) {
  const result = ownerRecoverySchema.safeParse(
    Object.fromEntries(
      Object.keys(ownerRecoverySchema.shape).map((key) => [key, env[key]]),
    ),
  );
  if (!result.success)
    throw new Error("Invalid local identity configuration; values omitted.");
  return result.data;
}
const schema = z
  .strictObject({
    CRAFTLAYER_NODE_CONTROL_PUBLIC_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{59}$/)
      .optional(),
    CRAFTLAYER_MINECRAFT_INVENTORY_FILE: z.string().startsWith("/").optional(),
    CRAFTLAYER_PROVIDER_KEY_FILE: z.string().startsWith("/").optional(),
    CRAFTLAYER_PROVIDER_POLICY_FILE: z.string().startsWith("/").optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: runtimeUrl,
    CRAFTLAYER_SMTP_URL: z
      .url()
      .refine((value) => {
        const u = new URL(value);
        return (
          u.protocol === "smtps:" && !u.search && !u.hash && u.pathname === "/"
        );
      }, "TLS SMTP URL required")
      .optional(),
    CRAFTLAYER_SMTP_FROM: z.email().optional(),
    AUTH_DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          new URL(value).username === "craftlayer_identity" &&
          ["postgres:", "postgresql:"].includes(new URL(value).protocol),
        "requires restricted identity role",
      )
      .optional(),
    CRAFTLAYER_BOOTSTRAP_TOKEN: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    CRAFTLAYER_RECOVERY_TOKEN: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    CRAFTLAYER_CSRF_SECRET: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    /** Adults must enrol and verify two-factor sign-in before anything else. Set true for any remotely reachable deployment. */
    CRAFTLAYER_REQUIRE_MFA: z.enum(["true", "false"]).optional(),
    CRAFTLAYER_PUBLIC_URL: z
      .url()
      .refine((value) => {
        const u = new URL(value);
        return (
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === "/" &&
          (u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
        );
      }, "TLS required except loopback")
      .default("http://127.0.0.1:3000"),
    REDIS_URL: z
      .url()
      .refine(
        (v) => ["redis:", "rediss:"].includes(new URL(v).protocol),
        "requires Redis URL",
      ),
    CRAFTLAYER_BIND_HOST: z
      .enum(["127.0.0.1", "0.0.0.0", "::1"])
      .default("127.0.0.1"),
    CRAFTLAYER_HTTP_PORT: z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .default(3000),
    CRAFTLAYER_API_PORT: z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .default(4000),
    CRAFTLAYER_WORKER_PORT: z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .default(4001),
    CRAFTLAYER_LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "silent"])
      .default("info"),
    CRAFTLAYER_API_ORIGIN: z.url().default("http://127.0.0.1:4000"),
  })
  .refine(
    (c) => Boolean(c.CRAFTLAYER_SMTP_URL) === Boolean(c.CRAFTLAYER_SMTP_FROM),
    { message: "Configure both SMTP URL and sender" },
  );
export type ServerConfig = z.infer<typeof schema>;
export function parseServerConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  const values = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) =>
        value !== undefined &&
        (key.startsWith("CRAFTLAYER_") ||
          [
            "NODE_ENV",
            "DATABASE_URL",
            "REDIS_URL",
            "AUTH_DATABASE_URL",
            "CRAFTLAYER_SMTP_URL",
          ].includes(key)),
    ),
  );
  const result = schema.safeParse(values);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((i) => i.path.join(".") || "unknown setting").join(", ")}. Values are omitted.`,
    );
  return result.data;
}
export function createLogger(
  level: ServerConfig["CRAFTLAYER_LOG_LEVEL"] = "info",
  destination?: pino.DestinationStream,
) {
  const options: pino.LoggerOptions = {
    level,
    base: { service: "craftlayer" },
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "api_key",
        "DATABASE_URL",
        "AUTH_DATABASE_URL",
        "CRAFTLAYER_SMTP_URL",
        "CRAFTLAYER_BOOTSTRAP_TOKEN",
        "CRAFTLAYER_RECOVERY_TOKEN",
        "CRAFTLAYER_CSRF_SECRET",
        "passwordHash",
        "password_hash",
        "REDIS_URL",
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.secret",
        "*.api_key",
      ],
      censor: "[REDACTED]",
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
export function installShutdown(close: () => Promise<void>, logger: Logger) {
  let stopping = false;
  const handler = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => {
      logger.error({ code: "SHUTDOWN_TIMEOUT" }, "Forced shutdown");
      process.exit(1);
    }, 8000);
    timer.unref();
    void close().then(
      () => {
        clearTimeout(timer);
        logger.info({ code: "STOPPED" }, "Shutdown complete");
      },
      () => {
        clearTimeout(timer);
        process.exitCode = 1;
        logger.error({ code: "SHUTDOWN_FAILED" }, "Shutdown failed");
      },
    );
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
  return () => {
    process.removeListener("SIGTERM", handler);
    process.removeListener("SIGINT", handler);
  };
}
export const newRequestId = () => randomUUID();

/** Bounds a health probe; effectful runtime actions require their own cancellation. */
export async function within<T>(
  operation: Promise<T>,
  milliseconds = 2000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Probe timed out")),
          milliseconds,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Workers have transport credentials only; identity/provider/database authority stays at the API. */
export function parseWorkerConfig(env: Record<string, string | undefined>) {
  const forbidden = [
    "RUNTIME_PASSWORD",
    "IDENTITY_PASSWORD",
    "MIGRATOR_PASSWORD",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "PROVISION_DATABASE_URL",
    "CRAFTLAYER_BOOTSTRAP_TOKEN",
    "CRAFTLAYER_RECOVERY_TOKEN",
    "CRAFTLAYER_CSRF_SECRET",
    "CRAFTLAYER_SMTP_URL",
    "CRAFTLAYER_MINECRAFT_INVENTORY_FILE",
    "CRAFTLAYER_PROVIDER_KEY_FILE",
    "CRAFTLAYER_PROVIDER_POLICY_FILE",
  ];
  if (forbidden.some((key) => Boolean(env[key])))
    throw new Error("Worker secret separation violated; values omitted");
  const worker = z.strictObject({
    REDIS_URL: z
      .url()
      .refine((v) => ["redis:", "rediss:"].includes(new URL(v).protocol)),
    CRAFTLAYER_BIND_HOST: z
      .enum(["127.0.0.1", "0.0.0.0", "::1"])
      .default("127.0.0.1"),
    CRAFTLAYER_WORKER_PORT: z.coerce
      .number()
      .int()
      .min(1024)
      .max(65535)
      .default(4001),
    CRAFTLAYER_WORKER_API_ORIGIN: z.url().default("http://127.0.0.1:4000"),
    CRAFTLAYER_WORKER_CREDENTIAL_FILE: z.string().startsWith("/").optional(),
    CRAFTLAYER_LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "silent"])
      .default("info"),
  });
  const values = Object.fromEntries(
      Object.keys(worker.shape).map((key) => [key, env[key]]),
    ),
    parsed = worker.safeParse(values);
  if (!parsed.success)
    throw new Error("Invalid worker configuration; values omitted");
  return parsed.data;
}
