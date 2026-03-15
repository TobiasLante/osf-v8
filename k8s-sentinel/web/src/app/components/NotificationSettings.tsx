'use client';

import { useEffect, useState } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || 'http://localhost:8888';

interface NotificationEndpoint {
  id: string;
  type: 'slack' | 'webhook';
  url: string;
  events: string[];
  enabled: boolean;
}

const EVENT_OPTIONS = ['issue_detected', 'fix_applied', 'fix_proposed', 'prediction'];

export default function NotificationSettings({ onClose }: { onClose: () => void }) {
  const [endpoints, setEndpoints] = useState<NotificationEndpoint[]>([]);
  const [newType, setNewType] = useState<'slack' | 'webhook'>('slack');
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<Set<string>>(new Set(EVENT_OPTIONS));
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    fetchEndpoints();
  }, []);

  async function fetchEndpoints() {
    try {
      const res = await fetch(`${AGENT_URL}/api/notifications/config`);
      setEndpoints(await res.json());
    } catch {}
  }

  async function addEndpoint() {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      await fetch(`${AGENT_URL}/api/notifications/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType, url: newUrl, events: Array.from(newEvents) }),
      });
      setNewUrl('');
      setNewEvents(new Set(EVENT_OPTIONS));
      await fetchEndpoints();
    } catch {}
    setAdding(false);
  }

  async function removeEndpoint(id: string) {
    try {
      await fetch(`${AGENT_URL}/api/notifications/config/${id}`, { method: 'DELETE' });
      await fetchEndpoints();
    } catch {}
  }

  async function testEndpoint(id: string) {
    setTesting(id);
    try {
      await fetch(`${AGENT_URL}/api/notifications/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
    setTesting(null);
  }

  function toggleEvent(event: string) {
    setNewEvents(prev => {
      const next = new Set(prev);
      next.has(event) ? next.delete(event) : next.add(event);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 h-full overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notification Settings</h2>
            <button
              onClick={onClose}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl"
            >
              x
            </button>
          </div>

          {/* Existing endpoints */}
          <div className="space-y-3 mb-6">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase">Endpoints</h3>
            {endpoints.length === 0 && (
              <p className="text-gray-400 dark:text-gray-600 text-sm">No notification endpoints configured.</p>
            )}
            {endpoints.map(ep => (
              <div key={ep.id} className="bg-gray-50 dark:bg-gray-800 rounded p-3 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                      ep.type === 'slack'
                        ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
                        : 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {ep.type}
                  </span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">{ep.url}</span>
                  <span className={`w-2 h-2 rounded-full ${ep.enabled ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {ep.events.map(ev => (
                    <span key={ev} className="px-1.5 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                      {ev}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => testEndpoint(ep.id)}
                    disabled={testing === ep.id}
                    className="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-600 dark:text-blue-400 border border-blue-600/30 rounded disabled:opacity-50"
                  >
                    {testing === ep.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => removeEndpoint(ep.id)}
                    className="px-2 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-600 dark:text-red-400 border border-red-600/30 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add new endpoint */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Add Endpoint</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value as 'slack' | 'webhook')}
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200"
                >
                  <option value="slack">Slack</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">URL</label>
                <input
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  placeholder={newType === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://example.com/webhook'}
                  className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">Events</label>
                <div className="flex flex-wrap gap-2">
                  {EVENT_OPTIONS.map(ev => (
                    <label key={ev} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEvents.has(ev)}
                        onChange={() => toggleEvent(ev)}
                        className="rounded border-gray-300 dark:border-gray-600 text-emerald-600 focus:ring-emerald-500"
                      />
                      {ev}
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={addEndpoint}
                disabled={!newUrl.trim() || newEvents.size === 0 || adding}
                className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
              >
                {adding ? 'Adding...' : 'Add Endpoint'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
