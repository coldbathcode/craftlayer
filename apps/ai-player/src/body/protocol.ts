/**
 * Protocol fixes the AI player body applies to the Mineflayer client.
 *
 * Minecraft 1.21.2+ servers accept one position-bearing packet per client tick
 * and clear that flag only when the client sends `tick_end`. Mineflayer can
 * answer a teleport and send its physics update in the same tick, which the
 * server answers with a correction (and on Paper 26.3 behind ViaBackwards, a
 * kick). This closes the tick between any two position-bearing packets, the same
 * rule as upstream mineflayer PR #4201. Remove once a released Mineflayer
 * includes it.
 */
export interface PacketWriter {
  write(name: string, params: unknown): unknown;
}

const POSITION_PACKETS = new Set(["position", "position_look"]);

export function installTickEndShim(client: PacketWriter): void {
  const write = client.write.bind(client);
  let positionSinceTickEnd = false;
  client.write = (name: string, params: unknown) => {
    if (name === "tick_end") positionSinceTickEnd = false;
    else if (POSITION_PACKETS.has(name)) {
      if (positionSinceTickEnd) write("tick_end", {});
      positionSinceTickEnd = true;
    }
    return write(name, params);
  };
}
