'use client';

import { useRef, useEffect } from 'react';
import { V7StreamOutputProps, V7Event, eventColor, eventIcon } from './chat/v7/types';
import { useV7Events } from './chat/v7/useV7Events';
import { SpecialistCard } from './chat/v7/SpecialistCard';
import { PlanStepper } from './chat/v7/PlanStepper';
import { DiscussionThread } from './chat/v7/DiscussionThread';
import { SynthesisCard } from './chat/v7/SynthesisCard';
import { ReportCard } from './chat/v7/ReportCard';
import { StatusPhase } from './chat/v7/StatusPhase';

export type { V7Event, V7StreamOutputProps };

export function V7StreamOutput({ events, running, maxHeight = '600px', reportUrl, reportOutput }: V7StreamOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const { currentPlan, specialists, doneEvent, doneResult, discussionEvents, bubbles } = useV7Events(events);

  return (
    <div ref={scrollRef} className="overflow-y-auto space-y-2 text-sm" style={{ maxHeight }}>
      {/* Status phase indicator */}
      <StatusPhase events={events} running={running} />

      {/* Plan stepper */}
      {currentPlan && <PlanStepper plan={currentPlan} />}

      {/* Specialist cards grid */}
      {specialists.size > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Array.from(specialists.entries()).map(([key, spec]) => (
            <SpecialistCard
              key={key}
              name={spec.name}
              status={spec.status as any}
              report={spec.report}
              duration={spec.duration}
            />
          ))}
        </div>
      )}

      {/* Discussion & Debate Thread */}
      {discussionEvents.length > 0 && (
        <DiscussionThread events={discussionEvents} />
      )}

      {/* Event bubbles (tool calls, init, steps, etc.) */}
      {bubbles.map(({ key, event: ev }) => {
        const color = eventColor(ev.type);
        const icon = eventIcon(ev.type);

        if (ev.type === 'tool_call_start') {
          return (
            <div key={key} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${color.bg} border ${color.border}`}>
              <span>{icon}</span>
              <span className={`font-mono ${color.text}`}>{ev.toolName}</span>
              {ev.params && Object.keys(ev.params).length > 0 && (
                <span className="text-text-dim truncate max-w-[200px]">
                  {Object.entries(ev.params).map(([k, v]) => `${k}=${v}`).join(', ')}
                </span>
              )}
            </div>
          );
        }
        if (ev.type === 'tool_call_end') return null;

        if (ev.type === 'thinking') {
          return (
            <div key={key} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${color.bg} border ${color.border}`}>
              <span>{icon}</span>
              <span className={color.text}>{ev.message}</span>
            </div>
          );
        }

        if (ev.type === 'step_start' || ev.type === 'step_complete' || ev.type === 'step_error') {
          return null;
        }

        if (ev.type === 'intermediate_result') {
          return (
            <div key={key}>
              {ev.title && (
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1.5 px-1">
                  {'\u{1F4CA}'} {ev.title}
                </p>
              )}
              <SynthesisCard data={ev.data} />
            </div>
          );
        }

        if (ev.type === 'done') {
          return (
            <div key={key} className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-medium text-sm">{ev.message || 'Completed'}</span>
              {ev.duration != null && (
                <span className="text-xs text-text-dim ml-auto">{(ev.duration / 1000).toFixed(0)}s</span>
              )}
            </div>
          );
        }

        if (ev.type === 'specialists_batch_start') {
          return (
            <div key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${color.bg} border ${color.border}`}>
              <span>{icon}</span>
              <span className={`font-medium ${color.text}`}>{ev.message || ev.type.replace(/_/g, ' ')}</span>
            </div>
          );
        }

        return (
          <div key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${color.bg} border ${color.border}`}>
            <span>{icon}</span>
            <span className={color.text}>{ev.message || ev.type}</span>
          </div>
        );
      })}

      {/* Synthesis from final result */}
      {doneResult && doneEvent && <SynthesisCard data={doneResult} />}

      {/* Report card (from POST result) */}
      {doneEvent && (reportOutput || reportUrl) && (
        <ReportCard output={reportOutput} reportUrl={reportUrl} />
      )}

      {/* Typing indicator while running */}
      {running && (
        <div className="flex items-center gap-1.5 px-4 py-3">
          <div className="w-[6px] h-[6px] rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
          <div className="w-[6px] h-[6px] rounded-full bg-violet-400 animate-bounce [animation-delay:200ms]" />
          <div className="w-[6px] h-[6px] rounded-full bg-violet-400 animate-bounce [animation-delay:400ms]" />
        </div>
      )}
    </div>
  );
}
