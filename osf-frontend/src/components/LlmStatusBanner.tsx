'use client';

interface LlmStatusBannerProps {
  status: {
    online: boolean;
    servers?: Array<{ name: string; active: number; queued: number }>;
    message?: string;
  } | null;
  quotaPercent?: number;
}

export default function LlmStatusBanner({ status, quotaPercent }: LlmStatusBannerProps) {
  if (!status) return null;

  // Quota warning (>90%)
  if (quotaPercent !== undefined && quotaPercent >= 100) {
    return (
      <div className="border border-red-500/30 rounded-md p-3 bg-red-500/10 mb-4">
        <p className="text-red-400 text-sm">
          Token limit reached. Your monthly quota has been used up.
        </p>
      </div>
    );
  }

  if (quotaPercent !== undefined && quotaPercent >= 90) {
    return (
      <div className="border border-amber-500/30 rounded-md p-3 bg-amber-500/10 mb-4">
        <p className="text-amber-400 text-sm">
          You have already used {quotaPercent}% of your monthly token quota.
        </p>
      </div>
    );
  }

  // LLM offline
  if (!status.online) {
    return (
      <div className="border border-amber-500/30 rounded-md p-3 bg-amber-500/10 mb-4">
        <p className="text-amber-400 text-sm">
          {status.message || 'The LLM server is currently offline.'}
        </p>
      </div>
    );
  }

  // LLM busy (queued requests)
  const totalQueued = (status.servers || []).reduce((sum, s) => sum + s.queued, 0);
  if (totalQueued > 0) {
    return (
      <div className="border border-blue-500/20 rounded-md p-3 bg-blue-500/5 mb-4">
        <p className="text-blue-400 text-sm">
          LLM busy ({totalQueued} {totalQueued === 1 ? 'request' : 'requests'} in queue) — your request is waiting...
        </p>
      </div>
    );
  }

  return null;
}
