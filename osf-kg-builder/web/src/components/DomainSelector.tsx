'use client';

import { useState, useCallback } from 'react';

export type Domain = 'manufacturing' | 'pharma' | 'chemical' | 'medtech';

const DOMAINS: Array<{ id: Domain; name: string; description: string; standard: string }> = [
  { id: 'manufacturing', name: 'Manufacturing',  description: 'Discrete manufacturing, CNC, assembly',         standard: 'ISA-95 / CESMII' },
  { id: 'pharma',        name: 'Pharma',         description: 'Batch processes, GMP, bioprocessing',           standard: 'ISA-88 / MTP' },
  { id: 'chemical',      name: 'Chemical',       description: 'Continuous & batch, reactors, columns',         standard: 'ISA-88/95 / MTP' },
  { id: 'medtech',       name: 'Medtech',        description: 'Device traceability, UDI, clean room',          standard: 'MDR / ISO 13485' },
];

interface Props {
  className?: string;
  onSelect?: (domain: Domain) => void;
  selected?: Domain;
}

export default function DomainSelector({ className, onSelect, selected: controlled }: Props) {
  const [internal, setInternal] = useState<Domain>('manufacturing');
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
            className={`card text-left transition-all ${
              selected === d.id
                ? 'border-emerald-500/50 shadow-md shadow-emerald-500/10'
                : 'hover:border-[var(--border-active)]'
            }`}
          >
            <div className="font-semibold text-sm text-[var(--text)]">{d.name}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">{d.description}</div>
            <div className="text-xs text-emerald-400 mt-2 font-mono">{d.standard}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
