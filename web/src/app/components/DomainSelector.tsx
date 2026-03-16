'use client';

import { useState, useCallback } from 'react';

export type Domain = 'manufacturing' | 'pharma' | 'chemical' | 'medtech';

interface DomainInfo {
  id: Domain;
  icon: string;
  name: string;
  description: string;
  standard: string;
}

const DOMAINS: DomainInfo[] = [
  {
    id: 'manufacturing',
    icon: '\u2699\uFE0F',
    name: 'Manufacturing',
    description: 'Discrete manufacturing, CNC, assembly',
    standard: 'ISA-95 / CESMII',
  },
  {
    id: 'pharma',
    icon: '\uD83D\uDC8A',
    name: 'Pharma',
    description: 'Batch processes, GMP compliance',
    standard: 'ISA-88 / MTP',
  },
  {
    id: 'chemical',
    icon: '\u2697\uFE0F',
    name: 'Chemical',
    description: 'Continuous & batch, reactors, columns',
    standard: 'ISA-88/95 / MTP',
  },
  {
    id: 'medtech',
    icon: '\uD83E\uDE7A',
    name: 'Medtech',
    description: 'Device traceability, UDI, clean room',
    standard: 'MDR / ISO 13485',
  },
];

interface DomainSelectorProps {
  className?: string;
  onSelect?: (domain: Domain) => void;
  selected?: Domain;
}

export default function DomainSelector({
  className,
  onSelect,
  selected: controlledSelected,
}: DomainSelectorProps) {
  const [internalSelected, setInternalSelected] = useState<Domain>('manufacturing');
  const selected = controlledSelected ?? internalSelected;

  const handleSelect = useCallback(
    (domain: Domain) => {
      setInternalSelected(domain);
      onSelect?.(domain);
    },
    [onSelect],
  );

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        Industry Domain
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {DOMAINS.map((d) => {
          const isActive = selected === d.id;
          return (
            <button
              key={d.id}
              onClick={() => handleSelect(d.id)}
              className={`
                rounded-lg border-2 p-4 text-left transition-all
                bg-white dark:bg-gray-900
                ${
                  isActive
                    ? 'border-emerald-500 shadow-md shadow-emerald-500/10'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                }
              `}
            >
              <div className="text-2xl mb-2">{d.icon}</div>
              <div className="font-semibold text-sm text-[var(--text)]">{d.name}</div>
              <div className="text-xs text-[var(--muted)] mt-1">{d.description}</div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 font-mono">
                {d.standard}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
