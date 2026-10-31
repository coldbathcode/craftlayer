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
const schema = z.strictObject({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: runtimeUrl,
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
});
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
