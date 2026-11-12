import { CraftLayerError } from "./client.js";
import {
  createRemoteServer,
  mcpPath,
  remoteSettingsFromEnv,
} from "./remote.js";

// Remote (Streamable HTTP) entry point. It holds no agent token: each request
// carries its caller's own. Logs are one JSON line of codes per request.
const write = (entry: Record<string, unknown>) =>
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), service: "craftlayer-mcp", ...entry })}\n`,
  );
try {
  const settings = remoteSettingsFromEnv(process.env);
  const server = createRemoteServer(settings, {
    log: ({ outcome, status }) => write({ event: "request", outcome, status }),
  });
  server.once("error", () => {
    write({ event: "listen_failed" });
    process.exit(1);
  });
  server.listen(settings.port, settings.host, () =>
    write({
      event: "listening",
      host: settings.host,
      port: settings.port,
      path: mcpPath,
      api: settings.url,
      organization: settings.organization,
    }),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      write({ event: "stopping" });
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 5_000).unref();
    });
} catch (error) {
  process.stderr.write(
    `craftlayer-mcp: ${error instanceof CraftLayerError ? error.message : "failed to start"}\n`,
  );
  process.exit(1);
}
