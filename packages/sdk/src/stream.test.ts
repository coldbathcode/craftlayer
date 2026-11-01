import { expect, it } from "vitest";
import { readRuntimeStream } from "./stream.js";

const cursor = "a".repeat(128);
function response(text: string, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk)
          controller.enqueue(bytes.slice(i, i + chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
it("parses fragmented UTF-8 frames, deduplicates event IDs and binds frame IDs/types to strict projections", async () => {
  const event = {
      schema_version: 1,
      event_id: crypto.randomUUID(),
      cursor,
      type: "task.ready",
      organization_id: crypto.randomUUID(),
      environment_id: crypto.randomUUID(),
      project_id: crypto.randomUUID(),
      mission_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      aggregate_version: 1,
      payload: { state: "ready" },
    },
    frame = `id: ${cursor}\nevent: task.ready\ndata: ${JSON.stringify(event)}\n\n`,
    seen: unknown[] = [];
  expect(
    await readRuntimeStream(response(frame + frame), (x) => seen.push(x)),
  ).toBe(cursor);
  expect(seen).toHaveLength(1);
  await expect(
    readRuntimeStream(
      response(frame.replace("event: task.ready", "event: mission.succeeded")),
      () => {},
    ),
  ).rejects.toThrow();
  await expect(
    readRuntimeStream(
      response(
        frame.replace('"state":"ready"', '"state":"ready","prompt":"private"'),
      ),
      () => {},
    ),
  ).rejects.toThrow();
  await expect(
    readRuntimeStream(response(`data: ${"x".repeat(65537)}`), () => {}),
  ).rejects.toThrow("EVENT_FRAME_LIMIT");
});
