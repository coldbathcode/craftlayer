import { constants } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createRuntimeClient, type RuntimeTransport } from "@craftlayer/sdk";
import { z } from "zod";
import { readSecret } from "./secret.js";

const sessionSchema = z.strictObject({
  origin: z.url(),
  cookie: z.string().max(256),
  csrf: z.string().max(128),
});
const file = () =>
  process.env.CRAFTLAYER_CLI_SESSION_FILE ??
  `${homedir()}/.config/craftlayer/session.json`;
function origin(input: string) {
  const u = new URL(input);
  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    )
  )
    throw new Error("Trusted HTTPS or loopback origin required");
  return u.origin;
}
export async function runtimeCli(args: string[]): Promise<boolean> {
  const [command, sub, org, a, b, key] = args;
  if (
    !["login", "logout", "fleet", "template", "mission"].includes(command ?? "")
  )
    return false;
  try {
    if (command === "login") {
      if (!sub || !org || args.length !== 3)
        throw new Error(
          "Usage: login <origin> <login>; password through hidden input/stdin",
        );
      const base = origin(sub),
        response = await fetch(`${base}/api/v1/auth/login`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { origin: base, "content-type": "application/json" },
          body: JSON.stringify({ login: org, password: await readSecret() }),
        });
      if (!response.ok) throw new Error("Login denied");
      const value = await response.json(),
        cookie = response.headers.get("set-cookie")?.split(";")[0];
      const session = sessionSchema.parse({
          origin: base,
          cookie,
          csrf: value.csrf_token,
        }),
        path = file();
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const info = await stat(dirname(path));
      if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
        throw new Error("Unsafe session directory");
      await writeFile(`${path}.next`, JSON.stringify(session), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(`${path}.next`, path);
      console.log(JSON.stringify({ authenticated: true }));
      return true;
    }
    const handle = await open(
      file(),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let session: z.infer<typeof sessionSchema>;
    try {
      const s = await handle.stat();
      if (
        !s.isFile() ||
        (s.mode & 0o077) !== 0 ||
        s.uid !== process.getuid?.() ||
        s.size > 4096
      )
        throw new Error("Unsafe session file");
      session = sessionSchema.parse(JSON.parse(await handle.readFile("utf8")));
    } finally {
      await handle.close();
    }
    const base = origin(session.origin);
    const send: RuntimeTransport = async (path, schema, options) => {
      const url = new URL(path, base);
      if (url.origin !== base || !url.pathname.startsWith("/api/v1/"))
        throw new Error("API path denied");
      const response = await fetch(url, {
        method: options.method ?? "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          origin: base,
          cookie: session.cookie,
          "x-csrf-token": session.csrf,
          ...(options.organization
            ? { "x-craftlayer-organization": options.organization }
            : {}),
          ...(options.idempotencyKey
            ? { "idempotency-key": options.idempotencyKey }
            : {}),
          ...(options.json !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(options.json !== undefined
          ? { body: JSON.stringify(options.json) }
          : {}),
      });
      if (!response.ok) throw new Error(`API denied (${response.status})`);
      return schema.parse(await response.json());
    };
    if (command === "logout") {
      await send("/api/v1/auth/logout", z.unknown(), {
        method: "POST",
        json: {},
      });
      await unlink(file());
      console.log(JSON.stringify({ authenticated: false }));
      return true;
    }
    const client = createRuntimeClient(send);
    if (!org) throw new Error("Organization required");
    z.uuid().parse(org);
    let result: unknown;
    const json = async () => JSON.parse(await readFile(a ?? "", "utf8"));
    if (command === "fleet" && sub === "agents" && a)
      result = await client.agents(org, z.uuid().parse(a));
    else if (command === "fleet" && sub === "groups" && a)
      result = await client.groups(org, z.uuid().parse(a));
    else if (command === "fleet" && sub === "create-agent")
      result = await client.createAgent(org, await json());
    else if (command === "fleet" && sub === "create-group")
      result = await client.createGroup(org, await json());
    else if (command === "template" && sub === "create")
      result = await client.createTemplate(org, await json());
    else if (command === "template" && sub === "list" && a)
      result = await client.templates(org, z.uuid().parse(a));
    else if (command === "mission" && sub === "create")
      result = await client.createMission(org, z.uuid().parse(b), await json());
    else if (command === "mission" && sub === "get" && a)
      result = await client.mission(org, z.uuid().parse(a));
    else if (command === "mission" && sub === "list" && a)
      result = await client.missions(org, z.uuid().parse(a));
    else if (command === "mission" && sub === "execute" && a)
      result = await client.execute(
        org,
        z.uuid().parse(a),
        z.coerce.number().int().positive().parse(b),
        z.uuid().parse(key),
      );
    else throw new Error("Unknown runtime command; consult runtime runbook");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          error instanceof Error && /^API denied \(\d+\)$/.test(error.message)
            ? error.message
            : "Runtime command failed; check arguments, session and permission. Values omitted.",
      }),
    );
    process.exitCode = 1;
  }
  return true;
}
