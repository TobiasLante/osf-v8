'use client';

import { useState, useCallback } from 'react';

export interface DataSourcesConfig {
  mtpUrls: string[];
  i3xEndpoints: string[];
  smProfileUrl: string;
}

interface DataSourcesProps {
  className?: string;
  onChange?: (config: DataSourcesConfig) => void;
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text)] hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`w-4 h-4 text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-800 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function UrlListEditor({
  urls,
  onAdd,
  onRemove,
  placeholder,
}: {
  urls: string[];
  onAdd: (url: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (trimmed) {
      onAdd(trimmed);
      setInput('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        <button
          onClick={handleAdd}
          className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-sm text-white font-medium transition-colors"
        >
          Add
        </button>
      </div>
      {urls.length > 0 && (
        <ul className="space-y-1">
          {urls.map((url, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-mono text-[var(--text)]"
            >
              <span className="truncate mr-2">{url}</span>
              <button
                onClick={() => onRemove(i)}
                className="text-red-400 hover:text-red-500 text-sm flex-shrink-0 leading-none"
                aria-label={`Remove ${url}`}
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DataSources({ className, onChange }: DataSourcesProps) {
  const [mtpUrls, setMtpUrls] = useState<string[]>([]);
  const [i3xEndpoints, setI3xEndpoints] = useState<string[]>([]);
  const [smProfileUrl, setSmProfileUrl] = useState('');

  const emitChange = useCallback(
    (mtp: string[], i3x: string[], sm: string) => {
      onChange?.({ mtpUrls: mtp, i3xEndpoints: i3x, smProfileUrl: sm });
    },
    [onChange],
  );

  const addMtp = (url: string) => {
    const next = [...mtpUrls, url];
    setMtpUrls(next);
    emitChange(next, i3xEndpoints, smProfileUrl);
  };
  const removeMtp = (i: number) => {
    const next = mtpUrls.filter((_, idx) => idx !== i);
    setMtpUrls(next);
    emitChange(next, i3xEndpoints, smProfileUrl);
  };

  const addI3x = (url: string) => {
    const next = [...i3xEndpoints, url];
    setI3xEndpoints(next);
    emitChange(mtpUrls, next, smProfileUrl);
  };
  const removeI3x = (i: number) => {
    const next = i3xEndpoints.filter((_, idx) => idx !== i);
    setI3xEndpoints(next);
    emitChange(mtpUrls, next, smProfileUrl);
  };

  const handleSmChange = (val: string) => {
    setSmProfileUrl(val);
    emitChange(mtpUrls, i3xEndpoints, val);
  };

  return (
    <div className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        Data Sources
      </h2>
      <div className="space-y-3">
        {/* MCP Servers - always visible */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <h3 className="text-sm font-medium text-[var(--text)] mb-1">MCP Servers</h3>
          <p className="text-xs text-[var(--muted)] mb-2">
            MCP servers provide raw data from databases, APIs, files.
          </p>
          <div className="rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-[var(--muted)]">
            MCP Proxy: configured via gateway
          </div>
          <p className="text-xs text-[var(--muted)] mt-2 italic">
            MCP tools are auto-discovered from the proxy.
          </p>
        </div>

        {/* MTP Modules */}
        <CollapsibleSection title="MTP Modules">
          <p className="text-xs text-[var(--muted)] mb-3">
            MTP files describe plant module structure (AutomationML).
          </p>
          <UrlListEditor
            urls={mtpUrls}
            onAdd={addMtp}
            onRemove={removeMtp}
            placeholder="https://example.com/module.mtp"
          />
        </CollapsibleSection>

        {/* i3X Endpoints */}
        <CollapsibleSection title="i3X Endpoints">
          <p className="text-xs text-[var(--muted)] mb-3">
            i3X provides typed CESMII data directly — no LLM needed.
          </p>
          <UrlListEditor
            urls={i3xEndpoints}
            onAdd={addI3x}
            onRemove={removeI3x}
            placeholder="https://i3x.example.com/api"
          />
        </CollapsibleSection>

        {/* SM Profile */}
        <CollapsibleSection title="SM Profile">
          <p className="text-xs text-[var(--muted)] mb-3">
            Optional CESMII Smart Manufacturing Profile (OPC-UA XML).
          </p>
          <input
            type="text"
            value={smProfileUrl}
            onChange={(e) => handleSmChange(e.target.value)}
            placeholder="https://example.com/sm-profile.xml"
            className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </CollapsibleSection>
      </div>
    </div>
  );
}
