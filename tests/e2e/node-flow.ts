import { readFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { NodeTransport } from "../../apps/minecraft-node/src/client.js";
import {
  certificateHash,
  generateNodeKey,
  nodeDigest,
} from "../../packages/node-protocol/src/index.js";

/** Disposable installation + real mTLS. Capacity is synthetic; no Docker/game writes. */
export async function nodeFlow(
  page: Page,
  info: TestInfo,
  org: string,
  project: string,
  otherOrg: string,
) {
  const directory = process.env.CRAFTLAYER_E2E_NODE_PKI,
    port = process.env.CRAFTLAYER_E2E_NODE_PORT;
  if (!directory || !port)
    throw new Error("Disposable node transport required");
  const fixture = JSON.parse(
    await readFile(`${directory}/public.json`, "utf8"),
  );
  const config = {
    url: `https://127.0.0.1:${port}`,
    ca: await readFile(`${directory}/ca.crt`, "utf8"),
    cert: await readFile(`${directory}/client.crt`, "utf8"),
    key: await readFile(`${directory}/client.key`, "utf8"),
    private_key: await readFile(`${directory}/agent.key`, "utf8"),
    control_public_key: fixture.control_public_key,
    server_certificate_sha256: fixture.server_certificate_sha256,
  };
  await page.goto("/nodes");
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(org);
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(project);
  await page
    .getByLabel("Host name", { exact: true })
    .fill("Disposable family host");
  await page
    .getByLabel("Public signing key", { exact: true })
    .fill(fixture.public_key);
  await page
    .getByLabel("Client certificate SHA-256", { exact: true })
    .fill(fixture.certificate_sha256);
  await page.getByRole("button", { name: "Approve host enrollment" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Enrollment approved." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Disposable family host", exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    `/api/v1/nodes?project_id=${project}`,
    { headers: { "x-craftlayer-organization": org } },
  );
  expect(response.ok()).toBe(true);
  const node = (await response.json()).items.find(
    (n: { name: string }) => n.name === "Disposable family host",
  );
  expect(node).toBeTruthy();
  const base = (credential_version = 1) => {
    const now = Date.now();
    return {
      schema_version: 1 as const,
      control_id: nodeDigest(fixture.control_public_key),
      organization_id: org,
      node_id: node.id,
      credential_version,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + 30000).toISOString(),
    };
  };
  const capacity = () => ({
    observed_at: new Date().toISOString(),
    docker_api: "1.50" as const,
    architecture: "amd64" as const,
    cpu_count: 4,
    memory_total_mb: 8192,
    memory_reserved_mb: 2048,
    unbounded_containers: 1,
    container_count: 3,
    occupied_ports: [
      { host_ip: "127.0.0.1", port: 25565, protocol: "tcp" as const },
    ],
    network_inventory_complete: false as const,
    disk_quota_verified: false as const,
    provisioning_qualified: false as const,
  });
  const transport = new NodeTransport(config);
  await transport.send({ ...base(), purpose: "node.enroll.v1", sequence: 0 });
  await transport.send({
    ...base(),
    purpose: "node.heartbeat.v1",
    sequence: 1,
    capacity: capacity(),
  });
  await page.getByRole("button", { name: "Refresh hosts" }).click();
  await expect(page.locator(".server-detail-heading .server-state")).toHaveText(
    "Connected · read-only",
  );
  await expect(page.getByText("4 cores", { exact: true })).toBeVisible();
  await expect(
    page.getByText("127.0.0.1:25565", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^(Provision server|Start server|Stop server)$/,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("nodes-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/nodes");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to hosts" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#node-content$/);
  await expect(page.getByText("4 cores", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("nodes-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(otherOrg);
  await expect(
    page.getByText("No host is registered in this project."),
  ).toBeVisible();
  await expect(page.getByText("4 cores", { exact: true })).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption(org);
  await expect(
    page.getByRole("heading", { name: "Disposable family host", exact: true }),
  ).toBeVisible();
  const rotated = generateNodeKey(),
    rotatedCert = await readFile(`${directory}/other.crt`, "utf8");
  await page.getByText("Rotate credentials", { exact: true }).click();
  await page
    .getByLabel("New public signing key", { exact: true })
    .fill(rotated.public_key);
  await page
    .getByLabel("New client certificate SHA-256", { exact: true })
    .fill(certificateHash(rotatedCert));
  await page.getByRole("button", { name: "Rotate host credentials" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Credentials rotated." }),
  ).toBeVisible();
  await expect(
    transport.send({
      ...base(),
      purpose: "node.heartbeat.v1",
      sequence: 2,
      capacity: null,
    }),
  ).rejects.toThrow();
  const replacement = new NodeTransport({
    ...config,
    private_key: rotated.private_key,
    cert: rotatedCert,
    key: await readFile(`${directory}/other.key`, "utf8"),
  });
  await replacement.send({
    ...base(2),
    purpose: "node.heartbeat.v1",
    sequence: 1,
    capacity: capacity(),
  });
  await page.getByRole("button", { name: "Refresh hosts" }).click();
  await page.getByText("Revoke host connection", { exact: true }).click();
  const revoke = page.getByRole("button", { name: "Revoke host credentials" });
  await expect(revoke).toBeDisabled();
  await page
    .getByLabel("Type Disposable family host to revoke")
    .fill("Disposable family host");
  await revoke.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Host connection revoked." }),
  ).toBeVisible();
  await expect(page.locator(".server-detail-heading .server-state")).toHaveText(
    "Revoked",
  );
  await expect(
    replacement.send({
      ...base(2),
      purpose: "node.heartbeat.v1",
      sequence: 2,
      capacity: null,
    }),
  ).rejects.toThrow();
  await page.goto("/servers");
}
