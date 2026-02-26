export interface UseCase {
  title: string;
  icon: string;
  description: string;
  tools: string[];
  kpis: string[];
  difficulty: "Beginner" | "Intermediate" | "Advanced";
}

const difficultyColor = {
  Beginner: "text-green-400 border-green-400/20",
  Intermediate: "text-yellow-400 border-yellow-400/20",
  Advanced: "text-red-400 border-red-400/20",
};

export function UseCaseCard({ useCase }: { useCase: UseCase }) {
  return (
    <div className="p-6 rounded-md border border-border bg-bg-surface hover:border-accent/20 transition-colors group">
      <div className="flex items-start justify-between mb-4">
        <span className="text-3xl">{useCase.icon}</span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${difficultyColor[useCase.difficulty]}`}
        >
          {useCase.difficulty}
        </span>
      </div>
      <h3 className="text-lg font-semibold mb-2 group-hover:text-accent transition-colors">
        {useCase.title}
      </h3>
      <p className="text-sm text-text-muted leading-relaxed mb-4">
        {useCase.description}
      </p>
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-medium text-text-dim mb-1.5">
            MCP Tools used
          </h4>
          <div className="flex flex-wrap gap-1">
            {useCase.tools.map((t) => (
              <code
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-surface-2 text-text-dim font-mono"
              >
                {t}
              </code>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-medium text-text-dim mb-1.5">
            Target KPIs
          </h4>
          <div className="flex flex-wrap gap-1">
            {useCase.kpis.map((k) => (
              <span
                key={k}
                className="text-[10px] px-1.5 py-0.5 rounded bg-accent/5 text-accent border border-accent/10"
              >
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
