import { SystemStatus } from "./status";

const layers = [
  {
    n: "01",
    title: "A place of your own",
    text: "Run on your hardware. Keep your worlds, keys and decisions close to home.",
    tag: "Self-hosted core",
  },
  {
    n: "02",
    title: "Small teams. Shared purpose.",
    text: "Give each agent a role, a clear task and room to work together.",
    tag: "Fleet engine · planned",
  },
  {
    n: "03",
    title: "Watch your world take shape",
    text: "Minecraft comes first. A few helpful bots, a shared plan and a small village.",
    tag: "Minecraft · planned",
  },
];
export default function Home() {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a href="/" className="brand" aria-label="CraftLayer home">
          <span className="mark" aria-hidden="true">
            ▦
          </span>
          CraftLayer<span className="edition">CORE</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#system">System</a>
          <a href="#roadmap">What’s next</a>
          <a
            href="https://github.com/coldbathcode/craftlayer"
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div>
            <p className="eyebrow">
              <span /> YOUR AGENTS. YOUR WORLD.
            </p>
            <h1>
              Good things
              <br />
              are built
              <br />
              <em>together.</em>
            </h1>
            <p className="intro">
              A private home for coordinated AI agents.
              <br />
              Start small. Give them purpose. See what takes shape.
            </p>
            <a className="primary" href="#system">
              Explore your foundation <span aria-hidden="true">↗</span>
            </a>
            <p className="local-note">
              Open source first. No cloud account required.
            </p>
          </div>
          <div
            className="world"
            aria-label="Illustration of a small village assembled from blocks"
            role="img"
          >
            <div className="world-grid" />
            <div className="terrain">
              <i className="tile t1" />
              <i className="tile t2" />
              <i className="tile t3" />
              <i className="tile t4" />
              <i className="tile t5" />
              <i className="tile t6" />
              <i className="tile t7" />
              <i className="tile t8" />
              <div className="house">
                <div className="roof" />
                <div className="door" />
                <div className="window" />
              </div>
              <div className="tree tree-one" />
              <div className="tree tree-two" />
              <div className="bot bot-one" />
              <div className="bot bot-two" />
            </div>
            <span className="world-label">
              A SHARED WORLD / A SMALL BEGINNING
            </span>
            <span className="coordinate">↗ 00 : FOUNDATION</span>
          </div>
        </section>
        <section
          className="system"
          id="system"
          aria-labelledby="system-heading"
        >
          <div>
            <p className="eyebrow">INSTANCE / 001</p>
            <h2 id="system-heading">Your foundation is here.</h2>
            <p>
              The local service shell is ready. Accounts and permissions are the
              next layer.
            </p>
          </div>
          <div className="system-state">
            <SystemStatus />
            <span className="version">CORE v0.0.0 · FOUNDATION PREVIEW</span>
          </div>
        </section>
        <section className="layers" id="roadmap" aria-label="Build roadmap">
          {layers.map((layer) => (
            <article key={layer.n}>
              <span className="layer-number">{layer.n} /</span>
              <h3>{layer.title}</h3>
              <p>{layer.text}</p>
              <span className="tag">{layer.tag}</span>
            </article>
          ))}
        </section>
        <aside className="notice">
          <strong>A deliberate beginning.</strong>
          <p>
            This is the foundation preview. Agent missions and world controls
            will appear as their build chapters are completed.
          </p>
          <a href="https://github.com/coldbathcode/craftlayer/blob/main/docs/delivery/status.md">
            Follow build progress ↗
          </a>
        </aside>
      </main>
      <footer>
        <span className="brand small">▦ CraftLayer</span>
        <p>Built to be yours.</p>
        <span>LOCAL BY DESIGN</span>
      </footer>
    </div>
  );
}
