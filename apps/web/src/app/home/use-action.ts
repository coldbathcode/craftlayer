"use client";
import type {
  ServerActionRequest,
  ServerActionView,
} from "@craftlayer/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendly, newKey } from "./lib";
import type { Family } from "./use-family";

export interface ActionWords {
  /** Shown while the host is working, e.g. "Turning off…". */
  working: string;
  /** Shown when the host confirmed it, e.g. "Family Survival is off." */
  done: string;
}
export type ActionStatus =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };
const finished = new Set(["succeeded", "failed", "expired", "cancelled"]);
function failure(action: ServerActionView, serverName: string) {
  switch (action.failure_code) {
    case "expired":
      return "That took too long. Nothing was changed. Try again.";
    case "server_unreachable":
      return `We can't reach ${serverName} right now. It may be off.`;
    case "node_unavailable":
      return `${serverName} can't be turned on or off from here yet. A manager can set this up in Advanced.`;
    case "not_verified":
      return "We asked, but couldn't confirm it worked. Check and try again.";
    case "cancelled":
      return "That was cancelled. Nothing was changed.";
    default:
      return "That didn't work. Check the server, then try again.";
  }
}
/**
 * Asks for one typed action and follows it until the host answers. Says only what is
 * known: waiting while nothing has picked it up, the working words while the host has
 * it, and the done words only once the host confirmed.
 */
export function useServerAction(
  family: Family,
  serverId: string,
  serverName: string,
  onSettled?: () => void,
) {
  const [status, setStatus] = useState<ActionStatus>({ kind: "idle" });
  const alive = useRef(true),
    settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async (action: ServerActionRequest, words: ActionWords) => {
      setStatus({ kind: "working", text: words.working });
      try {
        const accepted = await family.api.act(serverId, action, newKey());
        // Power actions may take minutes; everything else answers in seconds.
        const slow = ["start", "stop", "restart"].includes(action.kind),
          deadline = Date.now() + (slow ? 6 * 60_000 : 45_000);
        let view: ServerActionView | null = null;
        while (alive.current && Date.now() < deadline) {
          view = await family.api.action(accepted.action_id);
          if (finished.has(view.state)) break;
          if (view.awaiting_node)
            setStatus({
              kind: "working",
              text: `Waiting: nothing is looking after ${serverName} yet.`,
            });
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!alive.current) return;
        if (!view || !finished.has(view.state))
          setStatus({
            kind: "failed",
            text: "This is taking longer than expected. It may still finish; check again in a minute.",
          });
        else if (view.state === "succeeded")
          setStatus({ kind: "done", text: words.done });
        else setStatus({ kind: "failed", text: failure(view, serverName) });
      } catch (error) {
        if (!alive.current || family.lost(error)) return;
        setStatus({ kind: "failed", text: friendly(error) });
      } finally {
        settled.current?.();
      }
    },
    [family, serverId, serverName],
  );
  return {
    status,
    busy: status.kind === "working",
    run,
    clear: useCallback(() => setStatus({ kind: "idle" }), []),
  };
}
