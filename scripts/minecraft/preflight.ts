import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const MAX_READ = 262144;
export const readNames = [
  "docker_version",
  "container",
  "containers",
  "firewall_nft",
  "firewall_iptables",
] as const;
export type ReadName = (typeof readNames)[number];
export type ReadResult = {
  status: "ok" | "unavailable" | "denied" | "failed" | "timeout" | "too_large";
  text: string;
};
export const unavailable = (): ReadResult => ({
  status: "unavailable",
  text: "",
});
export type Evidence = {
  container_name: string;
  data_root: string | null;
  commands: Partial<Record<ReadName, ReadResult>>;
  files: Partial<Record<FileName, ReadResult>>;
  disk: { available_bytes: number; total_bytes: number } | null;
  backups: { count: number; newest_mtime_ms: number } | null;
};
export const fileNames = {
  compose: null,
  properties: "server.properties",
  allowlist: "whitelist.json",
  operators: "ops.json",
  geyser: "plugins/Geyser-Spigot/config.yml",
  floodgate: "plugins/floodgate/config.yml",
} as const;
export type FileName = keyof typeof fileNames;
export function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function bounded(result: ReadResult | undefined): ReadResult {
  const r = object(result);
  if (r.status !== "ok") {
    const status = [
      "unavailable",
      "denied",
      "failed",
      "timeout",
      "too_large",
    ].find((v) => v === r.status) as
      | Exclude<ReadResult["status"], "ok">
      | undefined;
    return { status: status ?? "failed", text: "" };
  }
  if (typeof r.text !== "string") return { status: "failed", text: "" };
  if (Buffer.byteLength(r.text) > MAX_READ)
    return { status: "too_large", text: "" };
  return { status: "ok", text: r.text };
}
function json(result: ReadResult | undefined): unknown {
  const r = bounded(result);
  if (r.status !== "ok") return null;
  try {
    return JSON.parse(r.text) as unknown;
  } catch {
    return null;
  }
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null;
}
function version(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
    ? value
    : null;
}
function fingerprint(value: unknown): string | null {
  return typeof value === "string" && value.length <= 4096 ? hash(value) : null;
}
function port(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= 65535 ? n : null;
}
function addressKind(value: unknown) {
  if (typeof value !== "string") return "unknown";
  if (["0.0.0.0", "::", ""].includes(value)) return "all_interfaces";
  if (isIP(value) === 0) return "unknown";
  if (value === "::1" || value.startsWith("127.")) return "loopback";
  return "non_loopback";
}
export function validContainer(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
}
// Parse only literal, unambiguous properties. Escapes/continuations/duplicates
// cannot accidentally become evidence of a secure setting.
function properties(result: ReadResult | undefined) {
  const r = bounded(result);
  const values = new Map<string, string | null>();
  if (r.status !== "ok") return values;
  for (const line of r.text.split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line) || !line.trim()) continue;
    const m = /^\s*([a-zA-Z0-9_.-]+)\s*[=:]\s*([^\\]*)$/.exec(line);
    if (!m?.[1] || m[2] === undefined) {
      // A malformed properties document is not qualified by partial parsing.
      return new Map<string, string | null>();
    }
    const key = m[1];
    values.set(key, values.has(key) ? null : m[2].trim());
  }
  return values;
}
function bool(values: Map<string, string | null>, key: string): boolean | null {
  const v = values.get(key);
  return v === "true" ? true : v === "false" ? false : null;
}
function playerFile(result: ReadResult | undefined) {
  const rows = json(result);
  if (!Array.isArray(rows) || rows.length > 1000) return null;
  return {
    entries: rows.length,
    valid_uuid_entries: rows.filter((v) =>
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        String(object(v).uuid ?? ""),
      ),
    ).length,
  };
}
function fileEvidence(result: ReadResult | undefined) {
  const r = bounded(result);
  return { status: r.status, sha256: r.status === "ok" ? hash(r.text) : null };
}
export function buildReport(evidence: Evidence, now = new Date()) {
  if (
    !validContainer(evidence.container_name) ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("INVALID_PREFLIGHT_INPUT");
  const parsed = json(evidence.commands.container);
  const candidates = Array.isArray(parsed) ? parsed : [];
  const inspected = candidates.length === 1 ? object(candidates[0]) : {};
  const matched =
    inspected.Name === `/${evidence.container_name}` &&
    typeof inspected.Id === "string" &&
    /^[a-f0-9]{64}$/.test(inspected.Id);
  const c = matched ? inspected : {};
  const state = object(c.State);
  const hc = object(c.HostConfig);
  const network = object(c.NetworkSettings);
  const mounts =
    Array.isArray(c.Mounts) && c.Mounts.length <= 100 ? c.Mounts : [];
  const dataMounts = mounts.filter((v) => object(v).Destination === "/data");
  const dataBinding =
    matched && dataMounts.length === 1 && evidence.data_root !== null
      ? object(dataMounts[0]).Source === evidence.data_root
        ? "matched"
        : "mismatch"
      : "unknown";
  const props = properties(
    dataBinding === "matched" ? evidence.files.properties : undefined,
  );
  const mappedPorts = object(network.Ports);
  const ports = Object.entries(mappedPorts)
    .slice(0, 100)
    .flatMap(([key, bindings]) => {
      const m = /^(\d{1,5})\/(tcp|udp)$/.exec(key);
      if (!m || !port(m[1]) || !Array.isArray(bindings)) return [];
      return bindings.slice(0, 16).map((raw) => {
        const v = object(raw);
        return {
          container_port: port(m[1]),
          protocol: m[2],
          host_port: port(v.HostPort),
          host_binding: addressKind(v.HostIp),
        };
      });
    });
  const records = bounded(evidence.commands.containers);
  let otherContainers: { count: number; state_sha256: string } | null = null;
  if (records.status === "ok" && matched) {
    try {
      const rows = records.text.trim().split("\n");
      if (rows.length > 1000) throw new Error("LIMIT");
      const selected = rows.map((line) => object(JSON.parse(line)));
      if (
        selected.some(
          (r) =>
            typeof r.ID !== "string" ||
            !/^[a-f0-9]{64}$/.test(r.ID) ||
            ![
              "running",
              "exited",
              "paused",
              "created",
              "dead",
              "restarting",
              "removing",
            ].includes(String(r.State)),
        )
      )
        throw new Error("INVALID");
      const others = selected
        .filter((r) => r.ID !== c.Id)
        .map((r) => `${r.ID}:${r.State}`)
        .sort();
      otherContainers = {
        count: others.length,
        state_sha256: hash(others.join("\n")),
      };
    } catch {
      // No raw Docker output (including malformed records) is returned.
    }
  }
  const rconPort = port(props.get("rcon.port")) ?? 25575;
  const findings: { code: string; severity: "critical" | "review" }[] = [];
  const add = (code: string, critical = false) =>
    findings.push({ code, severity: critical ? "critical" : "review" });
  if (!matched) add("CONTAINER_NOT_VERIFIED");
  if (dataBinding !== "matched") add("DATA_BINDING_NOT_VERIFIED");
  for (const key of ["online-mode", "white-list", "enforce-whitelist"]) {
    if (bool(props, key) !== true)
      add(
        key === "online-mode"
          ? "ONLINE_AUTH_NOT_VERIFIED"
          : key === "white-list"
            ? "ALLOWLIST_NOT_VERIFIED"
            : "ALLOWLIST_ENFORCEMENT_NOT_VERIFIED",
        bool(props, key) === false,
      );
  }
  if (
    ports.some(
      (p) =>
        p.protocol === "tcp" &&
        (p.container_port === rconPort || p.container_port === 25575) &&
        p.host_binding !== "loopback",
    )
  )
    add("RCON_PUBLISHED_NON_LOOPBACK", true);
  if (["host", "container"].some((v) => String(hc.NetworkMode).startsWith(v)))
    add("NETWORK_ISOLATION_REQUIRES_REVIEW", true);
  if (hc.Privileged === true) add("PRIVILEGED_GAME_CONTAINER", true);
  // Host firewall output is evidence for review, never automatic reachability proof.
  add("EFFECTIVE_FIREWALL_AND_EDGE_REVIEW_REQUIRED");
  add("JAVA_BEDROCK_IDENTITY_TESTS_REQUIRED");
  add("BACKUP_POLICY_AND_ISOLATED_RESTORE_UNVERIFIED");
  const backupCount = integer(evidence.backups?.count, 10000);
  const newest = integer(evidence.backups?.newest_mtime_ms);
  const diskAvailable = integer(evidence.disk?.available_bytes);
  const diskTotal = integer(evidence.disk?.total_bytes);
  return {
    schema_version: 1,
    observed_at: now.toISOString(),
    mode: "read_only_inventory",
    family_ready: false,
    production_verified: false,
    container: {
      verified: matched,
      id: matched ? c.Id : null,
      state:
        matched &&
        [
          "running",
          "exited",
          "paused",
          "created",
          "dead",
          "restarting",
          "removing",
        ].includes(String(state.Status))
          ? String(state.Status)
          : "unknown",
      running: typeof state.Running === "boolean" ? state.Running : null,
      image_id:
        typeof c.Image === "string" && /^sha256:[a-f0-9]{64}$/.test(c.Image)
          ? c.Image
          : null,
      configured_image_sha256: fingerprint(object(c.Config).Image),
      restart_policy: ["no", "always", "unless-stopped", "on-failure"].includes(
        String(object(hc.RestartPolicy).Name),
      )
        ? String(object(hc.RestartPolicy).Name)
        : "unknown",
      memory_limit_bytes: integer(hc.Memory),
      nano_cpu_limit: integer(hc.NanoCpus),
      mounts: mounts.map((v) => {
        const m = object(v);
        return {
          type: ["bind", "volume", "tmpfs"].includes(String(m.Type))
            ? String(m.Type)
            : "unknown",
          source_sha256: fingerprint(m.Source),
          destination_sha256: fingerprint(m.Destination),
          is_data: m.Destination === "/data",
          writable: typeof m.RW === "boolean" ? m.RW : null,
        };
      }),
      networks_sha256: hash(JSON.stringify(object(network.Networks))),
      published_ports: ports,
      data_binding: dataBinding,
    },
    docker: {
      server_version: version(
        object(object(json(evidence.commands.docker_version)).Server).Version,
      ),
      reads: Object.fromEntries(
        readNames.map((name) => [
          name,
          bounded(evidence.commands[name]).status,
        ]),
      ),
      other_containers: otherContainers,
    },
    configuration: {
      files: Object.fromEntries(
        Object.keys(fileNames).map((name) => [
          name,
          fileEvidence(evidence.files[name as FileName]),
        ]),
      ),
      online_authentication: bool(props, "online-mode"),
      allowlist_enabled: bool(props, "white-list"),
      enforce_allowlist: bool(props, "enforce-whitelist"),
      pvp: bool(props, "pvp"),
      command_blocks: bool(props, "enable-command-block"),
      rcon_enabled: bool(props, "enable-rcon"),
      game_port: port(props.get("server-port")),
      allowlist:
        dataBinding === "matched" ? playerFile(evidence.files.allowlist) : null,
      operators:
        dataBinding === "matched" ? playerFile(evidence.files.operators) : null,
      geyser_config_present: bounded(evidence.files.geyser).status === "ok",
      floodgate_config_present:
        bounded(evidence.files.floodgate).status === "ok",
      plugin_versions: "unverified",
      identity_mapping_and_allowlist_behavior: "unverified",
    },
    disk:
      diskAvailable !== null && diskTotal !== null && diskAvailable <= diskTotal
        ? { available_bytes: diskAvailable, total_bytes: diskTotal }
        : null,
    backup_inventory:
      backupCount !== null && newest !== null && newest <= now.getTime()
        ? {
            candidate_files: backupCount,
            newest_age_seconds: Math.floor((now.getTime() - newest) / 1000),
            integrity: "unverified",
            policy: "unverified",
          }
        : null,
    firewall: {
      nft: fileEvidence(evidence.commands.firewall_nft),
      iptables: fileEvidence(evidence.commands.firewall_iptables),
      effective_reachability: "unverified",
      provider_edge: "unverified",
    },
    findings,
  };
}
export type PreflightReport = ReturnType<typeof buildReport>;
