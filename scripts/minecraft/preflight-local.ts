import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  opendir,
  realpath,
  statfs,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type Evidence,
  fileNames,
  MAX_READ,
  type ReadName,
  type ReadResult,
  readNames,
  unavailable,
  validContainer,
} from "./preflight.js";

function hasControls(value: string) {
  return Array.from(value).some(
    (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
  );
}

export type LocalOptions = {
  container: string;
  socket: string;
  dataRoot?: string;
  compose?: string;
  backupRoot?: string;
};
const searchPaths: Record<string, readonly string[]> = {
  docker: [
    "/usr/bin/docker",
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
  ],
  nft: ["/usr/sbin/nft", "/sbin/nft"],
  iptables: ["/usr/sbin/iptables-save", "/sbin/iptables-save"],
};
export function readCommand(name: ReadName, options: LocalOptions) {
  if (
    !validContainer(options.container) ||
    !isAbsolute(options.socket) ||
    hasControls(options.socket)
  )
    throw new Error("INVALID_LOCAL_TARGET");
  const docker = ["--host", `unix://${options.socket}`];
  switch (name) {
    case "docker_version":
      return {
        binary: "docker",
        args: [...docker, "version", "--format", "{{json .}}"],
      };
    case "container":
      return {
        binary: "docker",
        args: [...docker, "container", "inspect", options.container],
      };
    case "containers":
      return {
        binary: "docker",
        args: [
          ...docker,
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--format",
          "{{json .}}",
        ],
      };
    case "firewall_nft":
      return { binary: "nft", args: ["--json", "list", "ruleset"] };
    case "firewall_iptables":
      return { binary: "iptables", args: [] };
    default:
      throw new Error("UNSUPPORTED_READ");
  }
}
export type ReadRunner = (
  name: ReadName,
  options: LocalOptions,
) => Promise<ReadResult>;
async function binaryPath(name: string) {
  for (const path of searchPaths[name] ?? []) {
    try {
      const s = await lstat(path);
      // Explicit installed CLI locations only; no caller PATH/plugin resolution.
      if (s.isFile() || s.isSymbolicLink()) return path;
    } catch {}
  }
  return null;
}
export const localRead: ReadRunner = async (name, options) => {
  const command = readCommand(name, options);
  const file = await binaryPath(command.binary);
  if (!file) return unavailable();
  return new Promise((done) => {
    execFile(
      file,
      command.args,
      {
        shell: false,
        timeout: 3000,
        killSignal: "SIGKILL",
        maxBuffer: MAX_READ,
        encoding: "utf8",
        // Deliberately exclude DOCKER_HOST/CONTEXT/TLS, user PATH and secrets.
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" },
      },
      (error, stdout) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        done(
          error
            ? {
                status:
                  code === "EACCES"
                    ? "denied"
                    : code === "ENOENT"
                      ? "unavailable"
                      : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                        ? "too_large"
                        : error.killed
                          ? "timeout"
                          : "failed",
                text: "",
              }
            : { status: "ok", text: stdout },
        );
      },
    );
  });
};
export async function readFileBounded(path: string): Promise<ReadResult> {
  let file: FileHandle | undefined;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await file.stat();
    if (!before.isFile()) return { status: "denied", text: "" };
    if (before.size > MAX_READ) return { status: "too_large", text: "" };
    const buffer = Buffer.alloc(MAX_READ + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const after = await file.stat();
    if (bytesRead > MAX_READ) return { status: "too_large", text: "" };
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytesRead !== after.size
    )
      return { status: "failed", text: "" };
    return {
      status: "ok",
      text: buffer.subarray(0, bytesRead).toString("utf8"),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status:
        code === "ENOENT"
          ? "unavailable"
          : ["ELOOP", "EACCES", "EPERM"].includes(code ?? "")
            ? "denied"
            : "failed",
      text: "",
    };
  } finally {
    await file?.close();
  }
}
export async function checkedRoot(path: string): Promise<string> {
  if (!isAbsolute(path) || hasControls(path)) throw new Error("INVALID_ROOT");
  const resolved = resolve(path);
  const s = await lstat(resolved);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (await realpath(resolved)) !== resolved
  )
    throw new Error("INVALID_ROOT");
  return resolved;
}
export async function confinedFile(
  root: string,
  child: string,
): Promise<ReadResult> {
  const path = resolve(root, child);
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return { status: "denied", text: "" };
  try {
    let current = root;
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        return { status: "denied", text: "" };
    }
    return readFileBounded(path);
  } catch {
    return unavailable();
  }
}
export async function collectLocal(
  options: LocalOptions,
  run: ReadRunner = localRead,
): Promise<Evidence> {
  readCommand("container", options); // Validate target even with injected runners.
  const e: Evidence = {
    container_name: options.container,
    data_root: null,
    commands: {},
    files: {},
    disk: null,
    backups: null,
  };
  // Socket check prevents CLI context fallback or an accidental remote transport.
  let socketValid = false;
  try {
    socketValid = (await lstat(options.socket)).isSocket();
  } catch {}
  for (const name of readNames) {
    if (
      name.startsWith("docker") ||
      name === "container" ||
      name === "containers"
    ) {
      if (!socketValid) {
        e.commands[name] = unavailable();
        continue;
      }
    }
    try {
      e.commands[name] = await run(name, options);
    } catch {
      e.commands[name] = { status: "failed", text: "" };
    }
  }
  if (options.compose) e.files.compose = await readFileBounded(options.compose);
  if (options.dataRoot) {
    try {
      e.data_root = await checkedRoot(options.dataRoot);
      for (const [key, name] of Object.entries(fileNames)) {
        if (name)
          e.files[key as keyof typeof fileNames] = await confinedFile(
            e.data_root,
            name,
          );
      }
      const disk = await statfs(e.data_root, { bigint: true });
      const available = disk.bavail * disk.bsize;
      const total = disk.blocks * disk.bsize;
      if (total <= BigInt(Number.MAX_SAFE_INTEGER))
        e.disk = {
          available_bytes: Number(available),
          total_bytes: Number(total),
        };
    } catch {
      e.data_root = null;
    }
  }
  if (options.backupRoot) {
    try {
      const root = await checkedRoot(options.backupRoot);
      const entries = await opendir(root);
      let visited = 0;
      let count = 0;
      let newest = 0;
      for await (const entry of entries) {
        if (++visited > 10000) throw new Error("LIMIT");
        if (!entry.isFile()) continue;
        const s = await lstat(join(root, entry.name));
        if (!s.isFile() || s.isSymbolicLink()) continue;
        count++;
        newest = Math.max(newest, s.mtimeMs);
      }
      e.backups = { count, newest_mtime_ms: Math.floor(newest) };
    } catch {
      e.backups = null;
    }
  }
  return e;
}
