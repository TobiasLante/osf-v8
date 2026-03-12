"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChatMessage, TypingIndicator } from "./ChatMessage";
import { streamSSE, apiFetch } from "@/lib/api";
import { V7Event } from "./v7/types";
import { KGNode, KGEdge } from "./KGCascadeInline";

export interface KGState {
  nodes: KGNode[];
  edges: KGEdge[];
  centerEntityId?: string;
  status: "traversing" | "done";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments?: Record<string, any>;
    result?: string;
    status?: "running" | "done" | "error";
  }>;
  kgData?: KGState;
  v7Events?: V7Event[];
  time?: string;
}

interface ChatWindowProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}

/* ─── Entity autocomplete types ──────────────────────────────────────── */

interface EntityItem {
  id: string;
  label: string;
  type: "Machine" | "Article" | "Order" | "Customer" | "Material";
}

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  Machine: { label: "Maschine", color: "text-orange-400 bg-orange-400/10" },
  Article: { label: "Artikel", color: "text-blue-400 bg-blue-400/10" },
  Order: { label: "Auftrag", color: "text-emerald-400 bg-emerald-400/10" },
  Customer: { label: "Kunde", color: "text-cyan-400 bg-cyan-400/10" },
  Material: { label: "Material", color: "text-purple-400 bg-purple-400/10" },
};

// Words that trigger autocomplete (German + English)
const TRIGGER_WORDS = [
  "maschine", "machine", "anlage",
  "artikel", "article", "teil", "part",
  "auftrag", "order", "bestellung",
  "kunde", "customer", "partner",
  "material", "werkstoff", "rohstoff",
  "werkzeug", "tool",
  "oee", "kapazit",
];

// Prefixes that directly trigger autocomplete
const ENTITY_PREFIXES = [
  "SGM-", "CNC-", "DRH-", "FRS-", "SGF-", "BZ-", "MTG-",
  "ART-", "FA-", "KD-", "WKZ-", "MAT-",
];

const MAX_HISTORY = 10;

