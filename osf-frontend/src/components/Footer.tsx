import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-sm bg-accent-gradient flex items-center justify-center text-bg font-bold text-xs">
                OS
              </div>
              <span className="font-semibold">OpenShopFloor</span>
            </div>
            <p className="text-sm text-text-dim leading-relaxed">
              The free Manufacturing AI Playground. Explore, experiment, and
              build manufacturing AI agents with real MCP data.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-text-muted">
              Platform
            </h4>
            <ul className="space-y-2 text-sm text-text-dim">
              <li>
                <Link href="/features" className="hover:text-accent transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/agents" className="hover:text-accent transition-colors">
                  Agents
                </Link>
              </li>
              <li>
                <Link href="/challenges" className="hover:text-accent transition-colors">
                  Challenges
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-accent transition-colors">
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="/docs/wiki/getting-started" className="hover:text-accent transition-colors">
                  Wiki
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-text-muted">
              Factory
            </h4>
            <ul className="space-y-2 text-sm text-text-dim">
              <li>
                <a
                  href="https://osf-factory.zeroguess.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  Live Dashboard
                </a>
              </li>
              <li>
                <Link href="/docs#tools" className="hover:text-accent transition-colors">
                  MCP Tool Reference
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-text-muted">
              Community
            </h4>
            <ul className="space-y-2 text-sm text-text-dim">
              <li>
                <a
                  href="https://github.com/TobiasLante/openshopfloor/discussions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  GitHub Discussions
                </a>
              </li>
              <li>
                <a
                  href="https://discord.gg/openshopfloor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  Discord
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/TobiasLante/openshopfloor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://www.linkedin.com/in/tobiaslante/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent transition-colors"
                >
                  LinkedIn
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-text-muted">
              About
            </h4>
            <ul className="space-y-2 text-sm text-text-dim">
              <li>
                <Link href="/about" className="hover:text-accent transition-colors">
                  About OpenShopFloor
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-text-dim">
            &copy; {new Date().getFullYear()} Tobias Lante &mdash; a personal project by Tobias Lante.
          </p>
          <div className="flex gap-4 text-xs text-text-dim">
            <a
              href="/impressum"
              className="hover:text-accent transition-colors"
            >
              Impressum
            </a>
            <a
              href="/datenschutz"
              className="hover:text-accent transition-colors"
            >
              Datenschutz
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
