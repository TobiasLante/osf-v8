"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { zoom as d3Zoom, zoomIdentity } from "d3-zoom";
import { select } from "d3-selection";
import { drag as d3Drag } from "d3-drag";

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

/* ─── Color map ──────────────────────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  Machine: "#ff9500",
  Sensor: "#f59e0b",
  Article: "#3b82f6",
  Order: "#10b981",
  Customer: "#06b6d4",
  Tool: "#eab308",
  Alternative: "#22c55e",
  Process: "#a855f7",
  Material: "#ec4899",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] || "#8b5cf6";
}

/* ─── Simulation types ───────────────────────────────────────────────── */

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  color: string;
  radius: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  label: string;
  dashed: boolean;
}

/* ─── Component ──────────────────────────────────────────────────────── */

export function KGCascadeInline({
  nodes,
  edges,
  centerEntityId,
  status,
}: KGCascadeInlineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [, forceRender] = useState(0);

  // Collect unique types for filter buttons
  const nodeTypes = ["All", ...Array.from(new Set(nodes.map((n) => n.type))).sort()];

  // Filter nodes and edges
  const filteredNodes =
    activeFilter === "All"
      ? nodes
      : nodes.filter((n) => n.type === activeFilter);
  const filteredIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (e) => filteredIds.has(e.from) && filteredIds.has(e.to)
  );

  // Build simulation data
  const buildSimData = useCallback(() => {
    const simNodes: SimNode[] = filteredNodes.map((n) => {
      const isCenter = n.id === centerEntityId;
      return {
        id: n.id,
        label: n.label,
        type: n.type,
        color: nodeColor(n.type),
        radius: isCenter ? 28 : 20,
        ...(isCenter ? { fx: 0, fy: 0 } : {}),
      };
    });

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = filteredEdges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({
        source: e.from,
        target: e.to,
        label: e.label,
        dashed:
          e.label === "ALTERNATIVE" ||
          e.label === "CAN_REPLACE" ||
          e.label === "SIMILAR_TO",
      }));

    return { simNodes, simLinks };
  }, [filteredNodes, filteredEdges, centerEntityId]);

  // Setup force simulation + zoom + drag
  useEffect(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g || filteredNodes.length === 0) return;

    const { simNodes, simLinks } = buildSimData();
    const W = svg.clientWidth || 800;
    const H = svg.clientHeight || 500;

    // Force simulation
    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<SimNode>().radius((d) => d.radius + 8))
      .alphaDecay(0.02);

    simRef.current = sim;

    // D3 zoom
    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        select(g).attr("transform", event.transform.toString());
      });

    const svgSel = select(svg);
    svgSel.call(zoomBehavior);

    // Initial zoom to fit
    const initialScale = Math.min(W, H) / 400;
    svgSel.call(
      zoomBehavior.transform,
      zoomIdentity.translate(W / 2, H / 2).scale(initialScale)
    );

    // D3 drag
    const dragBehavior = d3Drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        // Keep center node pinned, release others
        if (d.id !== centerEntityId) {
          d.fx = null;
          d.fy = null;
        }
      });

    // Bindnodes
    const nodeGroups = select(g)
      .selectAll<SVGGElement, SimNode>("g.kg-node")
      .data(simNodes, (d) => d.id);

    nodeGroups.exit().remove();

    const enter = nodeGroups
      .enter()
      .append("g")
      .attr("class", "kg-node")
      .style("cursor", "grab");

    // Node circle
    enter
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => `${d.color}20`)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2);

    // Node label
    enter
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", -4)
      .attr("font-size", "9px")
      .attr("font-weight", "600")
      .attr("fill", (d) => d.color)
      .text((d) => d.label);

    // Node type
    enter
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 10)
      .attr("font-size", "7px")
      .attr("fill", "var(--text-dim)")
      .text((d) => d.type);

    const merged = enter.merge(nodeGroups);
    merged.call(dragBehavior);

    // Click handler
    merged.on("click", (_event, d) => {
      setSelectedNode((prev) => (prev?.id === d.id ? null : d));
    });

    // Bind links
    const linkGroups = select(g)
      .selectAll<SVGLineElement, SimLink>("line.kg-link")
      .data(simLinks, (d) => `${(d.source as SimNode).id || d.source}-${(d.target as SimNode).id || d.target}`);

    linkGroups.exit().remove();

    const linkEnter = linkGroups
      .enter()
      .append("line")
      .attr("class", "kg-link")
      .attr("stroke", (d) => (d.dashed ? "#22c55e" : "var(--text-dim)"))
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", (d) => (d.dashed ? "6 4" : "none"))
      .attr("opacity", 0.4);

    const mergedLinks = linkEnter.merge(linkGroups);

    // Edge labels
    const labelGroups = select(g)
      .selectAll<SVGTextElement, SimLink>("text.kg-edge-label")
      .data(simLinks, (d) => `label-${(d.source as SimNode).id || d.source}-${(d.target as SimNode).id || d.target}`);

    labelGroups.exit().remove();

    const labelEnter = labelGroups
      .enter()
      .append("text")
      .attr("class", "kg-edge-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "6px")
      .attr("fill", "var(--text-dim)")
      .attr("opacity", 0.5)
      .text((d) => d.label);

    const mergedLabels = labelEnter.merge(labelGroups);

    // Tick
    sim.on("tick", () => {
      mergedLinks
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);

      mergedLabels
        .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2 - 6);

      merged.attr("transform", (d) => `translate(${d.x}, ${d.y})`);

      forceRender((c) => c + 1);
    });

    return () => {
      sim.stop();
      // Clean up D3 elements
      select(g).selectAll("g.kg-node").remove();
      select(g).selectAll("line.kg-link").remove();
      select(g).selectAll("text.kg-edge-label").remove();
      svgSel.on(".zoom", null);
    };
  }, [filteredNodes, filteredEdges, centerEntityId, buildSimData]);

  // Find connected edges and nodes for selected node detail panel
  const selectedEdges = selectedNode
    ? edges.filter(
        (e) => e.from === selectedNode.id || e.to === selectedNode.id
      )
    : [];

  const connectedNodes = selectedNode
    ? selectedEdges.map((e) => {
        const otherId =
          e.from === selectedNode.id ? e.to : e.from;
        const other = nodes.find((n) => n.id === otherId);
        return { edge: e, node: other };
      })
    : [];

  if (nodes.length === 0) return null;

  return (
    <div className="my-2 rounded-md border border-border bg-bg-surface overflow-hidden">
      {/* Header + Filters */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-bg-surface-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            status === "traversing"
              ? "bg-amber-400 animate-pulse"
              : "bg-emerald-400"
          }`}
        />
        <span className="text-[11px] font-medium text-text-muted">
          Knowledge Graph — {filteredNodes.length} nodes, {filteredEdges.length}{" "}
          edges
        </span>
        <div className="flex-1" />
        {/* Filter buttons */}
        {nodeTypes.length > 2 &&
          nodeTypes.map((t) => (
            <button
              key={t}
              onClick={() => {
                setActiveFilter(t);
                setSelectedNode(null);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                activeFilter === t
                  ? "bg-accent text-bg"
                  : "border border-border/50 text-text-dim hover:text-text hover:border-accent/30"
              }`}
            >
              {t}
            </button>
          ))}
        {/* Zoom hint */}
        <span className="text-[9px] text-text-dim hidden sm:inline">
          scroll=zoom, drag=move
        </span>
      </div>

      {/* Canvas */}
      <div className="relative" style={{ height: 400 }}>
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ background: "var(--bg)" }}
        >
          <g ref={gRef} />
        </svg>

        {/* Detail panel (click on node) */}
        {selectedNode && (
          <div className="absolute top-2 right-2 w-64 rounded-md border border-border bg-bg-surface/95 backdrop-blur-sm shadow-lg overflow-hidden z-10">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: selectedNode.color }}
              />
              <span className="text-sm font-semibold text-text truncate">
                {selectedNode.label}
              </span>
              <span className="text-[10px] text-text-dim ml-auto">
                {selectedNode.type}
              </span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-text-dim hover:text-text ml-1 text-xs"
              >
                &#x2715;
              </button>
            </div>
            <div className="px-3 py-2 max-h-48 overflow-auto">
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">
                Connections ({connectedNodes.length})
              </div>
              {connectedNodes.length === 0 ? (
                <div className="text-xs text-text-dim py-2">
                  No connections
                </div>
              ) : (
                <div className="space-y-1">
                  {connectedNodes.map(({ edge, node }, i) => {
                    const isOutgoing = edge.from === selectedNode.id;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer hover:bg-bg-surface-2 rounded px-1 -mx-1"
                        onClick={() => {
                          if (node) {
                            const simNode = {
                              ...node,
                              color: nodeColor(node.type),
                              radius: 20,
                            } as SimNode;
                            setSelectedNode(simNode);
                          }
                        }}
                      >
                        <span className="text-[10px] text-text-dim">
                          {isOutgoing ? "\u2192" : "\u2190"}
                        </span>
                        <span
                          className="text-[9px] font-mono px-1 rounded"
                          style={{
                            color: edge.label === "ALTERNATIVE" || edge.label === "CAN_REPLACE"
                              ? "#22c55e"
                              : "var(--text-muted)",
                            backgroundColor: "var(--bg-surface-2)",
                          }}
                        >
                          {edge.label}
                        </span>
                        <span
                          className="font-medium truncate"
                          style={{
                            color: node ? nodeColor(node.type) : "var(--text)",
                          }}
                        >
                          {node?.label || "?"}
                        </span>
                        <span className="text-[9px] text-text-dim ml-auto shrink-0">
                          {node?.type}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
