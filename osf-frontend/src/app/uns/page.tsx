"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { BackgroundOrbs } from "@/components/BackgroundOrbs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://osf-api.zeroguess.ai";

const FILTERS = [
  { label: "All", prefix: "" },
  { label: "CNC", prefix: "Factory/CNC-" },
  { label: "SGM", prefix: "Factory/SGM-" },
  { label: "Assembly", prefix: "Factory/Montage-" },
  { label: "Alerts", prefix: "/Alerts/" },
];

interface MqttMessage {
  topic: string;
  payload: string;
  ts: number;
}

interface TopicNode {
  name: string;
  fullTopic: string;
  value?: string;
  ts?: number;
  children: Map<string, TopicNode>;
}

function buildTree(messages: Map<string, MqttMessage>): TopicNode {
  const root: TopicNode = { name: "Factory", fullTopic: "", children: new Map() };
  for (const [topic, msg] of Array.from(messages.entries())) {
    const parts = topic.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          fullTopic: parts.slice(0, i + 1).join("/"),
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
    }
    node.value = msg.payload;
    node.ts = msg.ts;
  }
  return root;
}

function parsePayloadValue(raw: string): { display: string; unit: string; label: string } | null {
  try {
    const obj = JSON.parse(raw);
    if (obj.Value !== undefined) {
      const val = typeof obj.Value === "number" ? (Number.isInteger(obj.Value) ? String(obj.Value) : obj.Value.toFixed(2)) : String(obj.Value);
      return { display: val, unit: obj.Unit || "", label: obj.Definition || "" };
    }
  } catch {}
  return null;
}

function TopicTreeNode({
  node,
  depth = 0,
  expandedSet,
  onToggle,
}: {
  node: TopicNode;
  depth?: number;
  expandedSet: Set<string>;
  onToggle: (topic: string) => void;
}) {
  const hasChildren = node.children.size > 0;
  const expanded = expandedSet.has(node.fullTopic);
  const age = node.ts ? Math.floor((Date.now() - node.ts) / 1000) : null;
  const fresh = age !== null && age < 5;

  // Parse structured payload for inline display
  const parsed = node.value ? parsePayloadValue(node.value) : null;

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div
        className={`flex items-center gap-2 py-0.5 cursor-pointer hover:bg-bg-surface-2 rounded px-1 ${fresh ? "bg-accent/5" : ""}`}
        onClick={() => hasChildren ? onToggle(node.fullTopic) : onToggle(node.fullTopic + "::detail")}
      >
        {hasChildren ? (
          <span className="text-text-dim text-xs w-4 text-center select-none">{expanded ? "\u25BC" : "\u25B6"}</span>
        ) : (
          <span className="w-4 text-center text-text-dim text-xs select-none">&middot;</span>
        )}
        <span className={`text-xs font-mono ${!hasChildren ? "text-accent" : "text-text"}`}>
          {node.name}
        </span>
        {parsed && (
          <span className="text-xs ml-2 truncate">
            <span className={`font-mono font-semibold ${fresh ? "text-emerald-400" : "text-text-muted"}`}>
              {parsed.display}
            </span>
            {parsed.unit && <span className="text-text-dim ml-1">{parsed.unit}</span>}
            {parsed.label && <span className="text-text-dim ml-2 hidden sm:inline">{parsed.label}</span>}
          </span>
        )}
        {!parsed && node.value && !hasChildren && (
          <span className="text-xs text-text-dim ml-2 truncate max-w-xs font-mono">{node.value.slice(0, 80)}</span>
        )}
        {hasChildren && (
          <span className="text-[10px] text-text-dim ml-1">({node.children.size})</span>
        )}
        {age !== null && (
          <span className="text-[10px] text-text-dim ml-auto shrink-0">{age}s</span>
        )}
      </div>
      {/* Expandable JSON detail */}
      {!hasChildren && node.value && expandedSet.has(node.fullTopic + "::detail") && (
        <pre className="text-[11px] text-text-muted font-mono ml-8 p-2 bg-bg-surface-2 rounded mb-1 max-h-48 overflow-auto whitespace-pre-wrap">
          {(() => { try { return JSON.stringify(JSON.parse(node.value), null, 2); } catch { return node.value; } })()}
        </pre>
      )}
      {expanded &&
        Array.from(node.children.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((child) => (
            <TopicTreeNode
              key={child.fullTopic}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              onToggle={onToggle}
            />
          ))}
    </div>
  );
}

