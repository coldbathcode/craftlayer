import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { deny } from "./repository.js";

const body = z.strictObject({
  v: z.literal(1),
  scope: z.string().length(64),
  sequence: z.string().regex(/^\d{1,19}$/),
  anchor: z.uuid().nullable(),
  at: z.number().int().nonnegative(),
});
export class EventCursor {
  private key: Buffer;
  constructor(
    secret: string,
    private now: () => number,
  ) {
    this.key = createHash("sha256")
      .update(`craftlayer/runtime-events/v1:${secret}`)
      .digest();
  }
  encode(scope: string, sequence: string, anchor: string | null) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(
        JSON.stringify(
          body.parse({
            v: 1,
            scope,
            sequence: sequence.padStart(19, "0"),
            anchor,
            at: this.now(),
          }),
        ),
        "utf8",
      ),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
  }
  decode(scope: string, input: string) {
    let value: z.infer<typeof body>;
    try {
      if (!/^[A-Za-z0-9_-]{64,2048}$/.test(input))
        throw new Error("Invalid cursor");
      const bytes = Buffer.from(input, "base64url"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          this.key,
          bytes.subarray(0, 12),
        );
      decipher.setAuthTag(bytes.subarray(12, 28));
      value = body.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
          ]).toString("utf8"),
        ),
      );
    } catch {
      deny("CURSOR_DENIED", 403);
    }
    if (value.scope !== scope || value.at > this.now())
      deny("CURSOR_DENIED", 403);
    return { ...value, expired: this.now() - value.at > 900000 };
  }
}
