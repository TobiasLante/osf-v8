export interface V7Event {
  type: string;
  sessionId?: string;
  timestamp?: number;
  message?: string;
  // Plan
  plan?: {
    title: string;
    steps: Array<{
      id: number;
      title: string;
      description?: string;
      status: string;
      result?: string;
      duration?: number;
    }>;
    currentStep: number;
    totalSteps: number;
  };
  // Steps
  step?: number;
  totalSteps?: number;
  title?: string;
  description?: string;
  result?: string;
  duration?: number;
  error?: string;
  // Specialist
  data?: any;
  format?: string;
  // Tool
  toolName?: string;
  params?: Record<string, any>;
  // Thinking
  iteration?: number;
  maxIterations?: number;
  // Discussion
  discussionRound?: number;
  moderatorQuestion?: string;
  targetSpecialist?: string;
  discussionAnswer?: string;
  recruitedSpecialistName?: string;
  recruitedSpecialistReason?: string;
  recruitedSpecialistReport?: string;
  // Debate
  debateDraftSummary?: string;
  debateCritiqueFrom?: string;
  debateCritiqueItems?: Array<{ type: string; text: string }>;
  debateCritiqueAssessment?: string;
  debateFinalSummary?: string;
  // Batch
  specialistResults?: Array<{ domain?: string; name?: string; status?: string; report?: any; error?: string }>;
  [key: string]: any;
}

export interface V7StreamOutputProps {
  events: V7Event[];
  running: boolean;
  maxHeight?: string;
  reportUrl?: string | null;
  reportOutput?: string | null;
}

export const COLORS = {
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400', dot: 'bg-violet-400' },
  green:  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  amber:  { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' },
  blue:   { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' },
  red:    { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
  cyan:   { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400', dot: 'bg-cyan-400' },
};

export function eventColor(type: string) {
  switch (type) {
    case 'plan': return COLORS.blue;
    case 'step_start': case 'step_complete': return COLORS.blue;
    case 'specialist_start': case 'specialists_batch_start': return COLORS.violet;
    case 'specialist_complete': case 'specialists_batch_complete': return COLORS.green;
    case 'tool_call_start': case 'tool_call_end': return COLORS.amber;
    case 'thinking': return COLORS.violet;
    case 'done': return COLORS.green;
    case 'init': return COLORS.cyan;
    case 'error': case 'step_error': case 'specialist_error': return COLORS.red;
    case 'intermediate_result': return COLORS.green;
    default: return COLORS.blue;
  }
}

export function eventIcon(type: string): string {
  switch (type) {
    case 'plan': return '\u{1F4CB}';
    case 'step_start': return '\u{25B6}\uFE0F';
    case 'step_complete': return '\u2705';
    case 'specialist_start': return '\u{1F9E0}';
    case 'specialist_complete': return '\u2705';
    case 'specialists_batch_start': return '\u{1F52C}';
    case 'specialists_batch_complete': return '\u{1F3AF}';
    case 'tool_call_start': return '\u{1F527}';
    case 'tool_call_end': return '\u2705';
    case 'thinking': return '\u{1F4AD}';
    case 'done': return '\u2705';
    case 'init': return '\u{1F680}';
    case 'error': case 'step_error': return '\u274C';
    case 'intermediate_result': return '\u{1F4CA}';
    default: return '\u{1F4E1}';
  }
}

export const mdClasses = `[&_h1]:text-[1.3rem] [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1:first-child]:mt-0
  [&_h2]:text-[1.15rem] [&_h2]:font-bold [&_h2]:text-accent [&_h2]:mt-4 [&_h2]:mb-2 [&_h2:first-child]:mt-0
  [&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5
  [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
  [&_code]:font-mono [&_code]:bg-accent/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_code]:text-accent
  [&_pre]:bg-bg [&_pre]:border [&_pre]:border-border [&_pre]:rounded-sm [&_pre]:p-3.5 [&_pre]:my-3 [&_pre]:overflow-x-auto
  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-text
  [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-[13px]
  [&_th]:p-2 [&_th]:px-3 [&_th]:text-left [&_th]:border-b [&_th]:border-border [&_th]:font-semibold [&_th]:text-text-muted [&_th]:bg-bg-surface-2
  [&_td]:p-2 [&_td]:px-3 [&_td]:text-left [&_td]:border-b [&_td]:border-border
  [&_ul]:my-2 [&_ul]:pl-5 [&_li]:my-1
  [&_strong]:text-text [&_strong]:font-semibold
  [&_a]:text-accent [&_a]:no-underline [&_a]:border-b [&_a]:border-accent/30 hover:[&_a]:text-text hover:[&_a]:border-accent`;
