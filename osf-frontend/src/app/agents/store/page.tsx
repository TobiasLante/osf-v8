import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";

export default function AgentStorePage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-32 pb-20 px-6">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-semibold mb-6">
            Coming Soon
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">
            Agent Store
          </h1>
          <p className="text-lg text-text-muted max-w-xl mx-auto mb-8">
            Share your agents with the community, discover templates built by
            others, and compose multi-agent workflows. Coming soon.
          </p>

          <div className="bg-bg-surface border border-border rounded-md p-8 mb-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-3xl mb-3">🔧</div>
                <h3 className="font-semibold mb-1">Build</h3>
                <p className="text-sm text-text-dim">
                  Create agents with custom system prompts and tool selections
                </p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-3">🌐</div>
                <h3 className="font-semibold mb-1">Share</h3>
                <p className="text-sm text-text-dim">
                  Publish your agents to the community store
                </p>
              </div>
              <div className="text-center">
                <div className="text-3xl mb-3">🔗</div>
                <h3 className="font-semibold mb-1">Compose</h3>
                <p className="text-sm text-text-dim">
                  Chain agents into multi-step workflows
                </p>
              </div>
            </div>
          </div>

          <Link
            href="/agents"
            className="text-accent hover:text-accent-hover transition-colors"
          >
            Browse Featured Agents
          </Link>
        </div>
      </section>
    </>
  );
}
