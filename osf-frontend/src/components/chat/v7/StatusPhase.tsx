'use client';

import { V7Event } from './types';

export function StatusPhase({ events, running }: { events: V7Event[]; running: boolean }) {
  if (!running) return null;
  let phase = '';
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    switch (ev.type) {
      case 'init': phase = 'Initializing...'; break;
      case 'step_start': phase = ev.title || `Step ${ev.step}...`; break;
      case 'specialists_batch_start': phase = 'Specialists analyzing...'; break;
      case 'specialist_start': phase = `${ev.data?.displayName || ev.title || 'Specialist'} analyzing...`; break;
      case 'discussion_round_start': phase = `Discussion round ${ev.discussionRound || ''}...`; break;
      case 'discussion_question': phase = `Question for ${ev.targetSpecialist || 'Specialist'}...`; break;
      case 'discussion_answer': phase = `Response from ${ev.targetSpecialist || 'Specialist'}`; break;
      case 'discussion_synthesis_start': phase = 'Creating synthesis...'; break;
      case 'debate_start': phase = 'Debate & Synthesis...'; break;
      case 'debate_draft': phase = 'Draft created, critique in progress...'; break;
      case 'debate_critique': phase = `Critique from ${ev.debateCritiqueFrom || 'Specialist'}...`; break;
      case 'debate_final': phase = 'Generating report...'; break;
      case 'tool_call_start': phase = `${ev.toolName || 'Tool'}...`; break;
      case 'thinking': phase = ev.message || 'Thinking...'; break;
      default: continue;
    }
    break;
  }
  if (!phase) return null;
  return (
    <span className="text-xs text-text-dim truncate max-w-[300px]">{phase}</span>
  );
}
