import { errorSchema } from "@craftlayer/contracts";
import { z } from "zod";

/** Raised for every failure an agent can act on; the message is already plain. */
export class CraftLayerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const settings = z.strictObject({
  url: z.url(),
  organization: z.uuid(),
  token: z.string().regex(/^cla_[A-Za-z0-9_-]{43}$/),
});
export type ClientSettings = z.infer<typeof settings>;
/** Reads connection settings from the environment; never logs the token. */
export function settingsFromEnv(
  env: Record<string, string | undefined>,
): ClientSettings {
  const parsed = settings.safeParse({
    url: env.CRAFTLAYER_URL ?? "http://127.0.0.1:3000",
    organization: env.CRAFTLAYER_ORGANIZATION,
    token: env.CRAFTLAYER_AGENT_TOKEN,
  });
  if (!parsed.success)
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      "Set CRAFTLAYER_ORGANIZATION (uuid) and CRAFTLAYER_AGENT_TOKEN (cla_…), and optionally CRAFTLAYER_URL.",
    );
  const url = new URL(parsed.data.url);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback)
    throw new CraftLayerError(
      "SETTINGS_INVALID",
      "CRAFTLAYER_URL must use https unless it points at this machine.",
    );
  return { ...parsed.data, url: url.origin };
}
/** Minimal read-only API client: bearer agent token, one organization, 5 s timeout. */
export class CraftLayerClient {
  constructor(
    private readonly options: ClientSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  get organization() {
    return this.options.organization;
  }
  async get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    if (!path.startsWith("/api/v1/"))
      throw new CraftLayerError("PATH_INVALID", "Only /api/v1 paths are read.");
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.options.url), {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "x-craftlayer-organization": this.options.organization,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new CraftLayerError(
        "UNREACHABLE",
        "CraftLayer did not answer. Check that it is running and CRAFTLAYER_URL is right.",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      const code = error.success ? error.data.error.code : "REQUEST_FAILED";
      throw new CraftLayerError(
        code,
        response.status === 401
          ? "The agent token is invalid, expired or revoked. Ask a manager for a new one."
          : response.status === 403
            ? "This agent is not allowed to read that. A manager can widen its scope."
            : response.status === 404
              ? "Nothing with that ID is visible to this agent."
              : response.status === 429
                ? "Too many requests. Wait a moment and try again."
                : "CraftLayer could not process the request.",
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new CraftLayerError(
        "INVALID_RESPONSE",
        "CraftLayer returned something this version does not understand. Update the MCP server.",
      );
    return parsed.data;
  }
}
