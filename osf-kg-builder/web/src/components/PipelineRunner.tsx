'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Domain } from './DomainSelector';
import type { DataSourcesConfig } from './DataSources';
import { API_URL } from '@/lib/api';

type PipelineState = 'idle' | 'running' | 'done' | 'error';

interface LogEntry { timestamp: Date; type: string; text: string; }

const PHASES = ['Import', 'Discover', 'Extract', 'Build', 'Validate', 'Correct'];

interface Props {
  domain?: Domain;
  dataSources?: DataSourcesConfig;
  className?: string;
  onRunComplete?: (runId: string) => void;
}

export default function PipelineRunner({ domain = 'manufacturing', dataSources, className, onRunComplete }: Props) {
  const [state, setState] = useState<PipelineState>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState(-1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [schema, setSchema] = useState('');
  const [validation, setValidation] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [correction, setCorrection] = useState('');
  const [waiting, setWaiting] = useState('');
  const [input, setInput] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  const log = useCallback((type: string, text: string) => {
    setLogs(p => [...p, { timestamp: new Date(), type, text }]);
  }, []);

  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const send = useCallback(async (msg: string) => {
    if (!runId) return;
    await fetch(`${API_URL}/api/kg-builder/message/${runId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    log('user', msg);
    setInput('');
    setWaiting('');
    setSchema('');
  }, [runId, log]);

  const start = useCallback(async () => {
    setState('running');
    setLogs([]);
    setPhase(-1);
    setSchema(''); setValidation(''); setAccuracy(null); setCorrection(''); setWaiting(''); setSummary(''); setError('');

    const body: Record<string, unknown> = { domain };
    if (dataSources?.smProfileUrl) body.smProfileUrl = dataSources.smProfileUrl;
    if (dataSources?.mtpUrls?.length) body.mtpUrls = dataSources.mtpUrls;
    if (dataSources?.i3xEndpoints?.length) body.i3xEndpoints = dataSources.i3xEndpoints;

    log('system', `Starting KG build for domain: ${domain}`);

    try {
      const res = await fetch(`${API_URL}/api/kg-builder/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let ev: any;
            try { ev = JSON.parse(line.slice(6)); } catch { continue; }

            switch (ev.type) {
              case 'heartbeat': break;
              case 'run_start': setRunId(ev.runId); log('system', `Run: ${ev.runId}`); break;
              case 'phase': setPhase(ev.phase); log('phase', `Phase ${ev.phase}: ${ev.description}`); break;
              case 'schema_proposal': setSchema(ev.markdown || JSON.stringify(ev.proposal, null, 2)); break;
              case 'waiting_for_input': setWaiting(ev.prompt); break;
              case 'extraction_progress': log('progress', ev.message); break;
              case 'validation_report': setValidation(ev.markdown || JSON.stringify(ev.report, null, 2)); setAccuracy(ev.accuracy); break;
              case 'correction_proposal': setCorrection(ev.markdown || JSON.stringify(ev.corrections, null, 2)); break;
              case 'answer': log('answer', `Q: ${ev.question}\nA: ${ev.answer}`); break;
              case 'done': setSummary(ev.summary); setState('done'); onRunComplete?.(ev.runId); break;
              case 'error': setError(ev.message); setState('error'); break;
              default: log('event', `${ev.type}: ${JSON.stringify(ev)}`);
            }
          }
        }
      }
      setState(s => s === 'running' ? 'done' : s);
    } catch (e: any) {
      setError(e.message);
      log('error', e.message);
      setState('error');
    }
  }, [domain, dataSources, log, onRunComplete]);

  const submit = () => { if (input.trim()) send(input.trim()); };

  /* ---- Phase bar ---- */
  const PhaseBar = () => (
    <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
      {PHASES.map((label, i) => {
        const active = i === phase;
        const done = i < phase;
        return (
          <div key={i} className="flex items-center">
            {i > 0 && <div className={`w-6 h-0.5 ${done ? 'bg-emerald-500' : 'bg-[var(--surface-4)]'}`} />}
            <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${
              active ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/50' :
              done ? 'bg-emerald-500/10 text-emerald-400' :
              'bg-[var(--surface-3)] text-[var(--text-dim)]'
            }`}>
              <span className="text-xs">{done ? '\u2713' : i}</span>{label}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ---- Log viewer ---- */
  const LogViewer = () => (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] max-h-64 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
      {logs.map((e, i) => {
        const c: Record<string, string> = { system: 'text-blue-400', phase: 'text-emerald-400', progress: 'text-[var(--text-dim)]', error: 'text-red-400', user: 'text-amber-400', answer: 'text-blue-300', done: 'text-emerald-400 font-bold', event: 'text-[var(--text-dim)]' };
        return <div key={i} className={c[e.type] || 'text-[var(--text-muted)]'}><span className="text-[var(--text-dim)] mr-2">{e.timestamp.toLocaleTimeString()}</span><span className="whitespace-pre-wrap">{e.text}</span></div>;
      })}
      <div ref={logEnd} />
    </div>
  );

  /* ---- Interactive panels ---- */
  const Panels = () => (
    <div className="space-y-3 mt-3">
      {schema && (
        <div className="card !border-purple-500/30 !bg-purple-500/5">
          <h4 className="text-sm font-semibold text-purple-400 mb-2">Schema Proposal</h4>
          <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap max-h-48 overflow-y-auto mb-3">{schema}</pre>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Corrections..." className="input flex-1" />
            <button onClick={() => send('ok')} className="btn-primary">Confirm</button>
            <button onClick={submit} className="btn-secondary">Send</button>
          </div>
        </div>
      )}

      {waiting && !schema && (
        <div className="card !border-amber-500/30 !bg-amber-500/5">
          <h4 className="text-sm font-semibold text-amber-400 mb-2">Input Required</h4>
          <p className="text-sm text-[var(--text-muted)] mb-3">{waiting}</p>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Your response..." className="input flex-1" />
            <button onClick={submit} className="btn-primary">Send</button>
          </div>
        </div>
      )}

      {validation && (
        <div className="card !border-cyan-500/30 !bg-cyan-500/5">
          <div className="flex items-center gap-3 mb-2">
            <h4 className="text-sm font-semibold text-cyan-400">Validation Report</h4>
            {accuracy !== null && <span className={`badge ${accuracy >= 80 ? 'badge-emerald' : accuracy >= 50 ? 'badge-amber' : 'badge-red'}`}>{accuracy}%</span>}
          </div>
          <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap max-h-48 overflow-y-auto">{validation}</pre>
        </div>
      )}

      {correction && (
        <div className="card !border-amber-500/30 !bg-amber-500/5">
          <h4 className="text-sm font-semibold text-amber-400 mb-2">Corrections</h4>
          <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap max-h-48 overflow-y-auto mb-3">{correction}</pre>
          <div className="flex gap-2">
            <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Additional corrections..." className="input flex-1" />
            <button onClick={() => send('ok')} className="btn-primary">Accept</button>
            <button onClick={submit} className="btn-secondary">Send</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-3">Pipeline</h2>

      {state === 'idle' && (
        <button onClick={start} className="w-full btn-primary py-3 text-base shadow-lg shadow-emerald-500/20">
          Build Knowledge Graph
        </button>
      )}

      {state === 'running' && <div className="space-y-3"><PhaseBar /><LogViewer /><Panels /></div>}

      {state === 'done' && (
        <div className="space-y-3">
          <PhaseBar />
          <div className="card !border-emerald-500/30 !bg-emerald-500/5">
            <h4 className="text-sm font-semibold text-emerald-400 mb-1">Build Complete</h4>
            <p className="text-sm text-[var(--text-muted)]">{summary || 'Knowledge graph built successfully.'}</p>
          </div>
          <LogViewer />
          <button onClick={() => { setState('idle'); setRunId(null); }} className="btn-secondary">New Build</button>
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-3">
          <div className="card !border-red-500/30 !bg-red-500/5">
            <h4 className="text-sm font-semibold text-red-400 mb-1">Build Failed</h4>
            <p className="text-sm text-red-400/80">{error}</p>
          </div>
          {logs.length > 0 && <LogViewer />}
          <button onClick={start} className="btn-primary">Retry</button>
        </div>
      )}
    </div>
  );
}
