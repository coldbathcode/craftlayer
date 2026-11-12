"use client";
import {
  type AuthorityView,
  authoritySchema,
  environmentSchema,
  itemsSchema,
  type Me,
  meSchema,
  type ServerView,
} from "@craftlayer/contracts";
import {
  ApiError,
  familyClient,
  identityRequest,
  minecraftClient,
} from "@craftlayer/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface Family {
  me: Me;
  organization: string;
  organizationName: string;
  csrf: string;
  authority: AuthorityView;
  /** True for an adult who may change things; the API still decides every time. */
  manager: boolean;
  api: ReturnType<typeof familyClient>;
  /** Call with any failed request: a lost session returns everyone to sign-in. */
  lost(error: unknown): boolean;
}
export type SessionState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "child" }
  | { kind: "no-family" }
  | { kind: "error" }
  | { kind: "ready"; family: Family };
/** Who is signed in and which family they are looking at. */
export function useFamily(): SessionState {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const lost = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setState({ kind: "signed-out" });
      return true;
    }
    return false;
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    (async () => {
      const me = await identityRequest("/api/v1/auth/me", meSchema, {
        signal: abort.signal,
      });
      if (me.user.account_type !== "adult") return setState({ kind: "child" });
      const first = me.organizations[0];
      if (!first) return setState({ kind: "no-family" });
      const authority = await identityRequest(
        "/api/v1/auth/authority",
        authoritySchema,
        { organization: first.id, signal: abort.signal },
      );
      setState({
        kind: "ready",
        family: {
          me,
          organization: first.id,
          organizationName: first.name,
          csrf: me.csrf_token,
          authority,
          manager:
            authority.permissions.includes("player:manage") ||
            authority.permissions.includes("server:control"),
          api: familyClient(first.id, me.csrf_token),
          lost,
        },
      });
    })().catch((error) => {
      if (abort.signal.aborted) return;
      setState(
        error instanceof ApiError && error.status === 401
          ? { kind: "signed-out" }
          : { kind: "error" },
      );
    });
    return () => abort.abort();
  }, [lost]);
  return state;
}
/** The family's registered servers, across its Minecraft worlds. */
export async function loadServers(family: Family, signal?: AbortSignal) {
  const worlds = await identityRequest(
    "/api/v1/environments",
    itemsSchema(environmentSchema),
    { organization: family.organization, ...(signal ? { signal } : {}) },
  );
  const api = minecraftClient(family.organization, family.csrf, signal);
  const pages = await Promise.all(
    worlds.items
      .filter((w) => w.type === "minecraft")
      .map((w) => api.list(w.id)),
  );
  return pages
    .flatMap((p) => p.items)
    .filter((s): s is ServerView => s.registered);
}
/**
 * Loads now and then every `everyMs` while the page is visible. Keeps the last good
 * value on a failed refresh and reports the failure, so a screen never goes blank
 * because one poll was missed.
 */
export function usePolled<T>(
  load: (signal: AbortSignal) => Promise<T>,
  everyMs: number,
  onError?: (error: unknown) => void,
) {
  const [value, setValue] = useState<T | null>(null),
    [failed, setFailed] = useState(false),
    [tick, setTick] = useState(0);
  const loader = useRef(load),
    errors = useRef(onError);
  loader.current = load;
  errors.current = onError;
  useEffect(() => {
    void tick;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (document.visibilityState !== "visible") {
        timer = setTimeout(run, everyMs);
        return;
      }
      loader
        .current(abort.signal)
        .then((v) => {
          if (abort.signal.aborted) return;
          setValue(v);
          setFailed(false);
        })
        .catch((error) => {
          if (abort.signal.aborted) return;
          setFailed(true);
          errors.current?.(error);
        })
        .finally(() => {
          if (!abort.signal.aborted) timer = setTimeout(run, everyMs);
        });
    };
    run();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [everyMs, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return useMemo(() => ({ value, failed, refresh }), [value, failed, refresh]);
}
