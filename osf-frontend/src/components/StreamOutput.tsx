'use client';

import { useRef, useEffect } from 'react';
import { ToolCallCard } from './chat/ToolCallCard';
import { safeMarkdown } from '@/lib/markdown';

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

interface StreamOutputProps {
  events: StreamEvent[];
  running: boolean;
  compact?: boolean;
  maxHeight?: string;
  showToolResults?: boolean;
}

interface ToolCallState {
  id: string;
  name: string;
  arguments?: Record<string, any>;
  result?: string;
  status: 'running' | 'done' | 'error';
}

interface Phase {
  nodeId: string;
  name: string;
  nodeType?: string;
  status: 'running' | 'done' | 'error' | 'skipped';
  content: string;
  error?: string;
  toolCalls: ToolCallState[];
}

/** A renderable block: could be a content bubble, tool call section, log, phase, etc. */
interface RenderBlock {
  type: 'content' | 'tool' | 'log' | 'phase-header' | 'result' | 'error';
  key: string;
  text?: string;
  toolCall?: ToolCallState;
  phase?: Phase;
  logMsg?: string;
}

/** Domain labels for specialist reports */
const DOMAIN_LABELS: Record<string, string> = {
  delivery: '📦 Delivery / OTD',
  capacity: '⚙️ Capacity / OEE',
  material: '📋 Material / WMS',
  quality: '🔬 Quality / QMS',
};

const PERSPECTIVE_LABELS: Record<string, string> = {
  optimist: '🌟 Optimist',
  realist: '⚠️ Realist',
};

