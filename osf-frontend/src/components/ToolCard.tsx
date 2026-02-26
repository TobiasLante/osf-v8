export interface Tool {
  name: string;
  description: string;
  category: string;
  params?: { name: string; required: boolean; description?: string }[];
}

export function ToolCard({ tool }: { tool: Tool }) {
  return (
    <div className="p-4 rounded-md border border-border bg-bg-surface hover:border-accent/20 transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <code className="text-sm font-mono text-accent break-all">
          {tool.name}
        </code>
        <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-border text-text-dim">
          {tool.category}
        </span>
      </div>
      <p className="text-sm text-text-muted leading-relaxed">
        {tool.description}
      </p>
      {tool.params && tool.params.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex flex-wrap gap-1.5">
            {tool.params.map((p) => (
              <span
                key={p.name}
                className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
                  p.required
                    ? "bg-accent/10 text-accent"
                    : "bg-bg-surface-2 text-text-dim"
                }`}
              >
                {p.name}
                {p.required && "*"}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
