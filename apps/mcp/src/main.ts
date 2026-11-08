import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CraftLayerClient,
  CraftLayerError,
  settingsFromEnv,
} from "./client.js";
import { registerTools } from "./tools.js";

// stdout carries the protocol; only stderr may be written to by hand.
try {
  const settings = settingsFromEnv(process.env);
  const server = new McpServer({ name: "craftlayer", version: "0.0.0" });
  registerTools(server, new CraftLayerClient(settings));
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `craftlayer-mcp: connected to ${settings.url} for organization ${settings.organization} (read-only)\n`,
  );
} catch (error) {
  process.stderr.write(
    `craftlayer-mcp: ${error instanceof CraftLayerError ? error.message : "failed to start"}\n`,
  );
  process.exit(1);
}
