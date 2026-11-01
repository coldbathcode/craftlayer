import { dispatchReference } from "@craftlayer/contracts";
import { type ConnectionOptions, Queue } from "bullmq";
import type { Publisher } from "./scheduler.js";
export function redisConnection(
  url: string,
  worker = false,
): ConnectionOptions {
  const parsed = new URL(url);
  if (!["redis:", "rediss:"].includes(parsed.protocol))
    throw new Error("Redis URL required");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === "rediss:"
      ? { tls: { rejectUnauthorized: true } }
      : {}),
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 2000,
    ...(!worker ? { commandTimeout: 2000 } : {}),
    retryStrategy: worker ? () => 1000 : () => null,
  };
}
export const queueName = (org: string, env: string) =>
  `craftlayer-${org}-${env}`;
export function redisPublisher(url: string): Publisher {
  return async (input, environment) => {
    const reference = dispatchReference.parse(input),
      queue = new Queue(queueName(reference.organization_id, environment), {
        connection: redisConnection(url),
      });
    queue.on("error", () => {});
    try {
      await queue.add("task", reference, {
        jobId: reference.event_id,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    } finally {
      await queue.disconnect().catch(() => {});
    }
  };
}
