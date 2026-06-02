import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3-force";
import { getGraph, buildGraph, clearGraph, GraphNode, GraphLink } from "../api/memographApi";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SimNode extends SimulationNodeDatum, GraphNode {
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  relationship: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  note:        "#6366f1",
  reminder:    "#f59e0b",
  person:      "#22c55e",
  topic:       "#22d3ee",
  project:     "#f97316",
  deadline:    "#ef4444",
  decision:    "#eab308",
  action_item: "#ec4899",
  question:    "#a855f7",
  theme:       "#14b8a6",
};

const NODE_LABELS: Record<string, string> = {
  note:        "Note",
  reminder:    "Reminder",
  person:      "Person",
  topic:       "Topic",
  project:     "Project",
  deadline:    "Deadline",
  decision:    "Decision",
  action_item: "Action Item",
  question:    "Question",
  theme:       "Theme",
};

const NODE_RADIUS: Record<string, number> = {
  note:     16,
  reminder: 13,
  default:  10,
};

function nodeRadius(type: string): number {
  return NODE_RADIUS[type] ?? NODE_RADIUS.default;
}

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? "#64748b";
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface MemoGraphModalProps {
  show: boolean;
  onClose: () => void;
  workspaceId: number | null;
  workspaceName?: string;
  onOpenNote?: (noteId: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MemoGraphModal({
  show,
  onClose,
  workspaceId,
  workspaceName,
  onOpenNote,
}: MemoGraphModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simRef = useRef<any>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{ node: SimNode; offsetX: number; offsetY: number } | null>(null);
  const tooltipRef = useRef<{ label: string; type: string; x: number; y: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<{ nodes: number; edges: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(Object.keys(NODE_COLORS)));
  const [tooltip, setTooltip] = useState<{ label: string; type: string; x: number; y: number } | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  const allTypes = Object.keys(NODE_COLORS);

  // ── Canvas drawing ─────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0d0d15";
    ctx.fillRect(0, 0, W, H);

    const visible = new Set(activeTypes);

    // Draw edges
    linksRef.current.forEach((link) => {
      const s = link.source as unknown as SimNode;
      const t = link.target as unknown as SimNode;
      if (!visible.has(s.type) || !visible.has(t.type)) return;
      if (s.x == null || t.x == null) return;

      const isRelated = link.relationship === "related_to";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isRelated ? "rgba(99,102,241,0.35)" : "rgba(100,116,139,0.3)";
      ctx.lineWidth = isRelated ? 1.5 : 1;
      if (isRelated) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Edge label (relationship) at midpoint — only for non-related_to edges
      if (!isRelated) {
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        ctx.font = "9px system-ui";
        ctx.fillStyle = "rgba(148,163,184,0.6)";
        ctx.textAlign = "center";
        ctx.fillText(link.relationship.replace("_", " "), mx, my - 4);
      }
    });

    // Draw nodes
    nodesRef.current.forEach((node) => {
      if (!visible.has(node.type)) return;
      if (node.x == null) return;

      const r = nodeRadius(node.type);
      const color = nodeColor(node.type);

      // Glow for note/reminder nodes
      if (node.type === "note" || node.type === "reminder") {
        const grad = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, r * 2);
        grad.addColorStop(0, color + "33");
        grad.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + "22";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = node.type === "note" ? 2 : 1.5;
      ctx.stroke();

      // Label
      ctx.font = node.type === "note" ? "bold 10px system-ui" : "10px system-ui";
      ctx.fillStyle = node.type === "note" ? "#e2e8f0" : "#94a3b8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const maxLen = node.type === "note" ? 18 : 14;
      const text = node.label.length > maxLen ? node.label.slice(0, maxLen - 1) + "…" : node.label;
      ctx.fillText(text, node.x, node.y + r + 10);
    });
  }, [activeTypes]);

  // ── Simulation setup ───────────────────────────────────────────────────────

  const startSimulation = useCallback(
    (rawNodes: GraphNode[], rawLinks: GraphLink[], W: number, H: number) => {
      if (simRef.current) {
        simRef.current.stop();
        cancelAnimationFrame(rafRef.current);
      }

      const nodes: SimNode[] = rawNodes.map((n) => ({
        ...n,
        x: W / 2 + (Math.random() - 0.5) * 300,
        y: H / 2 + (Math.random() - 0.5) * 300,
      }));

      const nodeById = new Map(nodes.map((n) => [n.id, n]));

      const links: SimLink[] = rawLinks
        .map((l) => ({
          source: (nodeById.get(l.source) ?? l.source) as SimNode,
          target: (nodeById.get(l.target) ?? l.target) as SimNode,
          relationship: l.relationship,
        }))
        .filter((l) => l.source && l.target);

      nodesRef.current = nodes;
      linksRef.current = links;

      const sim = forceSimulation<SimNode>(nodes)
        .force("charge", forceManyBody<SimNode>().strength(-200))
        .force("link", forceLink<SimNode, SimLink>(links).id((d: SimNode) => d.id).distance(120).strength(0.4))
        .force("center", forceCenter(W / 2, H / 2))
        .force("collide", forceCollide<SimNode>().radius((d: SimNode) => nodeRadius(d.type) + 18))
        .alphaDecay(0.025)
        .on("tick", () => {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(draw);
        })
        .on("end", draw);

      simRef.current = sim;
    },
    [draw]
  );

  // ── Load graph ─────────────────────────────────────────────────────────────

  const loadGraph = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getGraph(workspaceId);
      if (data.nodes.length === 0) {
        setIsEmpty(true);
        nodesRef.current = [];
        linksRef.current = [];
        draw();
      } else {
        setIsEmpty(false);
        const canvas = canvasRef.current;
        const W = canvas?.width ?? 900;
        const H = canvas?.height ?? 600;
        startSimulation(data.nodes, data.links, W, H);
      }
    } catch {
      setError("Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, startSimulation, draw]);

  // ── Build graph ────────────────────────────────────────────────────────────

  const handleBuild = useCallback(async () => {
    if (!workspaceId) return;
    setBuilding(true);
    setError(null);
    setBuildResult(null);
    try {
      const result = await buildGraph(workspaceId);
      setBuildResult(result);
      await loadGraph();
    } catch {
      setError("Build failed — check your OpenAI key");
    } finally {
      setBuilding(false);
    }
  }, [workspaceId, loadGraph]);

  // ── Clear graph ────────────────────────────────────────────────────────────

  const handleClear = useCallback(async () => {
    if (!workspaceId) return;
    await clearGraph(workspaceId);
    nodesRef.current = [];
    linksRef.current = [];
    setBuildResult(null);
    setIsEmpty(true);
    draw();
  }, [workspaceId, draw]);

  // ── On open ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (show && workspaceId) {
      loadGraph();
    }
    return () => {
      if (simRef.current) simRef.current.stop();
      cancelAnimationFrame(rafRef.current);
    };
  }, [show, workspaceId]);

  // Resize canvas when modal opens
  useEffect(() => {
    if (!show) return;
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      draw();
    };
    setTimeout(resize, 50); // wait for DOM layout
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [show, draw]);

  // ── Mouse interactions ─────────────────────────────────────────────────────

  function getNodeAt(x: number, y: number): SimNode | null {
    for (const node of [...nodesRef.current].reverse()) {
      if (node.x == null) continue;
      const r = nodeRadius(node.type);
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy <= r * r + 4) return node;
    }
    return null;
  }

  function canvasCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasCoords(e);
    const node = getNodeAt(x, y);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      dragRef.current = { node, offsetX: x - node.x, offsetY: y - node.y };
      simRef.current?.alphaTarget(0.1).restart();
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasCoords(e);
    if (dragRef.current) {
      const { node, offsetX, offsetY } = dragRef.current;
      node.fx = x - offsetX;
      node.fy = y - offsetY;
    }
    const hovered = getNodeAt(x, y);
    if (hovered) {
      const newTip = { label: hovered.label, type: hovered.type, x: x + 12, y: y - 8 };
      tooltipRef.current = newTip;
      setTooltip(newTip);
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    } else {
      tooltipRef.current = null;
      setTooltip(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "default";
    }
  };

  const onMouseUp = () => {
    if (dragRef.current) {
      dragRef.current.node.fx = null;
      dragRef.current.node.fy = null;
      dragRef.current = null;
      simRef.current?.alphaTarget(0);
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasCoords(e);
    const node = getNodeAt(x, y);
    if (node?.type === "note" && node.source_id && onOpenNote) {
      onOpenNote(node.source_id);
      onClose();
    }
  };

  // ── Toggle type filter ─────────────────────────────────────────────────────

  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // Redraw when filters change
  useEffect(() => {
    draw();
  }, [activeTypes, draw]);

  if (!show) return null;

  const nodeCount = nodesRef.current.length;
  const edgeCount = linksRef.current.length;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col" onClick={onClose}>
      <div
        className="flex flex-col w-full h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2a38] bg-[#12121a] shrink-0">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" />
              <circle cx="12" cy="8" r="2.5" /><circle cx="12" cy="16" r="2.5" />
              <line x1="7.2" y1="11" x2="10" y2="9" /><line x1="14" y1="9" x2="16.8" y2="6.5" />
              <line x1="7.2" y1="13" x2="10" y2="15" /><line x1="14" y1="15" x2="16.8" y2="17.5" />
              <line x1="12" y1="10.5" x2="12" y2="13.5" />
            </svg>
            <h2 className="font-semibold text-white text-sm">MemoGraph</h2>
            {workspaceName && (
              <span className="text-xs text-gray-500 border border-[#2a2a38] px-2 py-0.5 rounded-full">
                {workspaceName}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {nodeCount > 0 && (
              <span className="text-[11px] text-gray-600">
                {nodeCount} nodes · {edgeCount} edges
              </span>
            )}
            {buildResult && (
              <span className="text-[11px] text-emerald-500">
                ✓ {buildResult.nodes} nodes, {buildResult.edges} edges built
              </span>
            )}
            {error && <span className="text-[11px] text-red-400">{error}</span>}

            <button
              onClick={handleBuild}
              disabled={building || !workspaceId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition text-white"
            >
              {building ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Building…
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Build Graph
                </>
              )}
            </button>

            {nodeCount > 0 && (
              <button
                onClick={handleClear}
                className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"
              >
                Clear
              </button>
            )}

            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#2a2a38] transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body: canvas + legend ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Canvas */}
          <div className="relative flex-1 overflow-hidden">
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onClick={onCanvasClick}
            />

            {/* Loading overlay */}
            {(loading || building) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d0d15]/80">
                <svg className="w-8 h-8 animate-spin text-indigo-400 mb-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <p className="text-sm text-gray-400">
                  {building ? "Extracting entities from notes…" : "Loading graph…"}
                </p>
                {building && (
                  <p className="text-xs text-gray-600 mt-1">This may take a moment for large workspaces</p>
                )}
              </div>
            )}

            {/* Empty state */}
            {isEmpty && !loading && !building && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-gray-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" />
                  <circle cx="12" cy="8" r="2.5" /><circle cx="12" cy="16" r="2.5" />
                  <line x1="7.2" y1="11" x2="10" y2="9" /><line x1="14" y1="9" x2="16.8" y2="6.5" />
                </svg>
                <p className="text-gray-400 font-medium mb-1">No graph yet</p>
                <p className="text-gray-600 text-sm max-w-xs">
                  Click <span className="text-indigo-400 font-medium">Build Graph</span> to extract entities from your notes and visualise how they connect.
                </p>
              </div>
            )}

            {/* Tooltip */}
            {tooltip && (
              <div
                className="absolute pointer-events-none bg-[#1e1e2a] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 shadow-xl"
                style={{ left: tooltip.x, top: tooltip.y, maxWidth: 220 }}
              >
                <p className="text-[11px] font-semibold" style={{ color: nodeColor(tooltip.type) }}>
                  {NODE_LABELS[tooltip.type] ?? tooltip.type}
                </p>
                <p className="text-xs text-gray-300 mt-0.5 break-words">{tooltip.label}</p>
                {tooltip.type === "note" && (
                  <p className="text-[10px] text-indigo-400 mt-0.5">Click to open note</p>
                )}
              </div>
            )}
          </div>

          {/* ── Legend & filters ── */}
          <div className="w-44 shrink-0 border-l border-[#2a2a38] bg-[#12121a] flex flex-col py-3 px-3 overflow-y-auto">
            <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Node Types</p>
            <div className="space-y-1">
              {allTypes.map((type) => {
                const active = activeTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs transition ${
                      active ? "text-gray-300" : "text-gray-600 opacity-50"
                    } hover:bg-[#1e1e2a]`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 border"
                      style={{
                        backgroundColor: active ? nodeColor(type) + "33" : "transparent",
                        borderColor: nodeColor(type),
                      }}
                    />
                    <span>{NODE_LABELS[type]}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto pt-4 border-t border-[#2a2a38] space-y-2 text-[10px] text-gray-600">
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                  <circle cx="4" cy="8" r="2.5"/><circle cx="12" cy="4" r="2.5"/><line x1="6.3" y1="7" x2="9.7" y2="5"/>
                </svg>
                Drag nodes to rearrange
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" d="M3 8h10M10 5l3 3-3 3"/>
                </svg>
                Click a note to open it
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 inline-block border-t-2"
                  style={{ borderColor: "#6366f1", borderStyle: "dashed" }}
                />
                Dashed = related notes
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
