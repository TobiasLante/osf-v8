interface TokenUsage {
  tokensUsed: number;
  tokenQuota: number;
  quotaResetAt: string;
  percentUsed: number;
}

interface TokenQuotaCardProps {
  tokenUsage: TokenUsage | null;
}

export function TokenQuotaCard({ tokenUsage }: TokenQuotaCardProps) {
  return (
    <div className="bg-bg-surface border border-border rounded-md p-5">
      <h3 className="text-sm font-semibold mb-3">Token Quota</h3>
      {tokenUsage === null ? (
        <p className="text-xs text-text-dim">Loading...</p>
      ) : tokenUsage.tokenQuota === 0 ? (
        <p className="text-sm text-text-muted">Unlimited (own API key)</p>
      ) : (
        <>
          <div className="flex items-end justify-between mb-2">
            <span className="text-sm text-text-muted">
              {(tokenUsage.tokensUsed / 1000).toFixed(1)}k / {(tokenUsage.tokenQuota / 1000).toFixed(0)}k
            </span>
            <span className={`text-xs font-medium ${tokenUsage.percentUsed >= 90 ? 'text-red-400' : tokenUsage.percentUsed >= 70 ? 'text-amber-400' : 'text-text-dim'}`}>
              {tokenUsage.percentUsed}%
            </span>
          </div>
          <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${tokenUsage.percentUsed >= 90 ? 'bg-red-400' : tokenUsage.percentUsed >= 70 ? 'bg-amber-400' : 'bg-accent'}`}
              style={{ width: `${Math.min(tokenUsage.percentUsed, 100)}%` }}
            />
          </div>
          <p className="text-xs text-text-dim mt-2">
            Reset: {new Date(tokenUsage.quotaResetAt).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
          </p>
        </>
      )}
    </div>
  );
}
