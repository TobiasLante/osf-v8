'use client';

import { useState, useRef, useEffect } from 'react';
import { useCluster } from '../context/ClusterContext';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface ToolCallInfo {
  tool_call_id: string;
  name: string;
  result: {
    name: string;
    result?: any;
    error?: string;
    blocked?: boolean;
    blocked_reason?: string;
    requires_approval?: boolean;
    approval_id?: string;
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCallInfo[];
}

interface AuditEntry {
  id: string;
  action: string;
  tool_name: string;
  params: any;
  status: string;
  blocked_reason?: string;
  created_at: string;
}

const suggestions = [
  "What's wrong with the cluster?",
  'Show OOMKilled pods',
  'Which nodes have issues?',
  'Summarize recent incidents',
  'Show cluster health',
  'List all pods',
];

export default function ChatPanel() {
  const { activeClusterId, activeCluster } = useCluster();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchAuditLog() {
    setAuditLoading(true);
    try {
      const url = activeClusterId
        ? `${AGENT_URL}/api/audit-log?cluster_id=${activeClusterId}&limit=30`
        : `${AGENT_URL}/api/audit-log?limit=30`;
      const res = await fetch(url);
      const data = await res.json();
      setAuditLog(data);
    } catch {
      setAuditLog([]);
    }
    setAuditLoading(false);
  }

  async function send(text?: string) {
    const msg = text || input.trim();
    if (!msg || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const res = await fetch(`${AGENT_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          cluster_id: activeClusterId,
          cluster_name: activeCluster?.name,
          cluster_type: activeCluster?.type,
        }),
      });
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer || data.error || 'No response',
          tool_calls: data.tool_calls,
        },
      ]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    }

    setLoading(false);
  }

  function renderToolCall(tc: ToolCallInfo, idx: number) {
    const r = tc.result;

    if (r.blocked) {
      return (
        <div key={idx} className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 mb-1">
          <span className="font-mono font-semibold">{tc.name}</span>
          <span className="ml-2 text-red-500">Blocked:</span> {r.blocked_reason}
        </div>
      );
    }

    if (r.requires_approval) {
      return (
        <div key={idx} className="text-xs p-2 rounded bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 mb-1">
          <span className="font-mono font-semibold">{tc.name}</span>
          <span className="ml-2">Pending approval</span>
          <span className="ml-1 text-amber-500 text-[10px]">({r.approval_id?.slice(0, 8)}...)</span>
        </div>
      );
    }

    if (r.error) {
      return (
        <div key={idx} className="text-xs p-2 rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 mb-1">
          <span className="font-mono font-semibold">{tc.name}</span>
          <span className="ml-2 text-red-500">Error:</span> {r.error}
        </div>
      );
    }

    // Success
    const resultSummary = r.result
      ? typeof r.result === 'string'
        ? r.result
        : Array.isArray(r.result)
          ? `${r.result.length} items`
          : r.result.message || r.result.error || JSON.stringify(r.result).slice(0, 120)
      : 'OK';

    return (
      <div key={idx} className="text-xs p-2 rounded bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 mb-1">
        <span className="font-mono font-semibold">{tc.name}</span>
        <span className="ml-2 text-emerald-600 dark:text-emerald-400">{resultSummary}</span>
      </div>
    );
  }

  const statusColor = (s: string) => {
    if (s === 'allowed' || s === 'approved') return 'text-emerald-600 dark:text-emerald-400';
    if (s === 'blocked' || s === 'rejected') return 'text-red-500 dark:text-red-400';
    if (s === 'pending') return 'text-amber-500 dark:text-amber-400';
    return 'text-gray-500';
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Cluster Chat</h2>
        {activeCluster && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            ({activeCluster.name} - {activeCluster.type})
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 mb-3 min-h-[200px] max-h-[400px]">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-gray-400 dark:text-gray-600 text-sm">Ask anything about your cluster:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            <div className={`text-sm p-2 rounded ${m.role === 'user' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ml-8' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 mr-8'}`}>
              {m.content}
            </div>
            {m.tool_calls && m.tool_calls.length > 0 && (
              <div className="mr-8 mt-1 space-y-1">
                {m.tool_calls.map((tc, idx) => renderToolCall(tc, idx))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="text-sm text-gray-400 dark:text-gray-500 animate-pulse p-2">Thinking...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about your cluster..."
          className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {/* Audit Log Toggle */}
      <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-2">
        <button
          onClick={() => {
            const next = !showAuditLog;
            setShowAuditLog(next);
            if (next) fetchAuditLog();
          }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {showAuditLog ? 'Hide' : 'Show'} Audit Log
        </button>
        {showAuditLog && (
          <div className="mt-2 max-h-[200px] overflow-y-auto space-y-1">
            {auditLoading && <p className="text-xs text-gray-400 animate-pulse">Loading...</p>}
            {!auditLoading && auditLog.length === 0 && (
              <p className="text-xs text-gray-400">No audit entries yet.</p>
            )}
            {auditLog.map(entry => (
              <div key={entry.id} className="text-[11px] px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded flex items-center gap-2">
                <span className={`font-semibold ${statusColor(entry.status)}`}>{entry.status}</span>
                <span className="font-mono text-gray-600 dark:text-gray-400">{entry.tool_name || entry.action}</span>
                {entry.blocked_reason && <span className="text-red-400 truncate max-w-[200px]">{entry.blocked_reason}</span>}
                <span className="ml-auto text-gray-400">{new Date(entry.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
