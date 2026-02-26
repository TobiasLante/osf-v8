"use client";

interface Session {
  id: string;
  title: string;
  created_at: string;
}

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
}: SessionSidebarProps) {
  return (
    <div className="w-64 flex-shrink-0 border-r border-border bg-bg-surface flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <button
          onClick={onNew}
          className="w-full px-4 py-2.5 rounded-sm bg-accent text-bg text-sm font-medium hover:bg-accent-hover transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sessions.length === 0 && (
          <p className="text-xs text-text-dim text-center py-8">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center rounded-sm cursor-pointer transition-colors ${
              s.id === activeSessionId
                ? "bg-accent/10 border border-accent/20"
                : "hover:bg-bg-surface-2 border border-transparent"
            }`}
          >
            <button
              onClick={() => onSelect(s.id)}
              className="flex-1 text-left px-3 py-2.5 min-w-0"
            >
              <p className="text-sm truncate">{s.title || "Untitled"}</p>
              <p className="text-[10px] text-text-dim mt-0.5">
                {new Date(s.created_at).toLocaleDateString()}
              </p>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              className="opacity-0 group-hover:opacity-100 p-1.5 mr-1 text-text-dim hover:text-red-400 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
