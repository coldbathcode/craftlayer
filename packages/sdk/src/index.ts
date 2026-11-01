import { errorSchema } from "@craftlayer/contracts";
import type { z } from "zod";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function identityRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  options: {
    method?: string;
    json?: unknown;
    csrf?: string;
    idempotencyKey?: string;
    organization?: string;
    signal?: AbortSignal;
  } = {},
): Promise<z.infer<T>> {
  const resolved = new URL(path, "https://craftlayer.invalid");
  if (
    resolved.origin !== "https://craftlayer.invalid" ||
    !resolved.pathname.startsWith("/api/v1/") ||
    path.includes("\\")
  )
    throw new Error("Same-origin API path required");
  if (!path.startsWith("/api/v1/") || path.includes("://"))
    throw new Error("Same-origin API path required");
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: {
      ...(options.json !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
      ...(options.csrf ? { "x-csrf-token": options.csrf } : {}),
      ...(options.organization
        ? { "x-craftlayer-organization": options.organization }
        : {}),
    },
    ...(options.json !== undefined
      ? { body: JSON.stringify(options.json) }
      : {}),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(value);
    throw new ApiError(
      response.status,
      error.success ? error.data.error.code : "REQUEST_FAILED",
      error.success ? error.data.error.message : "Request failed. Try again.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "The server returned an unexpected response. Refresh and try again.",
    );
  return parsed.data;
}
export * from "./runtime.js";
