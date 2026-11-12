import type { Metadata } from "next";
import "../home/family.css";
export const metadata: Metadata = { title: "Advanced · CraftLayer" };
const pages = [
  [
    "/servers",
    "Servers console",
    "Register a server, see the outside check and its history.",
  ],
  [
    "/nodes",
    "Hosts",
    "Connect the server helper and choose which host looks after a server.",
  ],
  [
    "/account",
    "Account and access",
    "Sign-in, two-step codes, people, roles, invitations and the audit log.",
  ],
] as const;
/** The technical consoles, one tap away and out of the way (B1 principle 5). */
export default function AdvancedPage() {
  return (
    <div className="fam-shell">
      <header className="fam-header">
        <a className="fam-brand" href="/home" aria-label="CraftLayer home">
          <span aria-hidden="true">▦</span> CraftLayer
        </a>
      </header>
      <main className="fam-main">
        <a className="fam-back" href="/home">
          ← Home
        </a>
        <h1 className="fam-title">Advanced</h1>
        <p className="fam-quiet">
          These details are for troubleshooting. Nothing here is needed day to
          day.
        </p>
        {pages.map(([href, title, text]) => (
          <section className="fam-card" key={href}>
            <h2>{title}</h2>
            <p>{text}</p>
            <a className="fam-button" href={href}>
              Open
            </a>
          </section>
        ))}
      </main>
    </div>
  );
}
