'use client';

import { useEffect, useState } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8080';

const modeLabels: Record<string, { label: string; desc: string; color: string }> = {
  readonly: { label: 'Read-Only', desc: 'Observe only, no actions', color: 'text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30' },
  hitl: { label: 'HITL', desc: 'Auto-fix harmless, ask for rest', color: 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30' },
  auto: { label: 'Auto', desc: 'Fix everything automatically', color: 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/30' },
};

export default function ModeSelector() {
  const [mode, setMode] = useState<string>('readonly');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${AGENT_URL}/api/mode`)
      .then(r => r.json())
      .then(d => setMode(d.mode))
      .catch(() => {});

    const es = new EventSource(`${AGENT_URL}/api/stream`);
    es.addEventListener('mode_changed', (e) => {
      const data = JSON.parse(e.data);
      setMode(data.mode);
    });
    return () => es.close();
  }, []);

  async function changeMode(newMode: string) {
    try {
      const res = await fetch(`${AGENT_URL}/api/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const data = await res.json();
      setMode(data.mode);
    } catch {}
    setOpen(false);
  }

  const current = modeLabels[mode] || modeLabels.readonly;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`px-2 py-1 text-xs font-medium rounded border ${current.color} transition-colors`}
      >
        Mode: {current.label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 w-56">
          {Object.entries(modeLabels).map(([key, val]) => (
            <button
              key={key}
              onClick={() => changeMode(key)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${mode === key ? 'bg-gray-50 dark:bg-gray-700/50' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${key === 'readonly' ? 'bg-blue-500' : key === 'hitl' ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className="font-medium">{val.label}</span>
                {mode === key && <span className="text-xs text-gray-400 ml-auto">active</span>}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 ml-4">{val.desc}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
