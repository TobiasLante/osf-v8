'use client';

import { useState } from 'react';
import DomainSelector, { type Domain } from '@/components/DomainSelector';
import DataSources from '@/components/DataSources';
import PipelineRunner from '@/components/PipelineRunner';
import GraphExplorer from '@/components/GraphExplorer';

export default function BuildPage() {
  const [domain, setDomain] = useState<Domain>('discrete');
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Build Pipeline</h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          Configure domain, connect data sources, and build your Knowledge Graph.
        </p>
      </div>

      {/* Config Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DomainSelector selected={domain} onSelect={setDomain} />
        <DataSources className="lg:col-span-2" />
      </div>

      {/* Pipeline */}
      <PipelineRunner
        domain={domain}
        onRunComplete={(id) => setCompletedRunId(id)}
      />

      {/* Graph Explorer (after build) */}
      {completedRunId && (
        <GraphExplorer runId={completedRunId} />
      )}
    </div>
  );
}
