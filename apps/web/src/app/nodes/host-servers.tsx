"use client";
import {
  environmentSchema,
  itemsSchema,
  type NodeView,
} from "@craftlayer/contracts";
import { ApiError, identityRequest, minecraftClient } from "@craftlayer/sdk";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  nodeId: string | null;
  canChange: boolean;
};
/** Which registered servers this host carries out actions for. Choosing a host here
 * only decides who runs approved actions; it never starts, stops or changes a server. */
export function HostServers({
  node,
  organization,
  csrf,
  onSessionFailure,
}: {
  node: NodeView;
  organization: string;
  csrf: string;
  onSessionFailure: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const api = minecraftClient(organization, csrf, signal);
      const worlds = await identityRequest(
        "/api/v1/environments",
        itemsSchema(environmentSchema),
        { organization, ...(signal ? { signal } : {}) },
      );
      const servers = (
        await Promise.all(
          worlds.items
            .filter(
              (e) => e.project_id === node.project_id && e.type === "minecraft",
            )
            .map((e) => api.list(e.id)),
        )
      ).flatMap((page) => page.items);
      return Promise.all(
        servers.map(async (s) => {
          const binding = await api.node(s.id);
          return {
            id: s.id,
            name: s.name,
            nodeId: binding.node_id,
            canChange: binding.can_change,
          };
        }),
      );
    },
    [organization, csrf, node.project_id],
  );
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) onSessionFailure(e);
      else
        setError(
          e instanceof ApiError && e.code === "ACTIONS_STILL_OPEN"
            ? "This server still has an action in progress. Try again in a moment."
            : "That did not work. Check your permissions and that the host is connected, then try again.",
        );
    },
    [onSessionFailure],
  );
  useEffect(() => {
    const abort = new AbortController();
    setRows(null);
    setError("");
    load(abort.signal)
      .then((r) => {
        if (!abort.signal.aborted) setRows(r);
      })
      .catch((e) => {
        if (!abort.signal.aborted) fail(e);
      });
    return () => abort.abort();
  }, [load, fail]);
  async function change(row: Row, bind: boolean) {
    if (busy) return;
    setBusy(row.id);
    setError("");
    try {
      const api = minecraftClient(organization, csrf);
      if (bind) await api.bindNode(row.id, node.id);
      else await api.unbindNode(row.id);
      setRows(await load());
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <article className="server-panel">
      <div className="server-panel-title">
        <h3>Servers this host looks after</h3>
        <span className="server-pill">APPROVED ACTIONS ONLY</span>
      </div>
      {error ? (
        <p className="server-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null && !error ? (
        <p className="server-subtle">Loading servers…</p>
      ) : null}
      {rows?.length === 0 ? (
        <p className="server-subtle">
          No servers are registered in this project yet.
        </p>
      ) : null}
      {rows?.length ? (
        <ul className="node-gates">
          {rows.map((row) => {
            const mine = row.nodeId === node.id;
            return (
              <li key={row.id}>
                <span>{mine ? "●" : "○"}</span>
                {row.name}
                {": "}
                {mine
                  ? "this host carries out its actions"
                  : row.nodeId
                    ? "looked after by another host"
                    : "no host yet, so actions wait"}{" "}
                {row.canChange ? (
                  <button
                    type="button"
                    className="server-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => void change(row, !mine)}
                  >
                    {busy === row.id
                      ? "Saving…"
                      : mine
                        ? "Stop using this host"
                        : "Use this host"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="server-subtle">
        The host only runs actions an adult asked for, such as allowing a player
        or sending a message. It cannot run free-form commands.
      </p>
    </article>
  );
}
