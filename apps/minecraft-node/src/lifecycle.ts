import { request } from "node:http";
import { z } from "zod";

/** Which container is the game server, named by the operator in the agent's private
 * configuration by its Compose labels. Callers never choose a container. */
export const containerTarget = z.strictObject({
  compose_project: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  compose_service: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/),
});
export type ContainerTarget = z.infer<typeof containerTarget>;
export interface PowerControl {
  running(): Promise<boolean>;
  start(): Promise<void>;
  /** Asks the server to stop and waits for it; the engine's own stop signal lets the
   * server save and exit, and a container stopped this way is not restarted by policy. */
  stop(): Promise<void>;
}
const containerId = z.string().regex(/^[a-f0-9]{64}$/);
const STOP_SECONDS = 90;
/**
 * Start and stop for exactly one container (master plan A3, ADR 0047). The only engine
 * calls are a filtered list by the two configured labels, and start/stop of the single
 * container that list returned. There is no create, remove, exec, image or volume call,
 * and a label match that is not exactly one container is refused.
 */
export class DockerPower implements PowerControl {
  constructor(
    private readonly socket: string,
    private readonly target: ContainerTarget,
  ) {
    if (!socket.startsWith("/") || socket.includes("\0"))
      throw new Error("LOCAL_DOCKER_SOCKET_REQUIRED");
    containerTarget.parse(target);
  }
  #call(method: "GET" | "POST", path: string, timeoutMs: number) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socket,
          path: `/v1.50${path}`,
          method,
          agent: false,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 262144) req.destroy(new Error("DOCKER_RESPONSE_LIMIT"));
            else chunks.push(chunk);
          });
          res.on("error", () => reject(new Error("DOCKER_UNAVAILABLE")));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("timeout", () => req.destroy(new Error("DOCKER_TIMEOUT")));
      req.on("error", () => reject(new Error("DOCKER_UNAVAILABLE")));
      req.end();
    });
  }
  async #find() {
    const filters = encodeURIComponent(
      JSON.stringify({
        label: [
          `com.docker.compose.project=${this.target.compose_project}`,
          `com.docker.compose.service=${this.target.compose_service}`,
        ],
      }),
    );
    const res = await this.#call(
      "GET",
      `/containers/json?all=true&filters=${filters}`,
      3000,
    );
    if (res.status !== 200) throw new Error("DOCKER_UNAVAILABLE");
    const found = z
      .array(z.object({ Id: containerId, State: z.string() }))
      .max(16)
      .parse(JSON.parse(res.body));
    const only = found[0];
    if (found.length !== 1 || !only)
      throw new Error("GAME_CONTAINER_AMBIGUOUS");
    return { id: only.Id, running: only.State === "running" };
  }
  async running() {
    return (await this.#find()).running;
  }
  async start() {
    const { id } = await this.#find();
    const res = await this.#call("POST", `/containers/${id}/start`, 15000);
    // 304: already started.
    if (res.status !== 204 && res.status !== 304)
      throw new Error("GAME_CONTAINER_START_REFUSED");
  }
  async stop() {
    const { id } = await this.#find();
    const res = await this.#call(
      "POST",
      `/containers/${id}/stop?t=${STOP_SECONDS}`,
      (STOP_SECONDS + 20) * 1000,
    );
    // 304: already stopped.
    if (res.status !== 204 && res.status !== 304)
      throw new Error("GAME_CONTAINER_STOP_REFUSED");
  }
}
