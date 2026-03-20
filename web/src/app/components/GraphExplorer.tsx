'use client';

import { useState, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8035';

const SUGGESTIONS = [
  'Show all nodes',
  'Show all relationships',
  'What equipment exists?',
];

interface GraphExplorerProps {
  runId?: string;
  className?: string;
}

interface Answer {
  question: string;
  answer: string;
}

export default function GraphExplorer({ runId, className }: GraphExplorerProps) {
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);

  const sendQuery = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setLoading(true);
      setQuery('');

      try {
        const response = await fetch(`${API_URL}/api/kg-builder/message/${runId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: question }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setAnswers((prev) => [
          ...prev,
          {
            question,
            answer: data.answer || data.message || JSON.stringify(data),
          },
        ]);
      } catch (err) {
        setAnswers((prev) => [
          ...prev,
          {
            question,
            answer: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [runId],
  );

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        Graph Explorer
      </h2>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
        {/* Query Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendQuery(query)}
            placeholder="Ask about the graph..."
            disabled={loading}
            className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
          />
          <button
            onClick={() => sendQuery(query)}
            disabled={loading || !query.trim()}
            className="rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm text-white font-medium transition-colors"
          >
            {loading ? 'Asking...' : 'Ask'}
          </button>
        </div>

        {/* Suggestion Chips */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => sendQuery(s)}
              disabled={loading}
              className="rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1 text-xs text-[var(--text)] hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Answers */}
        {answers.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {answers.map((a, i) => (
              <div key={i} className="space-y-1">
                <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Q: {a.question}
                </div>
                <div className="rounded-md bg-gray-50 dark:bg-gray-800 p-3 text-sm text-[var(--text)] whitespace-pre-wrap">
                  {a.answer}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Placeholder Note */}
        <p className="text-xs text-[var(--muted)] text-center pt-2 border-t border-gray-100 dark:border-gray-800">
          Full graph visualization coming soon.
        </p>
      </div>
    </div>
  );
}
