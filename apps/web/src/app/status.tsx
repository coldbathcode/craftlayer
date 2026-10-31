"use client";
import { healthSchema } from "@craftlayer/contracts";
import { useEffect, useState } from "react";
export function SystemStatus() {
  const [state, setState] = useState<"checking" | "ready" | "unavailable">(
    "checking",
  );
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    void fetch("/api/v1/system/status", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = healthSchema.parse(await response.json());
        setState(
          response.ok && payload.status === "ok" ? "ready" : "unavailable",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
        else setState("unavailable");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  return (
    <p className={`connection ${state}`} role="status">
      <span className="signal" aria-hidden="true" />
      {state === "checking"
        ? "Checking local services…"
        : state === "ready"
          ? "Core API connected"
          : "Core API unavailable"}
    </p>
  );
}
