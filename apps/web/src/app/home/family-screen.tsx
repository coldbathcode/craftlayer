"use client";
import { itemsSchema, type Member, memberSchema } from "@craftlayer/contracts";
import { ApiError, identityRequest } from "@craftlayer/sdk";
import { Card } from "./parts";
import { type Family, usePolled } from "./use-family";

/** The built-in role that may change everything; its name never reaches the page. */
const managerRole = "org_admin";
type Group = "manager" | "watcher" | "child";
function groupOf(member: Member): Group {
  if (member.account_type === "child") return "child";
  return member.roles.includes(managerRole) ? "manager" : "watcher";
}
const groups: {
  key: Group;
  title: string;
  about: string;
  empty: string;
  add: string;
}[] = [
  {
    key: "manager",
    title: "Managers",
    about: "Managers can change anything here.",
    empty: "No managers yet.",
    add: "Invite a manager",
  },
  {
    key: "watcher",
    title: "Watchers",
    about: "Watchers can look but not change.",
    empty: "No watchers yet.",
    add: "Invite a watcher",
  },
  {
    key: "child",
    title: "Children",
    about: "Children play; they cannot manage anything.",
    empty: "No children yet.",
    add: "Add a child",
  },
];
export function FamilyScreen({ family }: { family: Family }) {
  const data = usePolled(
    async (signal) => {
      try {
        const page = await identityRequest(
          "/api/v1/memberships",
          itemsSchema(memberSchema),
          { organization: family.organization, signal },
        );
        return { allowed: true as const, members: page.items };
      } catch (error) {
        // Seeing everyone is a manager's job; that is an answer, not a failure.
        if (error instanceof ApiError && error.status === 403)
          return { allowed: false as const, members: [] };
        throw error;
      }
    },
    60000,
    family.lost,
  );
  const heading = <h1 className="fam-title">Family</h1>;
  if (!data.value)
    return (
      <>
        {heading}
        {data.failed ? (
          <p className="fam-status fam-status-failed" role="alert">
            We couldn't load your family. Check your connection and try again.
          </p>
        ) : (
          <p className="fam-quiet">Loading your family…</p>
        )}
      </>
    );
  if (!data.value.allowed)
    return (
      <>
        {heading}
        <Card>
          <p>Only a manager can see everyone here.</p>
          <p className="fam-quiet">
            You're signed in as {family.me.user.login}.{" "}
            {groups.map((g) => g.about).join(" ")}
          </p>
        </Card>
      </>
    );
  const members = data.value.members;
  return (
    <>
      {heading}
      {groups.map((group) => {
        const people = members.filter((m) => groupOf(m) === group.key);
        return (
          <Card key={group.key} title={group.title}>
            <p className="fam-quiet">{group.about}</p>
            {people.length === 0 ? (
              <p className="fam-quiet">{group.empty}</p>
            ) : (
              <ul className="fam-list">
                {people.map((m) => (
                  <li key={m.id}>
                    <span>
                      <strong>{m.login}</strong>
                      {m.user_id === family.me.user.id ? " (you)" : null}
                      {m.disabled_at || m.user_disabled_at ? (
                        <span className="fam-quiet"> (turned off)</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {family.manager ? (
              <div className="fam-row">
                <a className="fam-button" href="/account">
                  {group.add}
                </a>
              </div>
            ) : null}
          </Card>
        );
      })}
      {family.manager ? (
        <p className="fam-quiet">
          Inviting someone and adding a child are done on the account page for
          now. Each button above opens it.
        </p>
      ) : null}
    </>
  );
}
