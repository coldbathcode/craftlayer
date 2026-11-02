import { generateNodeKey } from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { buildExecutionAuthorityApp } from "./execution-authority-app.js";

it("refuses sharing the node-control signing key with the identity proof service before opening a listener", async () => {
  const control = generateNodeKey();
  await expect(
    buildExecutionAuthorityApp({
      auth: {
        guardExecutions: async () => {
          throw new Error("UNUSED");
        },
      },
      authorityPrivateKey: control.private_key,
      controllerPublicKey: control.public_key,
      controllerCertificateSha256: "a".repeat(64),
      key: "",
      cert: "",
      ca: "",
    }),
  ).rejects.toThrow("SEPARATE_SIGNING_KEY");
});
