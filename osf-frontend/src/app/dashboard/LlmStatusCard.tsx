interface LlmStatus {
  online: boolean;
  servers?: Array<{ name: string; active: number; queued: number }>;
  message?: string;
}

interface LlmStatusCardProps {
  llmStatus: LlmStatus | null;
}

export function LlmStatusCard({ llmStatus }: LlmStatusCardProps) {
  return (
    <div className="bg-bg-surface border border-border rounded-md p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-3 h-3 rounded-full ${llmStatus?.online ? 'bg-green-400' : llmStatus === null ? 'bg-gray-500 animate-pulse' : 'bg-amber-400'}`} />
        <h3 className="text-sm font-semibold">LLM Server</h3>
      </div>
      {llmStatus === null ? (
        <p className="text-xs text-text-dim">Checking connection...</p>
      ) : llmStatus.online ? (
        <>
          <p className="text-sm text-green-400 mb-1">Online</p>
          {(llmStatus.servers || []).length > 0 && (() => {
            const totalActive = llmStatus.servers!.reduce((s, sv) => s + sv.active, 0);
            const totalQueued = llmStatus.servers!.reduce((s, sv) => s + sv.queued, 0);
            return (
              <p className="text-xs text-text-dim">
                {totalActive} active{totalQueued > 0 ? `, ${totalQueued} queued` : ''}
              </p>
            );
          })()}
          {(llmStatus.servers || []).length === 0 && (
            <p className="text-xs text-text-dim">Ready for requests</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-amber-400 mb-1">Offline</p>
          <p className="text-xs text-text-dim">{llmStatus.message || 'Server unreachable'}</p>
        </>
      )}
    </div>
  );
}
