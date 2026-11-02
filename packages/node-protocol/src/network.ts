import { isIP } from "node:net";
export function privateNodeAddress(host: string) {
  if (isIP(host) === 4) {
    const n = host.split(".").map(Number),
      a = n[0] ?? 0,
      b = n[1] ?? 0;
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return isIP(host) === 6 && (host === "::1" || /^f[cd]/i.test(host));
}
