import { BackgroundOrbs } from "@/components/BackgroundOrbs";

const CHANNELS = [
  {
    icon: (
      <svg viewBox="0 0 16 16" className="w-6 h-6 fill-current">
        <path d="M1.5 2.75a.25.25 0 0 1 .25-.25h8.5a.25.25 0 0 1 .25.25v5.5a.25.25 0 0 1-.25.25h-3.5a.75.75 0 0 0-.53.22L3.5 11.44V9.25a.75.75 0 0 0-.75-.75h-1a.25.25 0 0 1-.25-.25Zm.25-1.75A1.75 1.75 0 0 0 0 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 0 0 2.487 1.03L7.061 10h3.189A1.75 1.75 0 0 0 12 8.25v-5.5A1.75 1.75 0 0 0 10.25 1ZM14.5 4.75a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.457 1.457 0 0 1-2.487 1.03L9.22 12.28a.75.75 0 0 1 1.06-1.06l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z" />
      </svg>
    ),
    title: "GitHub Discussions",
    desc: "Feature requests, ideas, questions, and in-depth technical discussions. The best place for structured conversations about the platform.",
    href: "https://github.com/TobiasLante/openshopfloor/discussions",
    cta: "Join the Discussion",
    tags: ["Feature Requests", "Q&A", "Show & Tell", "Ideas"],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
      </svg>
    ),
    title: "Discord",
    desc: "Real-time chat with other builders. Get quick help, share your agents, and connect with the community.",
    href: "https://discord.gg/openshopfloor",
    cta: "Join Discord",
    tags: ["Real-time Chat", "Help", "Agent Showcase", "Announcements"],
  },
  {
    icon: (
      <svg viewBox="0 0 16 16" className="w-6 h-6 fill-current">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    ),
    title: "GitHub Repository",
    desc: "Report bugs, submit pull requests, and explore the source code. OpenShopFloor is built in the open.",
    href: "https://github.com/TobiasLante/openshopfloor",
    cta: "View on GitHub",
    tags: ["Bug Reports", "Pull Requests", "Source Code"],
  },
];

export default function CommunityPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Join the{" "}
              <span className="bg-accent-gradient bg-clip-text text-transparent">
                Community
              </span>
            </h1>
            <p className="text-lg text-text-muted max-w-2xl mx-auto">
              Share your experiments, discuss ideas, suggest features, and help shape
              the future of manufacturing AI. Built together, in the open.
            </p>
          </div>

          {/* Channel Cards */}
          <div className="space-y-6 mb-16">
            {CHANNELS.map((ch) => (
              <a
                key={ch.title}
                href={ch.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col sm:flex-row gap-6 p-6 rounded-md border border-border bg-bg-surface hover:border-accent/25 hover:-translate-y-0.5 transition-all"
              >
                <div className="w-12 h-12 rounded-md bg-bg-surface-2 flex items-center justify-center text-text-muted group-hover:bg-accent/10 group-hover:text-accent transition-colors shrink-0">
                  {ch.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold mb-1 group-hover:text-accent transition-colors">
                    {ch.title}
                  </h2>
                  <p className="text-sm text-text-muted mb-3">{ch.desc}</p>
                  <div className="flex flex-wrap gap-2">
                    {ch.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-border bg-bg-surface-2 text-text-dim"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center shrink-0">
                  <span className="text-sm font-semibold text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                    {ch.cta} &rarr;
                  </span>
                </div>
              </a>
            ))}
          </div>

          {/* How to Contribute */}
          <div className="rounded-md border border-border bg-bg-surface p-8">
            <h2 className="text-xl font-bold mb-6">How to Get Involved</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <div className="text-2xl mb-2">💡</div>
                <h3 className="font-semibold text-sm mb-1">Suggest Features</h3>
                <p className="text-xs text-text-muted">
                  Have an idea for a new node, agent template, or platform feature? Start a discussion on GitHub.
                </p>
              </div>
              <div>
                <div className="text-2xl mb-2">🐛</div>
                <h3 className="font-semibold text-sm mb-1">Report Issues</h3>
                <p className="text-xs text-text-muted">
                  Found a bug or something not working right? Open a GitHub issue with details so we can fix it.
                </p>
              </div>
              <div>
                <div className="text-2xl mb-2">🤝</div>
                <h3 className="font-semibold text-sm mb-1">Share Your Agents</h3>
                <p className="text-xs text-text-muted">
                  Built something cool? Share it in Show & Tell on GitHub or the Discord showcase channel.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
