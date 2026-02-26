'use client';

import { useState } from 'react';

export function SpecialistCard({ report, status, name, duration }: {
  report: any;
  status: 'pending' | 'running' | 'done' | 'error';
  name: string;
  duration?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = status === 'running' ? 'border-violet-500/40 bg-violet-500/5'
    : status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5'
    : status === 'error' ? 'border-red-500/30 bg-red-500/5'
    : 'border-border bg-bg-surface';

  const severityColor = (s: string) => {
    switch (s) {
      case 'hoch': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'mittel': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'niedrig': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      default: return 'text-text-dim bg-bg-surface-2 border-border';
    }
  };

  const priorityIcon = (p: string) => {
    switch (p) {
      case 'sofort': return '\u{1F534}';
      case 'heute': return '\u{1F7E0}';
      case 'diese_woche': return '\u{1F7E2}';
      default: return '\u26AA';
    }
  };

  return (
    <div className={`rounded-md border ${statusColor} transition-all overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        {status === 'running' && <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse flex-shrink-0" />}
        {status === 'done' && <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 flex-shrink-0" />}
        {status === 'error' && <span className="w-2.5 h-2.5 rounded-full bg-red-400 flex-shrink-0" />}
        {status === 'pending' && <span className="w-2.5 h-2.5 rounded-full bg-text-dim flex-shrink-0" />}
        <span className="font-semibold text-sm flex-1">{name}</span>
        {duration != null && (
          <span className="text-xs text-text-dim">{(duration / 1000).toFixed(1)}s</span>
        )}
        <svg className={`w-4 h-4 text-text-dim transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && report && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50">
          {report.zahlenDatenFakten && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">Key Figures</p>
              <p className="text-sm text-text-muted whitespace-pre-line">
                {typeof report.zahlenDatenFakten === 'string'
                  ? report.zahlenDatenFakten
                  : JSON.stringify(report.zahlenDatenFakten, null, 2)}
              </p>
            </div>
          )}

          {Array.isArray(report.kritischeFindings) && report.kritischeFindings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1.5">Critical Findings</p>
              <div className="space-y-1.5">
                {report.kritischeFindings.map((f: any, i: number) => (
                  <div key={i} className="flex gap-2 items-start">
                    {f.severity && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${severityColor(String(f.severity))}`}>
                        {String(f.severity).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm text-text-muted">{typeof f === 'string' ? f : f.finding || JSON.stringify(f)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(report.empfehlungen) && report.empfehlungen.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1.5">Recommendations</p>
              <div className="space-y-1">
                {report.empfehlungen.map((e: any, i: number) => (
                  <div key={i} className="flex gap-2 items-start text-sm text-text-muted">
                    <span className="flex-shrink-0">{priorityIcon(String(e.priorität || e.priority || ''))}</span>
                    <span>
                      {typeof e === 'string' ? e : (
                        <>
                          <strong className="text-text">{e.maßnahme || e.action || JSON.stringify(e)}</strong>
                          {e.erwarteteWirkung && <span className="text-text-dim"> — {String(e.erwarteteWirkung)}</span>}
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(report.crossDomainHinweise) && report.crossDomainHinweise.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-1">Cross-Domain</p>
              <ul className="text-sm text-text-muted space-y-0.5 pl-4 list-disc">
                {report.crossDomainHinweise.map((h: any, i: number) => <li key={i}>{typeof h === 'string' ? h : JSON.stringify(h)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
