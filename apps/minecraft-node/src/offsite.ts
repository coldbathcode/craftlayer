import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { z } from "zod";

/** An age public key. Only the holder of the matching private key, which never comes
 * near this host, can read what is encrypted to it. */
export const offsiteRecipient = z.string().regex(/^age1[0-9a-z]{58}$/);
/**
 * Writes `<archive>.age` beside a verified archive (master plan D2, ADR 0050), for the
 * owner's own machine to collect. Runs the `age` program with fixed arguments and no
 * shell. The plain archive stays for local restores. Returns false, leaving no partial
 * file, when encryption did not finish; the backup itself is unaffected.
 */
export async function encryptArchive(
  archivePath: string,
  recipient: string,
  program = "age",
  timeoutMs = 30 * 60_000,
) {
  const to = offsiteRecipient.parse(recipient),
    out = `${archivePath}.age`,
    partial = `${out}.part`;
  await rm(partial, { force: true });
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(program, ["-r", to, "-o", partial, "--", archivePath], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  if (!ok) {
    await rm(partial, { force: true });
    return false;
  }
  await rename(partial, out);
  return true;
}
