import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { UseCaseCard } from "@/components/UseCaseCard";
import { useCases } from "@/lib/use-cases-data";

export default function UseCasesPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              Agent Use Cases
            </h1>
            <p className="text-text-muted max-w-2xl mx-auto">
              Six proven scenarios for AI agents in manufacturing. Each comes
              with recommended MCP tools, target KPIs, and difficulty level.
              Start simple or go deep.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {useCases.map((uc) => (
              <UseCaseCard key={uc.title} useCase={uc} />
            ))}
          </div>

          {/* CTA */}
          <div className="text-center mt-16 p-8 rounded-md border border-border bg-bg-surface">
            <h2 className="text-xl font-bold mb-2">
              Ready to build your own agent?
            </h2>
            <p className="text-sm text-text-muted mb-6">
              Get access to the full platform with chat,
              code editor, and agent runtime.
            </p>
            <Link
              href="/#waitlist"
              className="inline-block px-6 py-3 rounded-sm bg-accent-gradient text-bg font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
