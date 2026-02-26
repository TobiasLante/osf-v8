import Link from "next/link";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";
import { tools, categories, categoryMeta } from "@/lib/tools-data";
import { wikiCategories, getArticlesByCategory } from "@/lib/wiki-data";

export default function DocsPage() {
  return (
    <>
      <BackgroundOrbs />
      <section className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              Documentation
            </h1>
            <p className="text-text-muted max-w-2xl mx-auto">
              Guides, references, and everything you need to build manufacturing
              AI agents with OpenShopFloor.
            </p>
          </div>

          {/* Wiki Articles */}
          <div className="max-w-5xl mx-auto mb-16">
            <h2 className="text-xl font-bold mb-6">Wiki</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wikiCategories.map((cat) =>
                getArticlesByCategory(cat).map((article) => (
                  <Link
                    key={article.slug}
                    href={`/docs/wiki/${article.slug}`}
                    className="block p-5 rounded-md border border-border bg-bg-surface hover:border-accent/30 transition-colors group"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-text-dim">
                      {cat}
                    </span>
                    <h3 className="font-semibold text-sm mt-1 group-hover:text-accent transition-colors">
                      {article.title}
                    </h3>
                    <p className="text-xs text-text-dim mt-1">
                      {article.description}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Guide Links */}
          <div className="max-w-3xl mx-auto mb-12 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/docs/wiki/code-agents" className="block p-5 rounded-md border border-border bg-bg-surface hover:border-accent/30 transition-colors group">
              <div className="flex items-center gap-3 mb-2">
                <svg viewBox="0 0 16 16" className="w-5 h-5 fill-text-muted group-hover:fill-accent transition-colors"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                <h3 className="font-semibold text-sm group-hover:text-accent transition-colors">GitHub Code Agents</h3>
              </div>
              <p className="text-xs text-text-dim">Write TypeScript agents, deploy from GitHub, SDK reference</p>
            </Link>
            <Link href="/docs/wiki/visual-flows" className="block p-5 rounded-md border border-border bg-bg-surface hover:border-accent/30 transition-colors group">
              <div className="flex items-center gap-3 mb-2">
                <svg className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
                <h3 className="font-semibold text-sm group-hover:text-accent transition-colors">Node-RED Visual Flows</h3>
              </div>
              <p className="text-xs text-text-dim">Visual flow editor, node types, execution model</p>
            </Link>
          </div>

          {/* Getting Started */}
          <div className="max-w-3xl mx-auto mb-16">
            <div className="p-6 rounded-md border border-border bg-bg-surface">
              <h2 className="text-xl font-bold mb-4">Getting Started</h2>
              <div className="space-y-4 text-sm text-text-muted">
                <p>
                  OpenShopFloor exposes a full manufacturing simulation through
                  111 MCP (Model Context Protocol) tools. Your AI agent connects
                  to our MCP server and gets access to real-time factory data.
                </p>
                <div className="p-4 rounded-sm bg-bg-surface-2 border border-border font-mono text-xs">
                  <div className="text-text-dim mb-1">
                    {"// Connect your agent to the MCP server"}
                  </div>
                  <div>
                    <span className="text-accent">endpoint</span>:{" "}
                    <span className="text-green-400">
                      &quot;https://api.openshopfloor.zeroguess.ai/mcp&quot;
                    </span>
                  </div>
                  <div>
                    <span className="text-accent">auth</span>:{" "}
                    <span className="text-green-400">
                      &quot;Bearer YOUR_API_KEY&quot;
                    </span>
                  </div>
                </div>
                <p>
                  The factory simulates a complete manufacturing environment:
                  CNC machines, injection molding (SGM), assembly lines,
                  pre-assembly, and a test field. All connected to ERP, OEE,
                  QMS, and tool management databases.
                </p>
              </div>
            </div>
          </div>

          {/* Tool Reference */}
          <div id="tools" className="scroll-mt-24">
            <h2 className="text-2xl font-bold text-center mb-8">
              Tool Reference
            </h2>

            {categories.map((cat) => {
              const catTools = tools.filter((t) => t.category === cat);
              const meta = categoryMeta[cat];
              return (
                <div key={cat} className="mb-12">
                  <div className="flex items-center gap-3 mb-4">
                    <svg
                      className="w-5 h-5 text-accent"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d={meta?.icon || "M13 10V3L4 14h7v7l9-11h-7z"}
                      />
                    </svg>
                    <h3 className="text-lg font-semibold">
                      {meta?.label || cat}
                    </h3>
                    <span className="text-xs text-text-dim">
                      {catTools.length} tools
                    </span>
                  </div>
                  {meta && (
                    <p className="text-sm text-text-muted mb-4 ml-8">
                      {meta.description}
                    </p>
                  )}
                  <div className="space-y-3 ml-8">
                    {catTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="p-4 rounded-md border border-border bg-bg-surface"
                      >
                        <code className="text-sm font-mono text-accent">
                          {tool.name}
                        </code>
                        <p className="text-sm text-text-muted mt-1">
                          {tool.description}
                        </p>
                        {tool.params && tool.params.length > 0 && (
                          <div className="mt-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-text-dim">
                                  <th className="pb-1 pr-4 font-medium w-1/2">
                                    Parameter
                                  </th>
                                  <th className="pb-1 font-medium w-20">
                                    Required
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {tool.params.map((p) => (
                                  <tr key={p.name} className="text-text-muted">
                                    <td className="py-0.5 pr-4 font-mono">
                                      {p.name}
                                    </td>
                                    <td className="py-0.5 w-20">
                                      {p.required ? (
                                        <span className="text-accent">yes</span>
                                      ) : (
                                        <span className="text-text-dim">no</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
