'use client';

import { useState, useCallback } from 'react';

export interface DataSourcesConfig {
  mtpUrls: string[];
  i3xEndpoints: string[];
  smProfileUrl: string;
}

interface Props {
  className?: string;
  onChange?: (config: DataSourcesConfig) => void;
}

export default function DataSources({ className, onChange }: Props) {
  const [mtpUrls, setMtpUrls] = useState<string[]>([]);
  const [i3xEndpoints, setI3xEndpoints] = useState<string[]>([]);
  const [smProfileUrl, setSmProfileUrl] = useState('');

  const emit = useCallback((mtp: string[], i3x: string[], sm: string) => {
    onChange?.({ mtpUrls: mtp, i3xEndpoints: i3x, smProfileUrl: sm });
  }, [onChange]);

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Data Sources</h2>
      <div className="space-y-3">
        <div className="card">
          <h3 className="text-sm font-medium text-[var(--text)] mb-1">MCP Servers</h3>
          <p className="text-xs text-[var(--text-muted)]">Auto-discovered from gateway proxy. No configuration needed.</p>
        </div>

        <Collapsible title="MTP Modules (AutomationML)">
          <UrlList urls={mtpUrls} placeholder="https://example.com/module.mtp" onAdd={(u) => { const next = [...mtpUrls, u]; setMtpUrls(next); emit(next, i3xEndpoints, smProfileUrl); }} onRemove={(i) => { const next = mtpUrls.filter((_, idx) => idx !== i); setMtpUrls(next); emit(next, i3xEndpoints, smProfileUrl); }} />
        </Collapsible>

        <Collapsible title="i3X Endpoints (CESMII)">
          <UrlList urls={i3xEndpoints} placeholder="https://i3x.example.com/api" onAdd={(u) => { const next = [...i3xEndpoints, u]; setI3xEndpoints(next); emit(mtpUrls, next, smProfileUrl); }} onRemove={(i) => { const next = i3xEndpoints.filter((_, idx) => idx !== i); setI3xEndpoints(next); emit(mtpUrls, next, smProfileUrl); }} />
        </Collapsible>

        <Collapsible title="SM Profile (OPC-UA XML)">
          <input type="text" value={smProfileUrl} onChange={(e) => { setSmProfileUrl(e.target.value); emit(mtpUrls, i3xEndpoints, e.target.value); }} placeholder="https://example.com/sm-profile.xml" className="input" />
        </Collapsible>
      </div>
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card !p-0 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors">
        <span>{title}</span>
        <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">{children}</div>}
    </div>
  );
}

function UrlList({ urls, placeholder, onAdd, onRemove }: { urls: string[]; placeholder: string; onAdd: (u: string) => void; onRemove: (i: number) => void }) {
  const [input, setInput] = useState('');
  const add = () => { if (input.trim()) { onAdd(input.trim()); setInput(''); } };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={placeholder} className="input flex-1" />
        <button onClick={add} className="btn-primary">Add</button>
      </div>
      {urls.map((url, i) => (
        <div key={i} className="flex items-center justify-between rounded-md bg-[var(--surface-3)] px-3 py-1.5 text-xs font-mono text-[var(--text-muted)]">
          <span className="truncate mr-2">{url}</span>
          <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-300">&times;</button>
        </div>
      ))}
    </div>
  );
}
