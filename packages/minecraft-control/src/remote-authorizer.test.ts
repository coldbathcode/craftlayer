import { generateNodeKey } from "@craftlayer/node-protocol";
import { expect, it } from "vitest";
import { RemoteDeploymentAuthorizer } from "./remote-authorizer.js";

it("restricts current-authority RPC to private pinned HTTPS without credentials or URL parameters", () => {
  const control = generateNodeKey(),
    authority = generateNodeKey(),
    v = {
      url: "https://127.0.0.1:9444/",
      ca: "",
      cert: "",
      key: "",
      serverCertificateSha256: "a".repeat(64),
      authorityPublicKey: authority.public_key,
      controlPrivateKey: control.private_key,
    };
  expect(() => new RemoteDeploymentAuthorizer(v)).not.toThrow();
  for (const url of [
    "https://example.com/",
    "http://127.0.0.1/",
    "https://user:secret@127.0.0.1/",
    "https://127.0.0.1/wrong",
    "https://127.0.0.1/?scope=admin",
  ])
    expect(() => new RemoteDeploymentAuthorizer({ ...v, url })).toThrow();
});