/** Convert structured JSON content into readable markdown */
function formatJsonContent(text: string): string {
  try {
    const data = JSON.parse(text);

    // Specialist report
    if (data.domain && data.kritischeFindings) {
      const label = DOMAIN_LABELS[data.domain] || data.domain;
      let md = `### ${label}\n\n`;
      if (data.zahlenDatenFakten) md += `**Key Figures:** ${data.zahlenDatenFakten}\n\n`;
      if (Array.isArray(data.kritischeFindings)) {
        md += `**Critical Findings:**\n`;
        data.kritischeFindings.forEach((f: any) => {
          if (typeof f === 'string') md += `- ${f}\n`;
          else if (f.finding) md += `- **${f.severity || ''}** ${f.finding}\n`;
        });
        md += '\n';
      }
      if (Array.isArray(data.empfehlungen)) {
        md += `**Recommendations:**\n`;
        data.empfehlungen.forEach((e: any) => {
          if (typeof e === 'string') md += `- ${e}\n`;
          else if (e.action) md += `- ${e.action}${e.priority ? ` *(${e.priority})*` : ''}\n`;
        });
        md += '\n';
      }
      if (Array.isArray(data.crossDomainHinweise) && data.crossDomainHinweise.length > 0) {
        md += `**Cross-Domain Notes:**\n`;
        data.crossDomainHinweise.forEach((h: string) => md += `- ${h}\n`);
      }
      return md;
    }

    // Moderator summary
    if (data.summary && data.gaps) {
      let md = `### 🎯 Moderator Summary\n\n`;
      md += `${data.summary}\n\n`;
      if (Array.isArray(data.gaps) && data.gaps.length > 0) {
        md += `**Gaps:**\n`;
        data.gaps.forEach((g: any) => md += `- ${typeof g === 'string' ? g : g.gap || JSON.stringify(g)}\n`);
        md += '\n';
      }
      if (Array.isArray(data.contradictions) && data.contradictions.length > 0) {
        md += `**Contradictions:**\n`;
        data.contradictions.forEach((c: any) => md += `- ${typeof c === 'string' ? c : JSON.stringify(c)}\n`);
        md += '\n';
      }
      if (Array.isArray(data.preliminaryInsights) && data.preliminaryInsights.length > 0) {
        md += `**Preliminary Insights:**\n`;
        data.preliminaryInsights.forEach((i: any) => md += `- ${typeof i === 'string' ? i : JSON.stringify(i)}\n`);
      }
      return md;
    }

    // Optimist / Realist perspective
    if (data.perspective) {
      const label = PERSPECTIVE_LABELS[data.perspective] || data.perspective;
      let md = `### ${label}\n\n`;

      if (data.perspective === 'optimist') {
        if (Array.isArray(data.positiveFindings)) {
          md += `**Positive Findings:**\n`;
          data.positiveFindings.forEach((f: any) => {
            if (typeof f === 'string') md += `- ${f}\n`;
            else md += `- **${f.area || ''}**: ${f.finding || JSON.stringify(f)}\n`;
          });
          md += '\n';
        }
        if (Array.isArray(data.quickWins)) {
          md += `**Quick Wins:**\n`;
          data.quickWins.forEach((w: any) => md += `- ${typeof w === 'string' ? w : w.action || JSON.stringify(w)}\n`);
          md += '\n';
        }
        if (Array.isArray(data.opportunities)) {
          md += `**Opportunities:**\n`;
          data.opportunities.forEach((o: any) => md += `- ${typeof o === 'string' ? o : JSON.stringify(o)}\n`);
        }
      } else {
        if (Array.isArray(data.risks)) {
          md += `**Risks:**\n`;
          data.risks.forEach((r: any) => {
            if (typeof r === 'string') md += `- ${r}\n`;
            else md += `- **${r.area || ''}**: ${r.risk || JSON.stringify(r)}\n`;
          });
          md += '\n';
        }
        if (Array.isArray(data.hiddenProblems)) {
          md += `**Hidden Problems:**\n`;
          data.hiddenProblems.forEach((p: any) => md += `- ${typeof p === 'string' ? p : JSON.stringify(p)}\n`);
          md += '\n';
        }
        if (data.worstCaseScenario) {
          md += `**Worst Case:** ${typeof data.worstCaseScenario === 'string' ? data.worstCaseScenario : JSON.stringify(data.worstCaseScenario)}\n\n`;
        }
        if (Array.isArray(data.criticalBlockers)) {
          md += `**Critical Blockers:**\n`;
          data.criticalBlockers.forEach((b: any) => md += `- ${typeof b === 'string' ? b : JSON.stringify(b)}\n`);
        }
      }
      return md;
    }

    // Executive summary / action plan
    if (data.executiveSummary) {
      let md = `### 📊 Executive Summary\n\n`;
      md += `${data.executiveSummary}\n\n`;
      if (Array.isArray(data.keyMetrics)) {
        md += `**Key Metrics:**\n`;
        data.keyMetrics.forEach((m: any) => {
          if (typeof m === 'string') md += `- ${m}\n`;
          else md += `- **${m.metric || m.name || ''}**: ${m.value || ''} ${m.status ? `(${m.status})` : ''}\n`;
        });
        md += '\n';
      }
      if (Array.isArray(data.actionPlan)) {
        md += `**Action Plan:**\n`;
        data.actionPlan.forEach((a: any, idx: number) => {
          if (typeof a === 'string') md += `${idx + 1}. ${a}\n`;
          else md += `${idx + 1}. **${a.action || a.title || ''}** ${a.responsible ? `— ${a.responsible}` : ''} ${a.deadline ? `(by ${a.deadline})` : ''}\n`;
        });
        md += '\n';
      }
      if (data.expectedOutcome) {
        md += `**Expected Outcome:** ${typeof data.expectedOutcome === 'string' ? data.expectedOutcome : JSON.stringify(data.expectedOutcome)}\n`;
      }
      return md;
    }

    // Fallback: pretty-print JSON
    return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
  } catch {
    return text;
  }
}

