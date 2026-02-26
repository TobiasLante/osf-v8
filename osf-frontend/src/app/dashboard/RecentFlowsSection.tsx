import Link from "next/link";

interface Flow {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  last_run_status: string | null;
  last_run_at: string | null;
  updated_at: string;
}

interface RecentFlowsSectionProps {
  flows: Flow[];
}

export function RecentFlowsSection({ flows }: RecentFlowsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent Flows</h2>
        <Link
          href="/flows"
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          View all
        </Link>
      </div>
      {flows.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-md p-6 text-center">
          <p className="text-sm text-text-muted mb-2">No flows yet</p>
          <Link
            href="/flows"
            className="text-sm text-accent hover:text-accent-hover"
          >
            Create your first flow
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {flows.map((flow) => (
            <Link
              key={flow.id}
              href={`/flows/${flow.id}`}
              className="flex items-center gap-3 bg-bg-surface border border-border rounded-sm p-3 hover:border-border-hover transition-colors"
            >
              <span className="text-lg">{flow.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{flow.name}</p>
                {flow.last_run_status && (
                  <p className="text-xs text-text-dim">
                    Last run:{" "}
                    <span
                      className={
                        flow.last_run_status === "completed"
                          ? "text-green-400"
                          : flow.last_run_status === "failed"
                          ? "text-red-400"
                          : "text-yellow-400"
                      }
                    >
                      {flow.last_run_status}
                    </span>
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
