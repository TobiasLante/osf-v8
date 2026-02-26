import Link from "next/link";

interface Session {
  id: string;
  title: string;
  created_at: string;
}

interface RecentChatsSectionProps {
  sessions: Session[];
}

export function RecentChatsSection({ sessions }: RecentChatsSectionProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent Chats</h2>
        <Link
          href="/chat"
          className="text-xs text-accent hover:text-accent-hover transition-colors"
        >
          View all
        </Link>
      </div>
      {sessions.length === 0 ? (
        <div className="bg-bg-surface border border-border rounded-md p-6 text-center">
          <p className="text-sm text-text-muted mb-2">No chats yet</p>
          <Link
            href="/chat"
            className="text-sm text-accent hover:text-accent-hover"
          >
            Start a conversation
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/chat?session=${session.id}`}
              className="flex items-center gap-3 bg-bg-surface border border-border rounded-sm p-3 hover:border-border-hover transition-colors"
            >
              <span className="text-lg text-text-dim">{"\u{1F4AC}"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  {session.title || "Untitled"}
                </p>
                <p className="text-xs text-text-dim">
                  {new Date(session.created_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
