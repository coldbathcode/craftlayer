"use client";
import type { ServerView } from "@craftlayer/contracts";
import { useCallback, useEffect, useState } from "react";
import { FamilyScreen } from "./family-screen";
import { HelpersScreen } from "./helpers-screen";
import { HomeScreen } from "./home-screen";
import { Card } from "./parts";
import { ServerScreen, type ServerTab, serverTabs } from "./server-screen";
import type { Family } from "./use-family";
import { loadServers, useFamily, usePolled } from "./use-family";

type Route =
  | { screen: "home" }
  | { screen: "server"; id: string; tab: ServerTab }
  | { screen: "family" }
  | { screen: "helpers" };
/** The address after # says which screen is open, so Back and a shared link work. */
function parse(hash: string): Route {
  const [, first, id, tab] = hash.replace(/^#/, "").split("/");
  if (first === "family") return { screen: "family" };
  if (first === "helpers") return { screen: "helpers" };
  if (first === "server" && id && /^[0-9a-f-]{36}$/.test(id))
    return {
      screen: "server",
      id,
      tab: serverTabs.some(([key]) => key === tab)
        ? (tab as ServerTab)
        : "players",
    };
  return { screen: "home" };
}
function Signed({ family }: { family: Family }) {
  const [route, setRoute] = useState<Route>({ screen: "home" });
  useEffect(() => {
    const read = () => setRoute(parse(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = useCallback((hash: string) => {
    window.location.hash = hash;
    window.scrollTo(0, 0);
  }, []);
  const servers = usePolled<ServerView[]>(
    (signal) => loadServers(family, signal),
    60000,
    family.lost,
  );
  const server =
    route.screen === "server"
      ? (servers.value?.find((s) => s.id === route.id) ?? null)
      : null;
  const section =
    route.screen === "family" || route.screen === "helpers"
      ? route.screen
      : "home";
  return (
    <div className="fam-shell">
      <a className="skip" href="#fam-main">
        Skip to content
      </a>
      <header className="fam-header">
        <a className="fam-brand" href="#/" aria-label="CraftLayer home">
          <span aria-hidden="true">▦</span> CraftLayer
        </a>
        <span className="fam-family">{family.organizationName}</span>
      </header>
      <nav className="fam-nav" aria-label="Main">
        {(
          [
            ["home", "#/", "Home"],
            ["family", "#/family", "Family"],
            ["helpers", "#/helpers", "AI helpers"],
          ] as const
        ).map(([key, href, label]) => (
          <a
            key={key}
            href={href}
            aria-current={section === key ? "page" : undefined}
          >
            {label}
          </a>
        ))}
        <a href="/advanced">Advanced</a>
      </nav>
      <main id="fam-main" className="fam-main">
        {servers.failed && !servers.value ? (
          <p className="fam-status fam-status-failed" role="alert">
            We couldn't load your servers. Check your connection and try again.
          </p>
        ) : null}
        {route.screen === "home" ? (
          <HomeScreen
            family={family}
            servers={servers.value}
            open={(id, tab) => go(`#/server/${id}/${tab}`)}
          />
        ) : null}
        {route.screen === "server" ? (
          server ? (
            <>
              <a className="fam-back" href="#/">
                ← Home
              </a>
              <ServerScreen
                family={family}
                server={server}
                tab={route.tab}
                open={(tab) => go(`#/server/${server.id}/${tab}`)}
              />
            </>
          ) : servers.value ? (
            <Card>
              <p>That server isn't here any more.</p>
              <a className="fam-link" href="#/">
                Back to Home
              </a>
            </Card>
          ) : (
            <p className="fam-quiet">Loading…</p>
          )
        ) : null}
        {route.screen === "family" ? <FamilyScreen family={family} /> : null}
        {route.screen === "helpers" ? (
          <HelpersScreen family={family} servers={servers.value ?? []} />
        ) : null}
      </main>
      <footer className="fam-footer">
        Signed in as {family.me.user.login} ·{" "}
        <a className="fam-link" href="/account">
          Account
        </a>
      </footer>
    </div>
  );
}
export function FamilyApp() {
  const session = useFamily();
  if (session.kind === "ready") return <Signed family={session.family} />;
  return (
    <div className="fam-shell">
      <header className="fam-header">
        <a className="fam-brand" href="/" aria-label="CraftLayer">
          <span aria-hidden="true">▦</span> CraftLayer
        </a>
      </header>
      <main id="fam-main" className="fam-main">
        {session.kind === "loading" ? (
          <p className="fam-quiet">Loading…</p>
        ) : (
          <Card>
            {session.kind === "signed-out" ? (
              <>
                <h1 className="fam-title">Sign in to see your servers</h1>
                <p>You've been signed out to keep things safe.</p>
                <a className="fam-button fam-primary" href="/account">
                  Sign in
                </a>
              </>
            ) : session.kind === "child" ? (
              <>
                <h1 className="fam-title">This page is for grown-ups</h1>
                <p>Ask a parent if you need something changed on the server.</p>
              </>
            ) : session.kind === "no-family" ? (
              <>
                <h1 className="fam-title">No family set up yet</h1>
                <p>Your account isn't part of a family here yet.</p>
                <a className="fam-button" href="/account">
                  Open your account
                </a>
              </>
            ) : (
              <>
                <h1 className="fam-title">We can't reach CraftLayer</h1>
                <p>Check your connection, then reload this page.</p>
              </>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
