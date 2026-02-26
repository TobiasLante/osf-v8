'use client';

import { safeMarkdown } from '@/lib/markdown';
import { mdClasses } from './types';

export function ReportCard({ output, reportUrl }: { output?: string | null; reportUrl?: string | null }) {
  if (!output && !reportUrl) return null;

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-4">
      <p className="text-xs font-semibold text-accent uppercase tracking-wider mb-2">
        {'\u{1F4C4}'} Report
      </p>
      {output && (
        <div className={`text-sm text-text-muted leading-relaxed ${mdClasses}`}
          dangerouslySetInnerHTML={{ __html: safeMarkdown(output) }}
        />
      )}
      {reportUrl && (
        <a
          href={reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-md bg-accent/15 border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/25 transition-colors"
        >
          {'\u{1F4CA}'} Report öffnen
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
