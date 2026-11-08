/** Floodgate identifies a Bedrock player by a UUID derived from the Xbox account
 * number (XUID): the first 64 bits are zero, the last 64 bits are the XUID. This is
 * the only identity CraftLayer accepts for a Bedrock player; gamertags are labels. */
export function floodgateUuid(xuid: string): string {
  if (!/^[0-9]{1,20}$/.test(xuid)) throw new Error("XUID_INVALID");
  const value = BigInt(xuid);
  if (value <= 0n || value > 0xffffffffffffffffn)
    throw new Error("XUID_INVALID");
  const hex = value.toString(16).padStart(16, "0");
  return `00000000-0000-0000-${hex.slice(0, 4)}-${hex.slice(4)}`;
}
export function xuidFromFloodgateUuid(uuid: string): string | null {
  const m = /^00000000-0000-0000-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid);
  return m ? BigInt(`0x${m[1]}${m[2]}`).toString() : null;
}
/** Gamertags are 1–16 characters; Floodgate prefixes them and replaces spaces by default. */
export function floodgateName(
  gamertag: string,
  options: { prefix?: string; replaceSpaces?: boolean } = {},
) {
  const trimmed = gamertag.trim();
  if (!/^[A-Za-z0-9 ]{1,16}$/.test(trimmed) || /^ | $| {2}/.test(trimmed))
    throw new Error("GAMERTAG_INVALID");
  const prefix = options.prefix ?? ".";
  if (!/^[^\s]{0,2}$/.test(prefix)) throw new Error("PREFIX_INVALID");
  return `${prefix}${options.replaceSpaces === false ? trimmed : trimmed.replaceAll(" ", "_")}`;
}