/** Markdown content CSS classes (same as ChatMessage) */
const mdClasses = `[&_h1]:text-[1.3rem] [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1:first-child]:mt-0
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

function statusDot(status: 'running' | 'done' | 'error' | 'skipped' | 'pending') {
  const base = 'w-2.5 h-2.5 rounded-full flex-shrink-0';
  switch (status) {
    case 'running': return <span className={`${base} bg-amber-400 animate-pulse`} />;
    case 'done': return <span className={`${base} bg-emerald-400`} />;
    case 'error': return <span className={`${base} bg-red-400`} />;
    case 'skipped': return <span className={`${base} bg-text-dim opacity-50`} />;
    default: return <span className={`${base} bg-text-dim`} />;
  }
}

export function StreamOutput({ events, running, compact, maxHeight = '80vh', showToolResults: _showToolResults }: StreamOutputProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // Build an ordered sequence of render blocks from events
  const blocks: RenderBlock[] = [];
  const toolCalls: ToolCallState[] = [];
  const phases: Phase[] = [];
  let headerName = '';
  let headerRunId = '';
  let finalResult: string | null = null;
  let errorMessage: string | null = null;
  let executionTime: number | null = null;
  let isDone = false;
  let toolCounter = 0;
  let blockCounter = 0;

  for (const ev of events) {
    switch (ev.type) {
      case 'run_start':
      case 'flow_start':
        headerName = ev.agent || ev.flowName || ev.name || '';
        headerRunId = ev.runId || '';
        break;

      case 'node_start':
        phases.push({
          nodeId: ev.nodeId,
          name: ev.name || ev.nodeId,
          nodeType: ev.nodeType,
          status: 'running',
          content: '',
          toolCalls: [],
        });
        blocks.push({ type: 'phase-header', key: `ph-${blockCounter++}`, phase: phases[phases.length - 1] });
        break;

      case 'node_content': {
        const phase = phases.find(p => p.nodeId === ev.nodeId);
        if (phase) {
          phase.content += ev.text || '';
        }
        // Also add as inline content block
        const text = ev.text || '';
        if (text) {
          blocks.push({ type: 'content', key: `nc-${blockCounter++}`, text });
        }
        break;
      }

      case 'content': {
        // LLM discussion content — each one is its own bubble
        const text = ev.text || ev.content || '';
        if (text) {
          blocks.push({ type: 'content', key: `ct-${blockCounter++}`, text });
        }
        break;
      }

      case 'node_done': {
        const phase = phases.find(p => p.nodeId === ev.nodeId);
        if (phase) phase.status = 'done';
        break;
      }

      case 'node_skipped':
        break;

      case 'node_error': {
        const phase = phases.find(p => p.nodeId === ev.nodeId);
        if (phase) {
          phase.status = 'error';
          phase.error = ev.error;
        }
        break;
      }

      case 'tool_start': {
        const tc: ToolCallState = {
          id: `tc-${toolCounter++}`,
          name: ev.name || 'unknown',
          arguments: ev.arguments,
          status: 'running',
        };
        toolCalls.push(tc);
        blocks.push({ type: 'tool', key: `t-${blockCounter++}`, toolCall: tc });
        const currentPhase = phases.findLast(p => p.status === 'running');
        if (currentPhase) currentPhase.toolCalls.push(tc);
        break;
      }

      case 'tool_result': {
        const tc = [...toolCalls].reverse().find(t => t.name === ev.name && t.status === 'running');
        if (tc) {
          tc.status = 'done';
          tc.result = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result);
        }
        break;
      }

      case 'llm_start':
        break;

      case 'llm_result':
        break;

      case 'log':
        if (ev.message) {
          blocks.push({ type: 'log', key: `log-${blockCounter++}`, logMsg: ev.message });
        }
        break;

      case 'result':
        if (typeof ev.data === 'string') {
          finalResult = ev.data;
        } else if (ev.data) {
          finalResult = JSON.stringify(ev.data, null, 2);
        }
        break;

      case 'error':
        errorMessage = ev.message || ev.error || 'Unknown error';
        break;

      case 'done':
      case 'flow_complete':
        isDone = true;
        if (ev.executionTime) executionTime = ev.executionTime;
        break;

      case 'flow_paused':
        break;
    }
  }

  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto space-y-3 ${textSize}`}
      style={{ maxHeight }}
    >
      {/* Header banner */}
      {headerName && (
        <div className="flex items-center gap-2 text-text-dim text-xs px-1">
          {statusDot(running ? 'running' : isDone ? 'done' : 'pending')}
          <span className="font-medium text-text">{headerName}</span>
          {headerRunId && <span className="text-text-dim font-mono text-[10px]">{headerRunId.slice(0, 8)}</span>}
          {executionTime && <span className="ml-auto text-emerald-400">{Math.round(executionTime / 1000)}s</span>}
        </div>
      )}

      {/* Ordered blocks — tool calls, content bubbles, logs, phase headers in sequence */}
      {blocks.map(block => {
        switch (block.type) {
          case 'log':
            return (
              <div key={block.key} className={`text-text-dim text-xs ${compact ? 'px-1' : 'px-2'}`}>
                {block.logMsg}
              </div>
            );

          case 'tool':
            return block.toolCall ? (
              <ToolCallCard
                key={block.key}
                name={block.toolCall.name}
                arguments={block.toolCall.arguments}
                result={block.toolCall.result}
                status={block.toolCall.status}
              />
            ) : null;

          case 'content':
            return block.text ? (
              <div key={block.key} className="flex gap-3 max-w-[900px]">
                {!compact && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-[10px] grid place-items-center text-sm bg-accent-gradient">
                    ⚡
                  </div>
                )}
                <div className={`flex-1 min-w-0 px-4 py-3 rounded-md bg-bg-surface border border-border rounded-tl-[4px] leading-[1.7] ${mdClasses}`}
                  dangerouslySetInnerHTML={{ __html: safeMarkdown(formatJsonContent(block.text)) }}
                />
              </div>
            ) : null;

          case 'phase-header':
            return block.phase ? (
              <div key={block.key} className="flex items-center gap-2 px-1 pt-2">
                {statusDot(block.phase.status)}
                <span className="font-semibold text-text text-sm">{block.phase.name}</span>
                {block.phase.nodeType && <span className="text-text-dim text-xs">{block.phase.nodeType}</span>}
              </div>
            ) : null;

          default:
            return null;
        }
      })}

      {/* Typing indicator */}
      {running && (
        <div className="flex gap-3 px-1">
          {!compact && (
            <div className="flex-shrink-0 w-8 h-8 rounded-[10px] grid place-items-center text-sm bg-accent-gradient">
              ⚡
            </div>
          )}
          <div className="flex items-center gap-1.5 px-4 py-3">
            <div className="w-[6px] h-[6px] rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
            <div className="w-[6px] h-[6px] rounded-full bg-accent animate-bounce [animation-delay:200ms]" />
            <div className="w-[6px] h-[6px] rounded-full bg-accent animate-bounce [animation-delay:400ms]" />
          </div>
        </div>
      )}

      {/* Final result card */}
      {finalResult && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4">
          <h3 className="text-emerald-400 font-semibold text-sm mb-2 flex items-center gap-2">
            {statusDot('done')} Result
          </h3>
          <div
            className={`text-text-muted text-sm leading-relaxed ${mdClasses}`}
            dangerouslySetInnerHTML={{ __html: safeMarkdown(finalResult) }}
          />
        </div>
      )}

      {/* Error card */}
      {errorMessage && !running && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-red-400 text-sm flex items-center gap-2">
            {statusDot('error')} {errorMessage}
          </p>
        </div>
      )}

      {/* Done footer */}
      {isDone && !finalResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2">
          {statusDot('done')}
          <span className="text-emerald-400 font-medium text-sm">Completed</span>
          {executionTime && (
            <span className="text-text-dim text-xs ml-auto">{Math.round(executionTime / 1000)}s</span>
          )}
        </div>
      )}
    </div>
  );
}
