/**
 * Foundation smoke page — verifies tokens, fonts, and the void background
 * render. The real Direction-B homepage (hero · pipeline · live Faculty Room ·
 * record · faculty · 25% split · $THESIS strip · CTA) is built next, on top of
 * this shell.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-shell px-6 py-[60px]">
      <p className="t-section-tag">AUTONOMOUS · ON-CHAIN · BASE</p>
      <h1 className="t-h1 mt-3">The committee trades your theses.</h1>
      <p className="t-lede mt-4 max-w-xl">
        Foundation scaffold — Direction B. Design tokens, self-hosted fonts
        (Geist + JetBrains Mono), and the grid-and-glow void are wired. The
        homepage, dashboard, and docs are built next.
      </p>

      <div className="mt-8 flex flex-wrap gap-4">
        <span className="t-data rounded-md border border-border bg-panel px-3 py-2">
          $THESIS · <span className="c-accent">Base</span>
        </span>
        <span className="t-data rounded-md border border-border bg-panel px-3 py-2">
          <span className="c-up">+100%</span> → sell 50%
        </span>
        <span className="t-data rounded-md border border-border bg-panel px-3 py-2">
          author share <span className="c-accent">25%</span>
        </span>
      </div>
    </main>
  );
}
