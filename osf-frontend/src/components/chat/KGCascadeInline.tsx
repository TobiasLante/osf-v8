"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* ─── Types ──────────────────────────────────────────────────────────── */

export interface KGNode {
  id: string;
  label: string;
  type: string;
}

export interface KGEdge {
  from: string;
  to: string;
  label: string;
}

export interface KGCascadeInlineProps {
  nodes: KGNode[];
  edges: KGEdge[];
  centerEntityId?: string;
  status: "traversing" | "done";
}

/* ─── Color map (same as i3x page) ───────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  Machine: "#ff9500",
  Article: "#3b82f6",
  Order: "#10b981",
  Customer: "#06b6d4",
  Tool: "#eab308",
  Alternative: "#22c55e",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || "#8b5cf6";
}

/* ─── Auto-layout: BFS from center → radial rings ────────────────────── */

interface LayoutNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  color: string;
  delay: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  label: string;
  delay: number;
  dashed: boolean;
}

function computeLayout(
  nodes: KGNode[],
  edges: KGEdge[],
  centerId?: string
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[]; viewBox: string } {
  if (nodes.length === 0) {
    return { layoutNodes: [], layoutEdges: [], viewBox: "0 0 800 320" };
  }

  // Build adjacency (undirected for BFS)
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }

  // BFS from center
  const center = centerId && adj.has(centerId) ? centerId : nodes[0].id;
  const depth = new Map<string, number>();
  const queue = [center];
  depth.set(center, 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const nb of adj.get(cur) || []) {
      if (!depth.has(nb)) {
        depth.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }

  // Assign depth to any unreachable nodes
  for (const n of nodes) {
    if (!depth.has(n.id)) depth.set(n.id, 999);
  }

  // Group by depth
  const rings = new Map<number, KGNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(n);
  }

  const CX = 400;
  const CY = 50;
  const RING_SPACING = 100;

  const layoutNodes: LayoutNode[] = [];

  for (const [d, nodesInRing] of rings) {
    if (d === 0) {
      // Center node
      for (const n of nodesInRing) {
        layoutNodes.push({
          id: n.id,
          label: n.label,
          type: n.type,
          x: CX,
          y: CY,
          color: nodeColor(n.type),
          delay: 0,
        });
      }
    } else {
      const count = nodesInRing.length;
      // Spread across a horizontal arc below center
      const radius = d * RING_SPACING;
      const startAngle = Math.PI * 0.2; // ~35 degrees from top
      const endAngle = Math.PI * 0.8; // ~145 degrees from top
      nodesInRing.forEach((n, i) => {
        const angle =
          count === 1
            ? (startAngle + endAngle) / 2
            : startAngle + ((endAngle - startAngle) * i) / (count - 1);
        layoutNodes.push({
          id: n.id,
          label: n.label,
          type: n.type,
          x: CX + radius * Math.cos(angle - Math.PI / 2),
          y: CY + radius * Math.sin(angle - Math.PI / 2) + radius * 0.3,
          color: nodeColor(n.type),
          delay: d * 400,
        });
      });
    }
  }

  // Build delay map for edges
  const nodeDelayMap = new Map<string, number>();
  for (const ln of layoutNodes) nodeDelayMap.set(ln.id, ln.delay);

  const layoutEdges: LayoutEdge[] = edges.map((e) => {
    const srcDelay = nodeDelayMap.get(e.from) ?? 0;
    const isAlternative = e.label === "ALTERNATIVE" || e.label === "CAN_REPLACE";
    return {
      from: e.from,
      to: e.to,
      label: e.label,
      delay: srcDelay + 100,
      dashed: isAlternative,
    };
  });

  // Compute viewBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of layoutNodes) {
    minX = Math.min(minX, n.x - 40);
    maxX = Math.max(maxX, n.x + 40);
    minY = Math.min(minY, n.y - 40);
    maxY = Math.max(maxY, n.y + 40);
  }
  const pad = 30;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;
  const viewBox = `${Math.round(vbX)} ${Math.round(vbY)} ${Math.round(vbW)} ${Math.round(vbH)}`;

  return { layoutNodes, layoutEdges, viewBox };
}

/* ─── Component ──────────────────────────────────────────────────────── */

export function KGCascadeInline({ nodes, edges, centerEntityId, status }: KGCascadeInlineProps) {
  const [time, setTime] = useState(0);
  const animRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const { layoutNodes, layoutEdges, viewBox } = computeLayout(nodes, edges, centerEntityId);

  // Auto-start animation on mount
  useEffect(() => {
    startRef.current = performance.now();
    function tick() {
      const elapsed = performance.now() - startRef.current;
      setTime(elapsed);
      if (elapsed < 4000) {
        animRef.current = requestAnimationFrame(tick);
      }
    }
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const getNodePos = useCallback(
    (id: string) => {
      const n = layoutNodes.find((n) => n.id === id);
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    },
    [layoutNodes]
  );

  if (layoutNodes.length === 0) return null;

  return (
    <div className="my-2 rounded-md border border-border bg-bg-surface overflow-hidden" style={{ maxHeight: 320 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-bg-surface-2">
        <span className={`w-2 h-2 rounded-full ${status === "traversing" ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
        <span className="text-[11px] font-medium text-text-muted">
          Knowledge Graph — {layoutNodes.length} nodes, {layoutEdges.length} edges
        </span>
      </div>

      {/* SVG Canvas */}
      <svg viewBox={viewBox} className="w-full h-auto" style={{ maxHeight: 280 }}>
        {/* Edges */}
        {layoutEdges.map((edge) => {
          const from = getNodePos(edge.from);
          const to = getNodePos(edge.to);
          const visible = time >= edge.delay;
          const progress = Math.min(1, Math.max(0, (time - edge.delay) / 300));
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={from.x + (to.x - from.x) * progress}
                y2={from.y + (to.y - from.y) * progress}
                stroke={edge.dashed ? "#22c55e" : "var(--text-dim)"}
                strokeWidth={1.5}
                strokeDasharray={edge.dashed ? "6 4" : "none"}
                opacity={visible ? 0.6 : 0}
              />
              {progress >= 1 && (
                <text
                  x={midX}
                  y={midY - 6}
                  textAnchor="middle"
                  className="text-[7px] fill-[var(--text-dim)]"
                  opacity={0.5}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {layoutNodes.map((node) => {
          const visible = time >= node.delay;
          const scale = visible ? Math.min(1, (time - node.delay) / 200) : 0;
          const isCenter = node.id === centerEntityId;
          const isAlt = node.type === "Alternative";

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y}) scale(${scale})`}
              style={{ transformOrigin: `${node.x}px ${node.y}px` }}
            >
              {/* Glow for center */}
              {visible && isCenter && (
                <circle r={30} fill={node.color} opacity={0.1}>
                  <animate attributeName="r" values="30;36;30" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.1;0.2;0.1" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Circle */}
              <circle
                r={isCenter ? 26 : 22}
                fill={`${node.color}20`}
                stroke={node.color}
                strokeWidth={isAlt ? 1.5 : 2}
                strokeDasharray={isAlt ? "4 3" : "none"}
              />
              {/* Label */}
              <text textAnchor="middle" dy={-3} className="text-[8px] font-semibold" fill={node.color}>
                {node.label}
              </text>
              <text textAnchor="middle" dy={9} className="text-[7px]" fill="var(--text-dim)">
                {node.type}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
