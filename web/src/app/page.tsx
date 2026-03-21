'use client';

import { useState } from 'react';
import DomainSelector from './components/DomainSelector';
import type { Domain } from './components/DomainSelector';
import DataSources from './components/DataSources';
import PipelineRunner from './components/PipelineRunner';
import GraphExplorer from './components/GraphExplorer';

export default function Home() {
  const [domain, setDomain] = useState<Domain>('manufacturing');
  const [lastRunId, setLastRunId] = useState<string | undefined>();

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DomainSelector selected={domain} onSelect={setDomain} />
        <DataSources className="lg:col-span-2" />
      </div>
      <PipelineRunner domain={domain} onRunComplete={setLastRunId} />
      <GraphExplorer runId={lastRunId} />
    </div>
  );
}