export function ChatWindow({ sessionId, onSessionCreated }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const mainRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ─── Message history (arrow up/down) ───────────────────────────────
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const savedInput = useRef("");

  // ─── Autocomplete ─────────────────────────────────────────────────
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [suggestions, setSuggestions] = useState<EntityItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Load entities on mount
  useEffect(() => {
    apiFetch<{ entities: EntityItem[] }>("/chat/entities")
      .then(({ entities }) => setEntities(entities))
      .catch(() => {});
  }, []);

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

  // ─── Autocomplete matching ──────────────────────────────────────────
  const computeSuggestions = useCallback(
    (text: string) => {
      if (!text || entities.length === 0) {
        setShowSuggestions(false);
        return;
      }

      // Get the last word/token being typed
      const words = text.split(/\s+/);
      const lastWord = words[words.length - 1];
      if (!lastWord || lastWord.length < 2) {
        setShowSuggestions(false);
        return;
      }

      const lw = lastWord.toLowerCase();

      // Check 1: Direct prefix match (e.g. "SGM-", "CNC-0")
      const prefixMatch = ENTITY_PREFIXES.some(
        (p) => lw.startsWith(p.toLowerCase()) || p.toLowerCase().startsWith(lw)
      );

      // Check 2: Trigger word anywhere in the current input
      const textLower = text.toLowerCase();
      const triggerMatch = TRIGGER_WORDS.some((tw) => textLower.includes(tw));

      if (!prefixMatch && !triggerMatch) {
        setShowSuggestions(false);
        return;
      }

      // Filter entities matching the last word
      const matches = entities.filter((e) => {
        const idLower = e.id.toLowerCase();
        const labelLower = e.label.toLowerCase();
        return idLower.includes(lw) || labelLower.includes(lw) || lw.includes(idLower);
      });

      // If trigger word matched but no direct entity match on last word,
      // show entities of the matching type
      if (matches.length === 0 && triggerMatch && !prefixMatch) {
        const typeMap: Record<string, string> = {
          maschine: "Machine", machine: "Machine", anlage: "Machine",
          artikel: "Article", article: "Article", teil: "Article", part: "Article",
          auftrag: "Order", order: "Order", bestellung: "Order",
          kunde: "Customer", customer: "Customer", partner: "Customer",
          material: "Material", werkstoff: "Material", rohstoff: "Material",
          werkzeug: "Material", tool: "Material",
        };
        const matchedTrigger = TRIGGER_WORDS.find((tw) => textLower.includes(tw));
        const targetType = matchedTrigger ? typeMap[matchedTrigger] : null;
        if (targetType) {
          const typeMatches = entities
            .filter((e) => e.type === targetType)
            .slice(0, 8);
          if (typeMatches.length > 0) {
            setSuggestions(typeMatches);
            setSelectedSuggestion(0);
            setShowSuggestions(true);
            return;
          }
        }
      }

      if (matches.length > 0 && matches.length <= 12) {
        setSuggestions(matches.slice(0, 8));
        setSelectedSuggestion(0);
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    },
    [entities]
  );

  // ─── Apply suggestion ──────────────────────────────────────────────
  const applySuggestion = useCallback(
    (entity: EntityItem) => {
      const words = input.split(/\s+/);
      words[words.length - 1] = entity.id;
      setInput(words.join(" ") + " ");
      setShowSuggestions(false);
      inputRef.current?.focus();
    },
    [input]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // Push to history
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== text);
      return [text, ...filtered].slice(0, MAX_HISTORY);
    });
    setHistoryIdx(-1);
    savedInput.current = "";

    setInput("");
    setShowWelcome(false);
    setShowSuggestions(false);
    setIsLoading(true);

    const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", content: text, time }]);

    const pendingToolCalls: Message["toolCalls"] = [];
    let assistantContent = "";
    let kgState: KGState | undefined;
    const v7Events: V7Event[] = [];

    // Helper: upsert the last assistant message
    const upsertAssistant = (patch: Partial<Message>) => {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, ...patch };
        } else {
          updated.push({
            role: "assistant",
            content: patch.content ?? "",
            toolCalls: patch.toolCalls,
            kgData: patch.kgData,
            v7Events: patch.v7Events,
            time,
          });
        }
        return updated;
      });
    };

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
            upsertAssistant({ toolCalls: [...pendingToolCalls!] });
            break;

          case "tool_result": {
            const tc = pendingToolCalls!.find(
              (t) => t.name === event.name && t.status === "running"
            );
            if (tc) {
              tc.result = event.result;
              tc.status = "done";
            }
            upsertAssistant({ toolCalls: [...pendingToolCalls!] });
            break;
          }

          case "content":
            assistantContent += event.text;
            upsertAssistant({
              content: assistantContent,
              toolCalls: pendingToolCalls!.length > 0 ? [...pendingToolCalls!] : undefined,
            });
            break;

          /* ── KG traversal events ────────────────────────────────── */
          case "kg_traversal_start":
            kgState = {
              nodes: [],
              edges: [],
              centerEntityId: event.centerEntityId || event.entityId,
              status: "traversing",
            };
            upsertAssistant({ kgData: { ...kgState } });
            break;

          case "kg_nodes_discovered": {
            if (!kgState) {
              kgState = { nodes: [], edges: [], status: "traversing" };
            }
            const newNodes: KGNode[] = (event.nodes || []).map((n: any) => ({
              id: n.id,
              label: n.label || n.id,
              type: n.type || "Entity",
            }));
            const newEdges: KGEdge[] = (event.edges || []).map((e: any) => ({
              from: e.from || e.source,
              to: e.to || e.target,
              label: e.label || e.type || "",
            }));
            kgState.nodes = [...kgState.nodes, ...newNodes];
            kgState.edges = [...kgState.edges, ...newEdges];
            upsertAssistant({ kgData: { ...kgState } });
            break;
          }

          case "kg_traversal_end":
            if (kgState) {
              kgState.status = "done";
              upsertAssistant({ kgData: { ...kgState } });
            }
            break;

          /* ── V7 intent/specialist/discussion events ─────────────── */
          case "intent_classification":
          case "specialists_planned":
          case "specialist_start":
          case "specialist_complete":
          case "specialist_error":
          case "specialists_batch_start":
          case "specialists_batch_complete":
          case "discussion_round_start":
          case "discussion_question":
          case "discussion_answer":
          case "discussion_recruit":
          case "discussion_recruit_result":
          case "discussion_round_complete":
          case "discussion_synthesis_start":
          case "debate_start":
          case "debate_draft":
          case "debate_critique":
          case "debate_final":
          case "plan":
          case "step_start":
          case "step_complete":
          case "step_error":
          case "thinking":
          case "tool_call_start":
          case "tool_call_end":
          case "intermediate_result":
          case "init":
            v7Events.push(event as V7Event);
            upsertAssistant({ v7Events: [...v7Events] });
            break;

          /* ── Ignored ────────────────────────────────────────────── */
          case "heartbeat":
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
    // ─── Suggestion navigation ───────────────────────────────────
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }

    // ─── Message history (arrow up/down when no suggestions) ─────
    if (e.key === "ArrowUp" && !e.shiftKey && !showSuggestions) {
      // Only activate if cursor is at start of input
      const textarea = inputRef.current;
      if (textarea && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        if (history.length === 0) return;
        if (historyIdx === -1) {
          savedInput.current = input;
        }
        const newIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
      return;
    }
    if (e.key === "ArrowDown" && !e.shiftKey && !showSuggestions) {
      const textarea = inputRef.current;
      if (textarea && textarea.selectionStart === input.length) {
        e.preventDefault();
        if (historyIdx <= 0) {
          setHistoryIdx(-1);
          setInput(savedInput.current);
          return;
        }
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx]);
      }
      return;
    }

    // ─── Send on Enter ───────────────────────────────────────────
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setHistoryIdx(-1);
    computeSuggestions(val);
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
                  icon: "\u{1F4CA}",
                  title: "OEE Overview",
                  desc: "Check OEE metrics across all machines",
                  prompt: "Show me the current OEE for all machines",
                },
                {
                  icon: "\u{1F4E6}",
                  title: "Stock Check",
                  desc: "View material stock levels and shortages",
                  prompt: "Which materials are running low?",
                },
                {
                  icon: "\u2699\uFE0F",
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
                kgData={msg.kgData}
                v7Events={msg.v7Events}
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

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-border bg-bg-surface shadow-lg overflow-hidden z-50"
              >
                {suggestions.map((s, i) => {
                  const badge = TYPE_BADGES[s.type] || { label: s.type, color: "text-text-dim bg-bg-surface-2" };
                  return (
                    <button
                      key={`${s.type}-${s.id}`}
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent blur
                        applySuggestion(s);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                        i === selectedSuggestion
                          ? "bg-accent/10 text-text"
                          : "text-text-muted hover:bg-bg-surface-2"
                      }`}
                    >
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="font-mono text-[13px]">{s.id}</span>
                      {s.label !== s.id && (
                        <span className="text-xs text-text-dim truncate">{s.label}</span>
                      )}
                    </button>
                  );
                })}
                <div className="px-3 py-1 border-t border-border/50 text-[10px] text-text-dim">
                  <kbd className="px-1 py-0.5 rounded bg-bg-surface-2 text-[10px]">Tab</kbd> or <kbd className="px-1 py-0.5 rounded bg-bg-surface-2 text-[10px]">Enter</kbd> to select &middot; <kbd className="px-1 py-0.5 rounded bg-bg-surface-2 text-[10px]">Esc</kbd> to dismiss
                </div>
              </div>
            )}

            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // Delay to allow click on suggestion
                setTimeout(() => setShowSuggestions(false), 150);
              }}
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
