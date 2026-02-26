'use client';

import { safeMarkdown } from '@/lib/markdown';
import { mdClasses } from './types';

export function SynthesisCard({ data }: { data: any }) {
  if (!data) return null;

  const priorityBadge = (p: string) => {
    switch (p) {
      case 'sofort': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'heute': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'diese_woche': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default: return 'bg-bg-surface-2 text-text-dim border-border';
    }
  };

  let synthesis: any = null;
  if (typeof data === 'string') {
    try { synthesis = JSON.parse(data); } catch { /* render as markdown */ }
  } else {
    synthesis = data;
  }

  // Markdown fallback
  if (!synthesis || typeof synthesis === 'string') {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className={`text-sm text-text-muted leading-relaxed ${mdClasses}`}
          dangerouslySetInnerHTML={{ __html: safeMarkdown(text) }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {synthesis.executiveSummary && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
            {'\u{1F4CA}'} Executive Summary
          </p>
          <div className={`text-sm text-text-muted leading-relaxed ${mdClasses}`}
            dangerouslySetInnerHTML={{ __html: safeMarkdown(synthesis.executiveSummary) }}
          />
        </div>
      )}

      {Array.isArray(synthesis.crossDomainCorrelations) && synthesis.crossDomainCorrelations.length > 0 && (
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-4">
          <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-2">
            {'\u{1F517}'} Cross-Domain Correlations
          </p>
          <ul className="text-sm text-text-muted space-y-1 pl-4 list-disc">
            {synthesis.crossDomainCorrelations.map((c: any, i: number) => (
              <li key={i}>{typeof c === 'string' ? c : c.correlation || JSON.stringify(c)}</li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(synthesis.actionPlan) && synthesis.actionPlan.length > 0 && (
        <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
            {'\u{1F4DD}'} Action Plan
          </p>
          <div className="space-y-1.5">
            {synthesis.actionPlan.map((a: any, i: number) => (
              <div key={i} className="flex gap-2 items-start text-sm">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${priorityBadge(a.priorität || a.priority || '')}`}>
                  {(a.priorität || a.priority || 'tbd').toUpperCase()}
                </span>
                <span className="text-text-muted">
                  <strong className="text-text">{a.action || a.maßnahme || a.title}</strong>
                  {a.responsible && <span className="text-text-dim"> — {a.responsible}</span>}
                  {a.deadline && <span className="text-text-dim"> (by {a.deadline})</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(synthesis.riskAssessment || synthesis.risks) && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
            {'\u26A0\uFE0F'} Risk Assessment
          </p>
          {typeof (synthesis.riskAssessment || synthesis.risks) === 'string' ? (
            <p className="text-sm text-text-muted">{synthesis.riskAssessment || synthesis.risks}</p>
          ) : Array.isArray(synthesis.risks) ? (
            <ul className="text-sm text-text-muted space-y-1 pl-4 list-disc">
              {synthesis.risks.map((r: any, i: number) => (
                <li key={i}>{typeof r === 'string' ? r : r.risk || JSON.stringify(r)}</li>
              ))}
            </ul>
          ) : (
            <div className={`text-sm text-text-muted ${mdClasses}`}
              dangerouslySetInnerHTML={{ __html: safeMarkdown(JSON.stringify(synthesis.riskAssessment, null, 2)) }}
            />
          )}
        </div>
      )}
    </div>
  );
}