export default function UnsPage() {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState(0);
  const [connected, setConnected] = useState(false);
  const [displayMessages, setDisplayMessages] = useState<Map<string, MqttMessage>>(new Map());
  const [msgCount, setMsgCount] = useState(0);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set(["Factory"]));
  const eventSourceRef = useRef<EventSource | null>(null);
  const bufferRef = useRef<Map<string, MqttMessage>>(new Map());
  const msgCountRef = useRef(0);

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  const onToggle = useCallback((topic: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnected(false);
    bufferRef.current = new Map();
    msgCountRef.current = 0;
    setDisplayMessages(new Map());
    setMsgCount(0);

    const es = new EventSource(`${API_BASE}/uns/stream?filter=${encodeURIComponent("Factory/#")}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "connected") {
          setConnected(true);
          return;
        }
        bufferRef.current.set(data.topic, data);
        msgCountRef.current++;
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  // Batch updates every 2s to avoid constant re-renders
  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current.size > 0) {
        setDisplayMessages(new Map(bufferRef.current));
        setMsgCount(msgCountRef.current);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!loading && token) {
      const cleanup = connect();
      return cleanup;
    }
  }, [loading, token, connect]);

  // Auto-expand first 2 levels when new machines appear
  useEffect(() => {
    if (displayMessages.size > 0) {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        for (const topic of Array.from(displayMessages.keys())) {
          const parts = topic.split("/");
          // Auto-expand first 2 levels (Factory, Factory/CNC-01, etc.)
          if (parts.length >= 1) next.add(parts[0]);
          if (parts.length >= 2) next.add(parts.slice(0, 2).join("/"));
        }
        return next;
      });
    }
  }, [displayMessages]);

  if (loading || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  // Client-side filter: filter messages by active prefix
  const activePrefix = FILTERS[activeFilter].prefix;
  const filteredMessages = activePrefix
    ? new Map(
        Array.from(displayMessages.entries()).filter(([topic]) =>
          activePrefix.startsWith("/")
            ? topic.includes(activePrefix)
            : topic.startsWith(activePrefix)
        )
      )
    : displayMessages;

  const tree = buildTree(filteredMessages);

  return (
    <div className="min-h-screen bg-bg relative">
      <BackgroundOrbs />
      <div className="relative z-10 max-w-7xl mx-auto px-4 pt-8 pb-16">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">
            #shared.UNS{" "}
            <span className="bg-accent-gradient bg-clip-text text-transparent">Live</span>
          </h1>
          <p className="text-sm text-text-muted">
            Real-time MQTT topic explorer &mdash; browse machine data, sensor values, and alerts
            as they flow through the factory&apos;s #shared.UnifiedNameSpace.
          </p>
        </div>

        {/* Status bar + Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <span className="text-xs text-text-muted">{connected ? "Connected" : "Connecting..."}</span>
          </div>
          <span className="text-border">|</span>
          <span className="text-xs text-text-dim">{filteredMessages.size} topics{activePrefix ? ` (${displayMessages.size} total)` : ""}</span>
          <span className="text-xs text-text-dim">{msgCount} messages</span>
          <div className="flex-1" />
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setActiveFilter(i)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeFilter === i
                  ? "bg-accent text-bg"
                  : "border border-border bg-bg-surface text-text-muted hover:border-accent/30"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Topic Tree */}
        <div className="rounded-md border border-border bg-bg-surface p-4 min-h-[500px] max-h-[calc(100vh-280px)] overflow-auto">
          {filteredMessages.size === 0 ? (
            <div className="flex items-center justify-center h-64 text-text-dim text-sm">
              {!connected ? "Connecting to MQTT broker..." : displayMessages.size === 0 ? "Waiting for messages..." : "No topics match this filter"}
            </div>
          ) : (
            Array.from(tree.children.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((child) => (
                <TopicTreeNode
                  key={child.fullTopic}
                  node={child}
                  depth={0}
                  expandedSet={expandedSet}
                  onToggle={onToggle}
                />
              ))
          )}
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">Protocol</div>
            <div className="text-xs text-text-muted">MQTT 3.1.1 via Mosquitto. Gateway subscribes server-side and streams via SSE.</div>
          </div>
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">Topic Structure</div>
            <div className="text-xs text-text-muted font-mono">Factory/&#123;Machine&#125;/&#123;Order&#125;/&#123;Step&#125;/&#123;Category&#125;/&#123;Metric&#125;</div>
          </div>
          <div className="p-4 rounded-md border border-border bg-bg-surface">
            <div className="text-xs font-semibold text-text mb-1">AI Integration</div>
            <div className="text-xs text-text-muted">8 #shared.UNS MCP tools let agents subscribe, query, and compare live data.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
