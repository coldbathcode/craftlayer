import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { NodeControl } from "@craftlayer/minecraft-control";
import {
  privateNodeAddress,
  protectedNodeFile,
} from "@craftlayer/node-protocol";
import { buildNodeAgentApp } from "./node-agent-app.js";

const url = process.env.DATABASE_URL,
  root = process.env.CRAFTLAYER_NODE_TLS_DIRECTORY;
let close = async () => {};
try {
  if (!url || !root?.startsWith("/"))
    throw new Error("NODE_CONTROL_CONFIGURATION_REQUIRED");
  const [key, cert, ca, signer] = await Promise.all(
    ["server.key", "server.crt", "ca.crt", "control.key"].map((name) =>
      protectedNodeFile(`${root}/${name}`),
    ),
  );
  if (!key || !cert || !ca || !signer)
    throw new Error("NODE_CONTROL_CONFIGURATION_REQUIRED");
  const control = new NodeControl({
    databaseUrl: url,
    controlPrivateKey: signer,
  });
  close = () => control.close();
  const app = await buildNodeAgentApp({ control, key, cert, ca });
  close = async () => {
    await app.close();
    await control.close();
  };
  let host = process.env.CRAFTLAYER_NODE_BIND_HOST ?? "127.0.0.1";
  if (host === "container-private") {
    if (!existsSync("/.dockerenv"))
      throw new Error("NODE_PRIVATE_CONTAINER_REQUIRED");
    // Published loopback traffic enters through the non-internal network.
    // Docker's internal DB network intentionally has no default route.
    const routes = (await readFile("/proc/net/route", "utf8")).split("\n"),
      iface = routes
        .map((line) => line.trim().split(/\s+/))
        .find((row) => row[1] === "00000000")?.[0];
    host =
      (iface ? networkInterfaces()[iface] : [])?.find(
        (v) =>
          v &&
          !v.internal &&
          v.family === "IPv4" &&
          privateNodeAddress(v.address),
      )?.address ?? "";
  }
  if (!privateNodeAddress(host)) throw new Error("NODE_PRIVATE_BIND_REQUIRED");
  await app.listen({ host, port: 9443 });
  console.log("NODE_CONTROL_READY: private mTLS inventory transport");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
} catch {
  await close().catch(() => {});
  console.error("NODE_CONTROL_STARTUP_DENIED; values omitted");
  process.exitCode = 1;
}
