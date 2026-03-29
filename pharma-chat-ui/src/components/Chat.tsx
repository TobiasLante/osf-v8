"use client";

import { useEffect, useRef, useState } from "react";
import { loadLlmConfig, mcpListTools, chatWithLlm, McpTool, StreamCallbacks } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  name: string;
  args?: Record<string, any>;
  result?: string;
  status: "running" | "done" | "error";
}

interface ChatProps {
  externalPrompt: string | null;
  onPromptConsumed: () => void;
}

export function Chat({ externalPrompt, onPromptConsumed }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load MCP tools on mount
  useEffect(() => {
    mcpListTools()
      .then(setTools)
      .catch(e => setToolsError(`Could not reach MCP server: ${e.message}`));
  }, []);

  // Handle external prompt from quick actions
  useEffect(() => {
    if (externalPrompt && !isLoading) {
      sendMessage(externalPrompt);
      onPromptConsumed();
    }
  }, [externalPrompt]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendMessage = async (text: string) => {
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

    setInput("");
    setIsLoading(true);

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    const pendingToolCalls: ToolCall[] = [];
    let assistantContent = "";

    const callbacks: StreamCallbacks = {
      onToolStart: (name, args) => {
        pendingToolCalls.push({ name, args, status: "running" });
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, toolCalls: [...pendingToolCalls] };
          } else {
            updated.push({ role: "assistant", content: "", toolCalls: [...pendingToolCalls] });
          }
          return updated;
        });
      },
      onToolResult: (name, result) => {
        const tc = pendingToolCalls.find(t => t.name === name && t.status === "running");
        if (tc) { tc.result = result; tc.status = "done"; }
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, toolCalls: [...pendingToolCalls] };
          }
          return updated;
        });
      },
      onContent: (text) => {
        assistantContent += text;
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: assistantContent };
          } else {
            updated.push({
              role: "assistant",
              content: assistantContent,
              toolCalls: pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined,
            });
          }
          return updated;
        });
      },
      onError: (msg) => {
        setMessages(prev => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
      },
    };

    try {
      const history = newMessages.map(m => ({ role: m.role, content: m.content }));
      await chatWithLlm(history, tools, config, callbacks);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Connection error: ${err.message}` }]);
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
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
              {tools.length > 0 && <span className="text-p1-accent"> {tools.length} tools available.</span>}
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
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
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
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-p1-accent hover:underline">$1</a>')
    // Line breaks → paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap list items
  html = html.replace(/(<li>[\s\S]*<\/li>)/g, '<ul>$1</ul>');
  // Wrap in paragraph
  html = `<p>${html}</p>`;
  // Clean empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  return html;
}
