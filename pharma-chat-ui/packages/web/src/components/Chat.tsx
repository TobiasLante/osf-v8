"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLlmConfig, sendChat, getTools } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallUI[];
}

interface ToolCallUI {
  name: string;
  args?: Record<string, any>;
  result?: string;
  status: "running" | "done" | "error";
}

interface ChatProps {
  externalPrompt: string | null;
  onPromptConsumed: () => void;
  onProcessMap?: (steps: any[]) => void;
}

export function Chat({ externalPrompt, onPromptConsumed, onProcessMap }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load tool count on mount
  useEffect(() => {
    getTools()
      .then(tools => setToolCount(Array.isArray(tools) ? tools.length : 0))
      .catch(e => setToolsError(`Could not reach gateway: ${e.message}`));
  }, []);

  // Cleanup SSE stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const config = loadLlmConfig();
    if (!config.apiKey) {
      setMessages(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "Please add your API key in [Settings](/settings) first." },
      ]);
      return;
    }

    // Abort previous stream if running
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setInput("");
    setIsLoading(true);

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    const pendingToolCalls: ToolCallUI[] = [];
    let assistantContent = "";

    const updateAssistant = () => {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: assistantContent,
            toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
          };
        } else {
          updated.push({
            role: "assistant",
            content: assistantContent,
            toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
          });
        }
        return updated;
      });
    };

    try {
      const history = newMessages.map(m => ({ role: m.role, content: m.content }));
      await sendChat(history, {
        onToolStart: (name, args) => {
          pendingToolCalls.push({ name, args, status: "running" });
          updateAssistant();
        },
        onToolResult: (name, content) => {
          const tc = pendingToolCalls.find(t => t.name === name && t.status === "running");
          if (tc) {
            tc.result = content;
            tc.status = content.startsWith("Error:") ? "error" : "done";
          }
          // Extract process map data from tool results
          if (name === "pharma_process_map" && onProcessMap) {
            try {
              const parsed = JSON.parse(content);
              const results = parsed.results || parsed;
              if (Array.isArray(results) && results.length > 0 && results[0].step) {
                onProcessMap(results);
              }
            } catch { /* not JSON, skip */ }
          }
          updateAssistant();
        },
        onContent: (text) => {
          assistantContent += text;
          updateAssistant();
        },
        onError: (error) => {
          setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error}` }]);
        },
        onDone: () => {
          // Final state already set via onContent
        },
      }, controller.signal);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: "assistant", content: `Connection error: ${err.message}` }]);
      }
    }

    setIsLoading(false);
    inputRef.current?.focus();
  }, [messages, isLoading]);

  // Handle external prompt from quick actions
  useEffect(() => {
    if (externalPrompt && !isLoading) {
      handleSend(externalPrompt);
      onPromptConsumed();
    }
  }, [externalPrompt, isLoading, handleSend, onPromptConsumed]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-2xl mb-6 shadow-lg shadow-cyan-500/20">
              P1
            </div>
            <h2 className="text-xl font-bold mb-2">Process1st Intelligence</h2>
            <p className="text-p1-muted text-sm max-w-md">
              Ask about accounts, vendor positions, process templates, or prepare for customer meetings.
              {toolCount > 0 && <span className="text-p1-accent"> {toolCount} tools available.</span>}
            </p>
            {toolsError && (
              <p className="text-amber-400 text-xs mt-3">{toolsError}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            {isLoading && (
              <div className="flex gap-1.5 px-4 py-3">
                <span className="w-2 h-2 rounded-full bg-p1-accent animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 rounded-full bg-p1-accent animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 rounded-full bg-p1-accent animate-bounce [animation-delay:300ms]" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-p1-border px-5 py-3">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          {messages.length > 0 && (
            <button
              onClick={() => { abortRef.current?.abort(); setMessages([]); setIsLoading(false); }}
              className="w-[48px] h-[48px] rounded-lg border border-p1-border text-p1-dim hover:text-p1-text hover:border-p1-accent/40 grid place-items-center transition-colors"
              aria-label="Clear chat"
              title="Clear chat"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about accounts, vendors, processes..."
            rows={1}
            className="flex-1 px-4 py-3 rounded-lg border border-p1-border bg-p1-surface text-p1-text text-sm resize-none min-h-[48px] max-h-[160px] focus:outline-none focus:border-p1-accent transition-colors placeholder:text-p1-dim"
            style={{ height: "48px" }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "48px";
              t.style.height = Math.min(t.scrollHeight, 160) + "px";
            }}
          />
          <button
            onClick={() => handleSend(input)}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="w-[48px] h-[48px] rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white grid place-items-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
        isUser
          ? "bg-p1-accent/15 border border-p1-accent/20 text-p1-text"
          : "bg-p1-surface border border-p1-border text-p1-text"
      }`}>
        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {message.toolCalls.map((tc, i) => (
              <div key={i} className="text-xs rounded bg-p1-bg/50 px-2.5 py-1.5 border border-p1-border/50">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                  tc.status === "running" ? "bg-amber-400 animate-pulse" :
                  tc.status === "done" ? "bg-emerald-400" : "bg-red-400"
                }`} />
                <span className="text-p1-accent font-mono">{tc.name}</span>
                {tc.status === "done" && tc.result && (
                  <span className="text-p1-dim ml-2">
                    ({tc.result.length > 80 ? tc.result.slice(0, 80) + "..." : tc.result})
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Content with basic markdown */}
        {message.content && (
          <div
            className="chat-markdown text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(message.content) }}
          />
        )}
      </div>
    </div>
  );
}

// ── Very simple markdown → HTML (no deps) ──

function simpleMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      if (/^https?:\/\//.test(url) || url.startsWith('/')) {
        return `<a href="${url}" class="text-p1-accent hover:underline" rel="noopener">${label}</a>`;
      }
      return `${label} (${url})`;
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  html = html.replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>');
  html = `<p>${html}</p>`;
  html = html.replace(/<p><\/p>/g, '');

  return html;
}
