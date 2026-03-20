'use client';

import { useState, useCallback } from 'react';

export type Domain = 'discrete' | 'process' | 'pharma' | 'automotive';

const DOMAINS: Array<{ id: Domain; name: string; description: string; standard: string; ready: boolean }> = [
  { id: 'discrete',    name: 'Discrete Manufacturing',  description: 'CNC, assembly, injection molding — Factory Sim v3',  standard: 'ISA-95 / CESMII',   ready: true },
  { id: 'pharma',      name: 'Pharma / Bioprocess',     description: 'Batch processes, GMP, recipes, test results',       standard: 'ISA-88 / GMP',      ready: false },
  { id: 'process',     name: 'Chemical / Process',      description: 'Reactors, charges, continuous + batch',             standard: 'ISA-88/95 / MTP',   ready: false },
  { id: 'automotive',  name: 'Automotive',              description: 'Assembly stations, VIN tracing, torque data',       standard: 'VDA / IATF 16949',  ready: false },
];

interface Props {
  className?: string;
  onSelect?: (domain: Domain) => void;
  selected?: Domain;
}

export default function DomainSelector({ className, onSelect, selected: controlled }: Props) {
  const [internal, setInternal] = useState<Domain>('discrete');
  const selected = controlled ?? internal;

  const handleSelect = useCallback((d: Domain) => {
    setInternal(d);
    onSelect?.(d);
  }, [onSelect]);

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Industry Domain</h2>
      <div className="grid grid-cols-2 gap-2">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            onClick={() => handleSelect(d.id)}
            disabled={!d.ready}
            className={`card text-left transition-all ${
              selected === d.id
                ? 'border-emerald-500/50 shadow-md shadow-emerald-500/10'
                : d.ready ? 'hover:border-[var(--border-active)]' : 'opacity-40 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="font-semibold text-sm text-[var(--text)]">{d.name}</div>
              {!d.ready && <span className="text-[10px] text-[var(--text-dim)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded">coming soon</span>}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">{d.description}</div>
            <div className="text-xs text-emerald-400 mt-2 font-mono">{d.standard}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
