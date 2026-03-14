'use client';

import { useEffect, useRef } from 'react';
import { V7Event } from './types';

export function DiscussionThread({ events }: { events: V7Event[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events.length]);

  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-sm font-bold text-violet-400 uppercase tracking-widest flex-1">
          Live Discussion
        </span>
        <span className="text-xs text-white/40">{events.length} events</span>
      </div>

      <div ref={scrollRef} className="flex flex-col gap-2.5 px-4 pb-4 border-t border-violet-500/10 pt-3 max-h-[60vh] overflow-y-auto scroll-smooth">
        {events.map((ev, i) => {
          switch (ev.type) {
            case 'discussion_round_start':
              return (
                <div key={i} className="flex items-center gap-2 pt-3 pb-1 border-t border-dashed border-white/10 first:border-t-0 first:pt-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  <span className="text-xs font-bold text-white/60 uppercase tracking-wider">
                    Round {ev.discussionRound || '?'}
                  </span>
                </div>
              );

            case 'discussion_question':
              return (
                <div key={i} className="self-start max-w-[90%] rounded-lg px-4 py-3 bg-violet-500/[0.1] border border-violet-500/25 border-l-[4px] border-l-violet-400 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-violet-400 uppercase tracking-wider mb-1.5">
                    Moderator &rarr; {ev.targetSpecialist || '?'}
                  </div>
                  <div className="text-sm text-white/80 leading-relaxed">{ev.moderatorQuestion || ''}</div>
                </div>
              );

            case 'discussion_answer':
              return (
                <div key={i} className="self-end max-w-[90%] rounded-lg px-4 py-3 bg-blue-500/[0.1] border border-blue-500/25 border-r-[4px] border-r-blue-400 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider mb-1.5">
                    {ev.targetSpecialist || '?'}
                  </div>
                  <div className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{ev.discussionAnswer || ''}</div>
                </div>
              );

            case 'discussion_recruit':
              return (
                <div key={i} className="self-center text-xs font-bold px-4 py-2 bg-cyan-500/10 border border-cyan-500/25 rounded-full text-cyan-400 animate-[fadeIn_0.3s_ease]">
                  + {ev.recruitedSpecialistName || 'Specialist'} joining...
                </div>
              );

            case 'discussion_recruit_result':
              return (
                <div key={i} className="self-start max-w-[90%] rounded-lg px-4 py-3 bg-cyan-500/[0.08] border border-cyan-500/25 border-l-[4px] border-l-cyan-400 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider mb-1.5">
                    {ev.recruitedSpecialistName || 'Specialist'} — Analysis
                  </div>
                  <div className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{ev.recruitedSpecialistReport || 'Analysis complete'}</div>
                </div>
              );

            case 'discussion_synthesis_start':
              return (
                <div key={i} className="self-center text-sm font-bold px-5 py-2 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-400 animate-pulse">
                  Moderator drafting synthesis...
                </div>
              );

            case 'debate_start':
              return (
                <div key={i} className="self-center text-sm font-bold px-5 py-2 rounded-full text-violet-300"
                  style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(245,158,11,0.15))', border: '1px solid rgba(139,92,246,0.3)' }}>
                  Specialist Debate
                </div>
              );

            case 'debate_draft':
              return (
                <div key={i} className="max-w-[95%] rounded-lg px-4 py-3 bg-amber-500/[0.1] border border-amber-500/25 border-l-[4px] border-l-amber-400 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">
                    Moderator — Draft Recommendation
                  </div>
                  <div className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{ev.debateDraftSummary || 'Draft created'}</div>
                </div>
              );

            case 'debate_critique':
              return (
                <div key={i} className="self-end max-w-[90%] rounded-lg px-4 py-3 bg-white/[0.05] border border-white/10 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-white/90 uppercase tracking-wider mb-2">
                    {ev.debateCritiqueFrom || 'Specialist'} — Feedback
                  </div>
                  {Array.isArray(ev.debateCritiqueItems) && ev.debateCritiqueItems.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
                      {ev.debateCritiqueItems.map((item, j) => {
                        const isConfirm = item.type === 'confirm';
                        const isCritic = item.type === 'critic';
                        return (
                          <div key={j} className={`text-sm leading-relaxed px-3 py-2 rounded-md border-l-[4px] ${
                            isConfirm ? 'bg-emerald-500/10 text-emerald-300 border-l-emerald-400'
                            : isCritic ? 'bg-red-500/10 text-red-300 border-l-red-400'
                            : 'bg-blue-500/10 text-blue-300 border-l-blue-400'
                          }`}>
                            <span className="font-bold mr-1.5">{isConfirm ? '\u2713' : isCritic ? '\u2717' : '+'}</span>
                            {item.text}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {ev.debateCritiqueAssessment && (
                    <div className={`text-sm font-semibold mt-2.5 px-3 py-2 rounded-md ${
                      (ev.debateCritiqueAssessment.includes('gut') || ev.debateCritiqueAssessment.includes('good')) ? 'bg-emerald-500/15 text-emerald-300'
                      : (ev.debateCritiqueAssessment.includes('problematisch') || ev.debateCritiqueAssessment.includes('problematic')) ? 'bg-red-500/15 text-red-300'
                      : 'bg-blue-500/15 text-blue-300'
                    }`}>
                      {ev.debateCritiqueAssessment}
                    </div>
                  )}
                </div>
              );

            case 'debate_final':
              return (
                <div key={i} className="max-w-[95%] rounded-lg px-4 py-3 bg-emerald-500/[0.12] border-2 border-emerald-500/30 border-l-[4px] border-l-emerald-400 animate-[fadeIn_0.3s_ease]">
                  <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Final Recommendation
                  </div>
                  <div className="text-sm text-white/90 leading-relaxed whitespace-pre-line">{ev.debateFinalSummary || 'Final plan created'}</div>
                </div>
              );

            case 'specialists_batch_complete':
              if (!Array.isArray(ev.specialistResults) || ev.specialistResults.length === 0) return null;
              return (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2 pt-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Specialist Reports</span>
                  </div>
                  {ev.specialistResults.map((sr, j) => {
                    const displayName = sr.domain || sr.name || '?';
                    const summary = sr.report?.zahlenDatenFakten
                      ? String(sr.report.zahlenDatenFakten).substring(0, 250)
                      : (sr.error ? String(sr.error).substring(0, 120) : 'No analysis');
                    return (
                      <div key={j} className={`max-w-[90%] rounded-lg px-4 py-3 border-r-[4px] animate-[fadeIn_0.3s_ease] ${
                        sr.status === 'error'
                          ? 'bg-red-500/[0.08] border border-red-500/20 border-r-red-400 self-end'
                          : 'bg-blue-500/[0.08] border border-blue-500/20 border-r-blue-400 self-end'
                      }`}>
                        <div className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${
                          sr.status === 'error' ? 'text-red-400' : 'text-blue-400'
                        }`}>
                          {sr.status === 'error' ? '\u274C' : '\u2713'} {displayName}
                        </div>
                        <div className="text-sm text-white/70">{summary}</div>
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
    </div>
  );
}
