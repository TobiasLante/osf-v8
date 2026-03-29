"use client";

import { useState } from "react";

const MOLECULE_TYPES = ["mAb", "AAV", "ADC", "mRNA", "Lentivirus", "pDNA"];
const PRODUCTION_SCALES = ["50L", "200L", "500L", "1000L", "2000L", "Platform Scale"];

interface Props {
  onAnalyze: (prompt: string) => void;
  className?: string;
}

export function NewAccountForm({ onAnalyze, className = "" }: Props) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [molecule, setMolecule] = useState(MOLECULE_TYPES[0]);
  const [scale, setScale] = useState(PRODUCTION_SCALES[0]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const prompt = `New account analysis:
- Customer: ${name.trim()}
- Location: ${location.trim() || "N/A"}
- Molecule: ${molecule}
- Scale: ${scale}

Please:
1. Show the complete process map for this modality using pharma_process_map
2. Identify which unit operations our company covers using pharma_vendor_coverage
3. Highlight the key sales opportunities (OPEN and NO_CONTACT areas)
4. Suggest talking points for the first meeting`;

    onAnalyze(prompt);
  }

  return (
    <form onSubmit={handleSubmit} className={`rounded-lg border border-p1-border bg-slate-800/50 p-4 ${className}`}>
      <h3 className="text-xs font-semibold text-p1-muted uppercase tracking-wider mb-3">New Account</h3>

      <div className="flex flex-col gap-2.5">
        <input
          type="text"
          placeholder="Customer Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-700 px-3 py-1.5 text-sm text-p1-text placeholder-p1-dim focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
        />
        <input
          type="text"
          placeholder="Site Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-700 px-3 py-1.5 text-sm text-p1-text placeholder-p1-dim focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={molecule}
            onChange={(e) => setMolecule(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-700 px-3 py-1.5 text-sm text-p1-text focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          >
            {MOLECULE_TYPES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-700 px-3 py-1.5 text-sm text-p1-text focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          >
            {PRODUCTION_SCALES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-1.5 text-sm font-medium text-white hover:from-cyan-500 hover:to-cyan-400 transition-all disabled:opacity-40"
          disabled={!name.trim()}
        >
          Analyze Account
        </button>
      </div>
    </form>
  );
}
