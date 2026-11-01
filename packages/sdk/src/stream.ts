import {
  eventCursor,
  missionSummary,
  runtimeEvent,
} from "@craftlayer/contracts";
import { z } from "zod";

const snapshot = z.strictObject({
  snapshot: z.array(missionSummary).max(20),
  truncated: z.boolean(),
  resync_required: z.boolean(),
  cursor: eventCursor,
});
const position = z.strictObject({ cursor: eventCursor, has_more: z.boolean() });
export type RuntimeStreamFrame =
  | { type: "snapshot"; data: z.infer<typeof snapshot> }
  | { type: "cursor"; data: z.infer<typeof position> }
  | { type: "event"; data: z.infer<typeof runtimeEvent> };
/** Fetch with trusted origin/cookie headers at the caller; parsing never follows redirects or accepts arbitrary event fields. */
export async function readRuntimeStream(
  response: Response,
  onFrame: (frame: RuntimeStreamFrame) => void,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  )
    throw new Error("EVENT_STREAM_DENIED");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true }),
    seen = new Set<string>();
  let buffer = "",
    cursor: string | undefined;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) break;
        if (boundary > 65536) throw new Error("EVENT_FRAME_LIMIT");
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let type = "message",
          id = "",
          data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) type = line.slice(7);
          else if (line.startsWith("id: ")) id = line.slice(4);
          else if (line.startsWith("data: ")) data += `${line.slice(6)}\n`;
        }
        if (!data) continue;
        const raw: unknown = JSON.parse(data);
        if (type === "snapshot") {
          const value = snapshot.parse(raw);
          cursor = value.cursor;
          onFrame({ type: "snapshot", data: value });
        } else if (type === "cursor") {
          const value = position.parse(raw);
          if (id !== value.cursor) throw new Error("EVENT_CURSOR_MISMATCH");
          cursor = value.cursor;
          onFrame({ type: "cursor", data: value });
        } else {
          const value = runtimeEvent.parse(raw);
          if (type !== value.type || id !== value.cursor)
            throw new Error("EVENT_BINDING_MISMATCH");
          cursor = value.cursor;
          if (seen.has(value.event_id)) continue;
          seen.add(value.event_id);
          if (seen.size > 256) {
            const first = seen.values().next().value;
            if (first) seen.delete(first);
          }
          onFrame({ type: "event", data: value });
        }
      }
      if (buffer.length > 65536) throw new Error("EVENT_FRAME_LIMIT");
    }
    signal?.throwIfAborted();
    return cursor;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
