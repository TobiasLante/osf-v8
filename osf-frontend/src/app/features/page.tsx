"use client";

import { useState } from "react";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { ToolCard } from "@/components/ToolCard";
import { tools, categories, categoryMeta } from "@/lib/tools-data";

export default function FeaturesPage() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = activeCategory
    ? tools.filter((t) => t.category === activeCategory)
    : tools;

  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              111 MCP Tools — Full Factory Access
            </h1>
            <p className="text-text-muted max-w-2xl mx-auto">
              Every domain of a real manufacturing operation, accessible via the
              Model Context Protocol. Build agents that read production data,
              monitor quality, and optimize processes.
            </p>
          </div>

          {/* Category filters */}
          <div className="flex flex-wrap justify-center gap-2 mb-10">
            <button
              onClick={() => setActiveCategory(null)}
              className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                activeCategory === null
                  ? "bg-accent text-bg"
                  : "border border-border text-text-muted hover:border-accent/30 hover:text-accent"
              }`}
            >
              All ({tools.length})
            </button>
            {categories.map((cat) => {
              const count = tools.filter((t) => t.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? "bg-accent text-bg"
                      : "border border-border text-text-muted hover:border-accent/30 hover:text-accent"
                  }`}
                >
                  {categoryMeta[cat]?.label || cat} ({count})
                </button>
              );
            })}
          </div>

          {/* Category description */}
          {activeCategory && categoryMeta[activeCategory] && (
            <div className="flex items-center gap-3 mb-8 p-4 rounded-md border border-border bg-bg-surface">
              <svg
                className="w-6 h-6 text-accent shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d={categoryMeta[activeCategory].icon}
                />
              </svg>
              <div>
                <h2 className="font-semibold">
                  {categoryMeta[activeCategory].label}
                </h2>
                <p className="text-sm text-text-muted">
                  {categoryMeta[activeCategory].description}
                </p>
              </div>
            </div>
          )}

          {/* Tool grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
