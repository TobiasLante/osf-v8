'use client';

import { useState } from 'react';
import { V7Event } from './types';

export function DiscussionThread({ events }: { events: V7Event[] }) {
  const [expanded, setExpanded] = useState(true);
  if (events.length === 0) return null;

  return (
    <div className="rounded-md border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider flex-1">
          Discussion & Debate
        </span>
        <span className="text-xs text-text-dim">{events.length} messages</span>
        <svg className={`w-3.5 h-3.5 text-text-dim transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="flex flex-col gap-1.5 px-3 pb-3 border-t border-violet-500/10 pt-2 max-h-[50vh] overflow-y-auto">
          {events.map((ev, i) => {
            switch (ev.type) {
              case 'discussion_round_start':
                return (
                  <div key={i} className="text-[10px] font-bold text-text-muted uppercase tracking-wider pt-2 pb-0.5 border-t border-dashed border-border/50 first:border-t-0 first:pt-0">
                    Round {ev.discussionRound || '?'}
                  </div>
                );

              case 'discussion_question':
                return (
                  <div key={i} className="self-start max-w-[88%] rounded-md px-3 py-2 text-xs leading-relaxed bg-violet-500/[0.08] border border-violet-500/20 border-l-[3px] border-l-violet-400 animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1">
                      Moderator &rarr; {ev.targetSpecialist || '?'}
                    </div>
                    <div className="text-text-muted">{ev.moderatorQuestion || ''}</div>
                  </div>
                );

              case 'discussion_answer':
                return (
                  <div key={i} className="self-end max-w-[88%] rounded-md px-3 py-2 text-xs leading-relaxed bg-emerald-500/[0.08] border border-emerald-500/20 border-r-[3px] border-r-emerald-400 animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                      {ev.targetSpecialist || '?'}
                    </div>
                    <div className="text-text-muted whitespace-pre-line">{ev.discussionAnswer || ''}</div>
                  </div>
                );

              case 'discussion_recruit':
                return (
                  <div key={i} className="self-center text-[10px] font-bold px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-accent animate-[fadeIn_0.3s_ease]">
                    + {ev.recruitedSpecialistName || 'Specialist'} joining...
                  </div>
                );

              case 'discussion_recruit_result':
                return (
                  <div key={i} className="self-start max-w-[88%] rounded-md px-3 py-2 text-xs leading-relaxed bg-accent/[0.08] border border-accent/25 border-l-[3px] border-l-accent animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1">
                      {'\u{1F4CB}'} {ev.recruitedSpecialistName || 'Specialist'} — Analysis
                    </div>
                    <div className="text-text-muted whitespace-pre-line text-[11px]">{ev.recruitedSpecialistReport || 'Analysis complete'}</div>
                  </div>
                );

              case 'discussion_synthesis_start':
                return (
                  <div key={i} className="self-center text-[11px] font-bold px-3.5 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 animate-pulse">
                    Moderator drafting summary...
                  </div>
                );

              case 'debate_start':
                return (
                  <div key={i} className="self-center text-[11px] font-bold px-3.5 py-1.5 rounded-full text-violet-400 animate-[fadeIn_0.3s_ease]"
                    style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(245,158,11,0.12))', border: '1px solid rgba(139,92,246,0.25)' }}>
                    {'\u2694\uFE0F'} Specialist Debate
                  </div>
                );

              case 'debate_draft':
                return (
                  <div key={i} className="self-center max-w-[95%] rounded-md px-3 py-2 text-xs leading-relaxed bg-amber-500/[0.08] border border-amber-500/25 border-l-[3px] border-l-amber-400 animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                      Moderator — Draft
                    </div>
                    <div className="text-text-muted whitespace-pre-line">{ev.debateDraftSummary || 'Draft created'}</div>
                  </div>
                );

              case 'debate_critique':
                return (
                  <div key={i} className="self-end max-w-[88%] rounded-md px-3 py-2 text-xs leading-relaxed bg-bg-surface border border-border/40 border-r-[3px] border-r-text-dim animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-text uppercase tracking-wider mb-1.5">
                      {ev.debateCritiqueFrom || 'Specialist'} — Feedback
                    </div>
                    {Array.isArray(ev.debateCritiqueItems) && ev.debateCritiqueItems.length > 0 && (
                      <div className="flex flex-col gap-1.5 mt-1">
                        {ev.debateCritiqueItems.map((item, j) => {
                          const icon = item.type === 'confirm' ? '\u2713' : item.type === 'critic' ? '\u2717' : '+';
                          const cls = item.type === 'confirm'
                            ? 'bg-emerald-500/10 text-emerald-400 border-l-emerald-400'
                            : item.type === 'critic'
                            ? 'bg-red-500/10 text-red-400 border-l-red-400'
                            : 'bg-blue-500/10 text-blue-400 border-l-blue-400';
                          return (
                            <div key={j} className={`text-xs leading-relaxed px-2 py-1 rounded border-l-[3px] ${cls}`}>
                              <span className="font-bold mr-1">{icon}</span> {item.text}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {ev.debateCritiqueAssessment && (
                      <div className={`text-[11px] font-semibold mt-2 px-2 py-1 rounded ${
                        (ev.debateCritiqueAssessment.includes('gut') || ev.debateCritiqueAssessment.includes('good')) ? 'bg-emerald-500/10 text-emerald-400'
                        : (ev.debateCritiqueAssessment.includes('problematisch') || ev.debateCritiqueAssessment.includes('problematic')) ? 'bg-red-500/10 text-red-400'
                        : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        Assessment: {ev.debateCritiqueAssessment}
                      </div>
                    )}
                  </div>
                );

              case 'debate_final':
                return (
                  <div key={i} className="self-center max-w-[95%] rounded-md px-3 py-2 text-xs leading-relaxed bg-emerald-500/10 border border-emerald-500/30 border-l-[3px] border-l-emerald-400 animate-[fadeIn_0.3s_ease]">
                    <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                      {'\u{1F3C6}'} Final Plan (post-debate)
                    </div>
                    <div className="text-text-muted whitespace-pre-line">{ev.debateFinalSummary || 'Final plan created'}</div>
                  </div>
                );

              case 'specialists_batch_complete':
                if (!Array.isArray(ev.specialistResults) || ev.specialistResults.length === 0) return null;
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider pt-1">
                      Round 1: Specialist Analysis
                    </div>
                    {ev.specialistResults.map((sr, j) => {
                      const displayName = sr.domain || sr.name || '?';
                      const status = sr.status === 'error' ? '\u274C Error' : (sr.report ? '\u2713' : '\u26A0 No data');
                      const summary = sr.report?.zahlenDatenFakten
                        ? String(sr.report.zahlenDatenFakten).substring(0, 200)
                        : (sr.error ? String(sr.error).substring(0, 100) : 'No analysis');
                      return (
                        <div key={j} className="self-end max-w-[88%] rounded-md px-3 py-2 text-xs leading-relaxed bg-emerald-500/[0.08] border border-emerald-500/20 border-r-[3px] border-r-emerald-400">
                          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5">
                            {status} {displayName}
                          </div>
                          <div className="text-text-dim text-[11px]">{summary}</div>
                        </div>
                      );
                    })}
                  </div>
                );

              default:
                return null;
            }
          })}
        </div>
      )}
    </div>
  );
}
