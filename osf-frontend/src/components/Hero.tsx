export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-medium mb-8 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Free Manufacturing AI Playground
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-[-0.045em] leading-[1.05] mb-6 animate-slide-up">
          Build Manufacturing AI Agents in Minutes.{" "}
          <span className="bg-accent-gradient bg-clip-text text-transparent">
            No Factory Required.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-text-muted max-w-2xl mx-auto mb-12 leading-relaxed animate-slide-up" style={{ animationDelay: "0.1s" }}>
          A live factory simulation with 8 CNC machines, injection molding, assembly lines, and 111 AI tools.
          Ask questions, build agents, take challenges — all free.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <a
            href="/register"
            className="px-8 py-4 rounded-md bg-accent-gradient text-bg font-semibold text-sm shadow-[0_4px_24px_rgba(255,149,0,0.35)] hover:shadow-[0_8px_40px_rgba(255,149,0,0.45)] hover:-translate-y-0.5 transition-all"
          >
            Try the Playground &rarr;
          </a>
          <a
            href="/challenges"
            className="px-8 py-4 rounded-md border border-border bg-bg-surface text-text-muted text-sm hover:border-accent/25 hover:text-text hover:-translate-y-0.5 transition-all"
          >
            View Challenges &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
