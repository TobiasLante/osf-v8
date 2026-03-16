'use client';

/**
 * Chat page — embeds the full chat.html SPA (from v8) in an iframe.
 * chat.html is self-contained in /public/chat.html with its own CSS.
 * API calls use relative paths (/api/chat/completions etc.) and are
 * proxied through the gateway.
 */
export default function ChatPage() {
  const apiBase = process.env.NEXT_PUBLIC_GATEWAY_URL || '';

  // If gateway URL is set, pass it as a query param so chat.html can use it
  const src = apiBase ? `/chat.html?api=${encodeURIComponent(apiBase)}` : '/chat.html';

  return (
    <div className="h-screen w-full">
      <iframe
        src={src}
        className="w-full h-full border-0"
        allow="clipboard-write"
        title="ZeroGuess AI Chat"
      />
    </div>
  );
}
