'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface LlmSettings {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  providerDefaults: Record<string, { baseUrl: string; models: string[] }>;
}

const PROVIDERS = [
  { value: 'platform', label: 'Platform', desc: 'Built-in Qwen models — no API key needed' },
  { value: 'openai', label: 'OpenAI', desc: 'GPT-4o, o1, or other OpenAI models' },
  { value: 'anthropic', label: 'Anthropic', desc: 'Claude Sonnet, Opus, or Haiku' },
  { value: 'custom', label: 'Custom URL', desc: 'Any OpenAI-compatible API (Ollama, vLLM)' },
];

function Msg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm mt-3 ${msg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>;
}

export function LlmTab() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [provider, setProvider] = useState('platform');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    apiFetch<LlmSettings>('/auth/llm-settings')
      .then(data => {
        setSettings(data);
        setProvider(data.provider);
        setBaseUrl(data.baseUrl || '');
        setModel(data.model || '');
      })
      .catch(() => {})
      .finally(() => setLoadingSettings(false));
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (provider === 'platform') {
      setBaseUrl(''); setModel(''); setApiKey('');
    } else if (provider !== 'custom' && settings.providerDefaults[provider]) {
      const defaults = settings.providerDefaults[provider];
      setBaseUrl(defaults.baseUrl);
      if (!model || !defaults.models.includes(model)) setModel(defaults.models[0] || '');
    }
  }, [provider, settings]);

  const handleSave = async () => {
    setSaving(true); setMessage(null);
    try {
      await apiFetch('/auth/llm-settings', {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          baseUrl: provider === 'platform' ? undefined : baseUrl,
          model: provider === 'platform' ? undefined : model,
          apiKey: apiKey || undefined,
        }),
      });
      setMessage({ type: 'success', text: 'Settings saved! Connection test passed.' });
      setApiKey('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally { setSaving(false); }
  };

  if (loadingSettings) return <div className="text-text-muted text-center py-20">Loading...</div>;

  const providerModels = settings?.providerDefaults[provider]?.models || [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-text text-sm font-medium">LLM Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PROVIDERS.map(p => (
            <button key={p.value}
              onClick={() => setProvider(p.value)}
              className={`text-left border rounded-md p-4 transition-all ${provider === p.value ? 'border-accent bg-accent/5' : 'border-border hover:border-border-hover'}`}>
              <span className="text-text font-medium text-sm">{p.label}</span>
              <p className="text-text-dim text-xs mt-1">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {provider !== 'platform' && (
        <>
          <div>
            <label className="text-text text-sm font-medium block mb-1.5">Base URL</label>
            <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com"
              className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="text-text text-sm font-medium block mb-1.5">Model</label>
            {providerModels.length > 0 ? (
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent">
                {providerModels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. llama3, mistral"
                className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
            )}
          </div>
          <div>
            <label className="text-text text-sm font-medium block mb-1.5">
              API Key {settings?.hasApiKey && <span className="text-emerald-400 text-xs ml-1">(saved)</span>}
            </label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder={settings?.hasApiKey ? 'Leave empty to keep current key' : 'sk-...'}
              className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
            <p className="text-text-dim text-xs mt-1">Encrypted with AES-256.</p>
          </div>
        </>
      )}

      <div className="flex items-center gap-4">
        <button onClick={handleSave} disabled={saving || (provider !== 'platform' && (!model || !baseUrl))}
          className="bg-accent text-bg px-6 py-2.5 rounded-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
          {saving ? 'Testing & Saving...' : 'Save Settings'}
        </button>
        <Msg msg={message} />
      </div>

      {/* Claude Code Integration */}
      <div className="border border-border rounded-md p-5 mt-8">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-purple-500/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-text font-semibold text-sm mb-1">Connect with Claude Code</h3>
            <p className="text-text-dim text-sm mb-3">
              Use Claude Code CLI to build and deploy TypeScript agents directly from your terminal. Create powerful code agents with full access to the OSF platform.
            </p>
            <div className="flex gap-3">
              <a
                href="https://docs.anthropic.com/en/docs/claude-code/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-sm hover:underline"
              >
                Claude Code Docs
              </a>
              <Link
                href="/agents/code/new"
                className="text-text-muted text-sm hover:text-text transition-colors"
              >
                Deploy Code Agent
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
