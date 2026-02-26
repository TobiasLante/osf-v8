import { V7Event } from './types';

export interface V7DerivedState {
  currentPlan: V7Event['plan'] | null;
  specialists: Map<string, { name: string; status: string; report: any; duration?: number }>;
  doneEvent: V7Event | null;
  doneResult: any;
  discussionEvents: V7Event[];
  bubbles: Array<{ key: string; event: V7Event }>;
}

export function useV7Events(events: V7Event[]): V7DerivedState {
  let currentPlan: V7Event['plan'] | null = null;
  const specialists = new Map<string, { name: string; status: string; report: any; duration?: number }>();
  let doneEvent: V7Event | null = null;
  let doneResult: any = null;

  const discussionEvents: V7Event[] = [];
  const discussionTypes = new Set([
    'discussion_round_start', 'discussion_question', 'discussion_answer',
    'discussion_recruit', 'discussion_recruit_result', 'discussion_round_complete',
    'discussion_synthesis_start',
    'debate_start', 'debate_draft', 'debate_critique', 'debate_final',
    'specialists_batch_complete',
  ]);

  const bubbles: Array<{ key: string; event: V7Event }> = [];
  let bubbleIdx = 0;

  for (const ev of events) {
    if (ev.type === 'plan' && ev.plan) {
      currentPlan = ev.plan;
    }
    if ((ev.type === 'step_start' || ev.type === 'step_complete' || ev.type === 'step_error') && ev.plan) {
      currentPlan = ev.plan;
    }

    if (ev.type === 'specialist_start') {
      const key = ev.data?.name || ev.title || `specialist-${bubbleIdx}`;
      specialists.set(key, { name: ev.data?.displayName || ev.title || key, status: 'running', report: null });
    }
    if (ev.type === 'specialist_complete') {
      const key = ev.data?.name || ev.title || '';
      const existing = specialists.get(key);
      if (existing) {
        existing.status = 'done';
        existing.report = ev.data?.report || ev.data;
        existing.duration = ev.data?.durationMs || ev.duration;
      }
    }
    if (ev.type === 'specialist_error') {
      const key = ev.data?.name || ev.title || '';
      const existing = specialists.get(key);
      if (existing) {
        existing.status = 'error';
        existing.report = null;
      }
    }

    if (ev.type === 'done') {
      doneEvent = ev;
    }

    if (ev.type === 'intermediate_result' && ev.data) {
      doneResult = ev.data;
    }

    if (discussionTypes.has(ev.type)) {
      discussionEvents.push(ev);
      continue;
    }

    if (ev.type !== 'plan' && ev.type !== 'specialist_start' && ev.type !== 'specialist_complete' && ev.type !== 'specialist_error') {
      bubbles.push({ key: `b-${bubbleIdx++}`, event: ev });
    }
  }

  return { currentPlan, specialists, doneEvent, doneResult, discussionEvents, bubbles };
}
