import { expect, it } from "vitest";
import {
  adoptionRequest,
  capturedObservation,
  inventorySchema,
  serverView,
} from "./minecraft.js";

it("rejects raw command, endpoint, world path and secret fields in management contracts", () => {
  const body = {
    environment_id: "00000000-0000-4000-8000-000000000001",
    target_id: "family",
    name: "Family",
  };
  expect(adoptionRequest.safeParse(body).success).toBe(true);
  for (const field of [
    "organization_id",
    "command",
    "docker_socket",
    "host_path",
    "rcon_password",
    "image",
  ])
    expect(
      adoptionRequest.safeParse({ ...body, [field]: "untrusted" }).success,
    ).toBe(false);
  expect(capturedObservation.safeParse({ state: "online" }).success).toBe(
    false,
  );
  expect(
    inventorySchema.safeParse({
      schema_version: 1,
      targets: [],
      credential: "private",
    }).success,
  ).toBe(false);
  expect(serverView.safeParse({ family_ready: true }).success).toBe(false);
});
