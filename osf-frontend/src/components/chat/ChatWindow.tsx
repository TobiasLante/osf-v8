"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage, TypingIndicator } from "./ChatMessage";
import { streamSSE, apiFetch } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments?: Record<string, any>;
    result?: string;
    status?: "running" | "done" | "error";
  }>;
  time?: string;
}

interface ChatWindowProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}

export function ChatWindow({ sessionId, onSessionCreated }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const mainRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load session messages
  useEffect(() => {
    if (sessionId) {
      setShowWelcome(false);
      apiFetch<{ messages: any[] }>(`/chat/sessions/${sessionId}/messages`)
        .then(({ messages: msgs }) => {
          setMessages(
            msgs.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content || "",
              toolCalls: m.tool_calls || undefined,
              time: new Date(m.created_at).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }))
          );
        })
        .catch(() => {});
    } else {
      setMessages([]);
      setShowWelcome(true);
    }
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setShowWelcome(false);
    setIsLoading(true);

    const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", content: text, time }]);

    const pendingToolCalls: Message["toolCalls"] = [];
    let assistantContent = "";

    try {
      for await (const event of streamSSE("/chat/completions", {
        message: text,
        sessionId,
      })) {
        switch (event.type) {
          case "session":
            onSessionCreated(event.sessionId);
            break;

          case "tool_start":
            pendingToolCalls!.push({
              name: event.name,
              arguments: event.arguments,
              status: "running",
            });
            // Update message to show running tool
            setMessages((prev) => {
              const updated = [...prev];
              const lastAssistant = updated.findIndex(
                (m, i) => i === updated.length - 1 && m.role === "assistant"
              );
              if (lastAssistant === -1) {
                updated.push({
                  role: "assistant",
                  content: "",
                  toolCalls: [...pendingToolCalls!],
                  time,
                });
              } else {
                updated[lastAssistant] = {
                  ...updated[lastAssistant],
                  toolCalls: [...pendingToolCalls!],
                };
              }
              return updated;
            });
            break;

          case "tool_result": {
            const tc = pendingToolCalls!.find(
              (t) => t.name === event.name && t.status === "running"
            );
            if (tc) {
              tc.result = event.result;
              tc.status = "done";
            }
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  toolCalls: [...pendingToolCalls!],
                };
              }
              return updated;
            });
            break;
          }

          case "content":
            assistantContent += event.text;
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: assistantContent,
                };
              } else {
                updated.push({
                  role: "assistant",
                  content: assistantContent,
                  toolCalls: pendingToolCalls!.length > 0 ? [...pendingToolCalls!] : undefined,
                  time,
                });
              }
              return updated;
            });
            break;

          case "error":
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: `Error: ${event.message}`, time },
            ]);
            break;

          case "done":
            break;
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Connection error: ${err.message}`, time },
      ]);
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={mainRef} className="flex-1 overflow-y-auto px-6 py-5 scroll-smooth">
        {showWelcome ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-fade-in">
            {/* Welcome orb */}
            <div className="relative w-[120px] h-[120px] mb-9">
              <div className="absolute inset-[-20px] rounded-full border border-accent/25 animate-spin [animation-duration:20s]">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[5px] h-[5px] bg-accent rounded-full" />
              </div>
              <div className="absolute inset-[-40px] rounded-full border border-accent/15 animate-spin [animation-duration:30s] [animation-direction:reverse]">
                <div className="absolute bottom-[20%] right-0 w-[5px] h-[5px] bg-accent rounded-full" />
              </div>
              <div className="absolute inset-0 rounded-full bg-accent-gradient shadow-[0_0_40px_rgba(255,149,0,0.4)] animate-pulse [animation-duration:4s]">
                <div className="absolute inset-[10px] rounded-full bg-bg" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-[42px] h-[42px] text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
            </div>

            <h1 className="text-[2.2rem] font-extrabold tracking-tight mb-3.5">
              OpenShopFloor AI
            </h1>
            <p className="text-base text-text-muted max-w-[500px] mb-10">
              Chat with a real factory. Query live production data, analyze OEE,
              manage orders, and optimize operations with 111 MCP tools.
            </p>

            {/* Quick actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 max-w-[900px] w-full">
              {[
                {
                  icon: "📊",
                  title: "OEE Overview",
                  desc: "Check OEE metrics across all machines",
                  prompt: "Show me the current OEE for all machines",
                },
                {
                  icon: "📦",
                  title: "Stock Check",
                  desc: "View material stock levels and shortages",
                  prompt: "Which materials are running low?",
                },
                {
                  icon: "⚙️",
                  title: "Capacity Status",
                  desc: "Analyze machine capacity and bottlenecks",
                  prompt: "Give me the current capacity overview",
                },
              ].map((action) => (
                <button
                  key={action.title}
                  onClick={() => {
                    setInput(action.prompt);
                    setTimeout(() => {
                      handleSend();
                    }, 50);
                  }}
                  className="text-left p-6 rounded-lg border border-border bg-bg-surface hover:border-border-hover hover:-translate-y-0.5 hover:shadow-lg transition-all"
                >
                  <div className="w-10 h-10 rounded-[12px] bg-bg-surface-2 grid place-items-center text-xl mb-3.5">
                    {action.icon}
                  </div>
                  <div className="font-bold text-[15px] mb-1.5 tracking-tight">
                    {action.title}
                  </div>
                  <div className="text-xs text-text-dim leading-relaxed">
                    {action.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((msg, i) => (
              <ChatMessage
                key={i}
                role={msg.role}
                content={msg.content}
                toolCalls={msg.toolCalls}
                time={msg.time}
              />
            ))}
            {isLoading && <TypingIndicator />}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-6 py-4">
        <div className="flex items-end gap-2.5 max-w-[900px] mx-auto">
          <div className="flex-1 relative">
            <div className="absolute inset-[-2px] rounded-[16px] bg-accent-gradient opacity-0 blur-[8px] pointer-events-none transition-opacity peer-focus:opacity-15" />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about OEE, stock levels, machine status..."
              rows={1}
              className="peer w-full px-5 py-3.5 rounded-md border border-border bg-bg-surface text-text text-sm resize-none min-h-[52px] max-h-[200px] focus:outline-none focus:border-accent focus:bg-bg-surface-2 transition-colors placeholder:text-text-dim"
              style={{ height: "52px" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "52px";
                t.style.height = Math.min(t.scrollHeight, 200) + "px";
              }}
            />
          </div>
          <button
            onClick={isLoading ? undefined : handleSend}
            disabled={!input.trim() && !isLoading}
            className={`w-[52px] h-[52px] rounded-md border-none grid place-items-center transition-all ${
              isLoading
                ? "bg-red-500 cursor-pointer animate-pulse"
                : "bg-accent-gradient text-white hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            {isLoading ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                <rect x="7" y="7" width="10" height="10" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-white">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
