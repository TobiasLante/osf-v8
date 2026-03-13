"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";

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

export interface KG3DProps {
  nodes: KGNode[];
  edges: KGEdge[];
  centerEntityId?: string;
  status: "traversing" | "done";
  height?: number;
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

/* ─── Dynamic import (react-force-graph-3d uses THREE, no SSR) ─────── */

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

/* ─── Graph data types for force-graph ────────────────────────────── */

interface GraphNode {
  id: string;
  label: string;
  type: string;
  color: string;
  val: number; // node size
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
  color: string;
  dashed: boolean;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/* ─── Component ──────────────────────────────────────────────────────── */

export function KG3D({ nodes, edges, centerEntityId, status, height = 380 }: KG3DProps) {
  const fgRef = useRef<any>(null);
  const prevNodeCount = useRef(0);

  // Build graph data
  const graphData: GraphData = useMemo(() => {
    const nodeSet = new Set<string>();
    const gNodes: GraphNode[] = [];

    for (const n of nodes) {
      if (nodeSet.has(n.id)) continue;
      nodeSet.add(n.id);
      gNodes.push({
        id: n.id,
        label: n.label,
        type: n.type,
        color: nodeColor(n.type),
        val: n.id === centerEntityId ? 8 : 4,
      });
    }

    const gLinks: GraphLink[] = edges
      .filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to))
      .map((e) => ({
        source: e.from,
        target: e.to,
        label: e.label,
        color:
          e.label === "ALTERNATIVE" || e.label === "CAN_REPLACE"
            ? "#22c55e"
            : "rgba(255,255,255,0.15)",
        dashed:
          e.label === "ALTERNATIVE" ||
          e.label === "CAN_REPLACE" ||
          e.label === "SIMILAR_TO",
      }));

    return { nodes: gNodes, links: gLinks };
  }, [nodes, edges, centerEntityId]);

  // Auto-zoom when new nodes arrive
  useEffect(() => {
    if (graphData.nodes.length > prevNodeCount.current && fgRef.current) {
      prevNodeCount.current = graphData.nodes.length;
      // Let simulation settle, then zoom to fit
      setTimeout(() => {
        fgRef.current?.zoomToFit?.(600, 60);
      }, 800);
    }
  }, [graphData.nodes.length]);

  // Slow auto-rotation for beamer effect
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const controls = fg.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;
    }
  });

  // Node label renderer
  const nodeLabel = useCallback(
    (node: any) =>
      `<div style="background:rgba(0,0,0,0.85);padding:4px 8px;border-radius:6px;border:1px solid ${node.color}40;font-size:11px;color:${node.color}">
        <b>${node.label}</b><br/>
        <span style="color:rgba(255,255,255,0.5);font-size:9px">${node.type}</span>
      </div>`,
    []
  );

  // Link label
  const linkLabel = useCallback(
    (link: any) =>
      `<div style="background:rgba(0,0,0,0.8);padding:2px 6px;border-radius:4px;font-size:9px;color:rgba(255,255,255,0.5)">${link.label}</div>`,
    []
  );

  // Custom node rendering via three.js sprite
  const nodeThreeObject = useCallback((node: any) => {
    const group = new THREE.Group();

    // Glowing sphere
    const geometry = new THREE.SphereGeometry(node.val, 16, 12);
    const material = new THREE.MeshLambertMaterial({
      color: node.color,
      transparent: true,
      opacity: 0.85,
    });
    const sphere = new THREE.Mesh(geometry, material);
    group.add(sphere);

    // Outer glow
    const glowGeo = new THREE.SphereGeometry(node.val * 1.4, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: node.color,
      transparent: true,
      opacity: 0.12,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);

    // Label sprite
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 256;
    canvas.height = 64;
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = node.color;
    ctx.fillText(node.label, 128, 28);
    ctx.font = "20px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(node.type, 128, 54);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(24, 6, 1);
    sprite.position.set(0, node.val + 4, 0);
    group.add(sprite);

    return group;
  }, []);

  if (nodes.length === 0) return null;

  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        nodeId="id"
        nodeLabel={nodeLabel}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkSource="source"
        linkTarget="target"
        linkLabel={linkLabel}
        linkColor={(link: any) => link.color}
        linkWidth={1.5}
        linkOpacity={0.4}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={(link: any) => link.color}
        backgroundColor="#050507"
        showNavInfo={false}
        enableNodeDrag={true}
        enableNavigationControls={true}
        warmupTicks={50}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        width={undefined}
        height={height}
      />
      {/* Status indicator */}
      <div className="absolute top-2 left-3 flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "traversing" ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
          }`}
        />
        <span className="text-[10px] text-white/40">
          {graphData.nodes.length} nodes, {graphData.links.length} edges
        </span>
      </div>
      {/* Controls hint */}
      <div className="absolute bottom-2 right-3 text-[9px] text-white/20">
        drag=rotate, scroll=zoom, right-click=pan
      </div>
    </div>
  );
}
