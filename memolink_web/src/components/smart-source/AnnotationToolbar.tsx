import React from "react";
import type { AnnotationTool, EraserMode, PenType } from "../../hooks/useAnnotationCanvas";

interface Props {
  tool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  penType: PenType;
  onPenTypeChange: (penType: PenType) => void;
  eraserMode: EraserMode;
  onEraserModeChange: (mode: EraserMode) => void;
  color: string;
  onColorChange: (color: string) => void;
  penSize: number;
  onPenSizeChange: (size: number) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  embedded?: boolean;
  screenLocked?: boolean;
  onScreenLockedChange?: (locked: boolean) => void;
}

export function AnnotationToolbar(props: Props) {
  const penIcons: Record<PenType, React.ReactNode> = {
    pen: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.5 8 3 3" /></>,
    pencil: <><path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z" /><path d="m14 7 3 3" /></>,
    marker: <><path d="M7 4h7l3 3-9 9-4-4 3-8Z" /><path d="m4 12-1 5 5-1" /></>,
    highlighter: <><path d="m9 11 6 6" /><path d="m4 20 4-1 10-10-5-5L3 14l6 6Z" /><path d="M14 20h7" /></>,
    brush: <><path d="M15 4c3-1 5 1 4 4-1 3-5 6-8 7" /><path d="M11 15c0 4-3 6-7 5 2-1 1-4 3-6 1-1 3-1 4 1Z" /></>,
    calligraphy: <><path d="m12 3 5 5-6 11-5 2 1-5 5-13Z" /><path d="m8 16 3 3M12 3l-1 8" /></>,
    dashed: <><path d="m5 19 3-1 2-2M12 14l2-2M16 10l3-3" /><path d="m15 4 5 5" /></>,
  };
  const eraserIcon = props.eraserMode === "partial"
    ? <><path d="m7 19-4-4L13 5l6 6-8 8H7Z" /><circle cx="17.5" cy="17.5" r="3" /></>
    : <><path d="m7 19-4-4L13 5l6 6-8 8H7Z" /><path d="m15 16 5 5m0-5-5 5" /></>;
  const tools: Array<{ tool: AnnotationTool; label: string; icon: React.ReactNode }> = [
    { tool: "view", label: "Move / select", icon: <path d="m5 3 12 8-6 1-3 6L5 3Z" /> },
    { tool: "text", label: "Text box", icon: <><path d="M5 5h14" /><path d="M12 5v14" /><path d="M8 19h8" /></> },
    { tool: "comment", label: "Sticky comment", icon: <path d="M5 4h14v12H9l-4 4V4Z" /> },
  ];
  const visibleTools = props.embedded ? tools.filter(({ tool }) => tool === "view") : tools;
  const penTools: PenType[] = ["pen", "pencil", "marker", "highlighter", "brush", "calligraphy", "dashed"];
  const penActive = penTools.includes(props.tool as PenType);

  return (
    <div className={`flex flex-wrap items-center gap-1.5 font-sans ${props.embedded ? "shrink-0" : "border-b border-[var(--ml-bg-hover)] bg-[var(--ml-bg-panel)] px-2 py-2"}`}>
      {visibleTools.map(({ tool, label, icon }) => (
        <button
          key={tool}
          type="button"
          onClick={() => props.onToolChange(tool)}
          title={label}
          aria-label={label}
          aria-pressed={props.tool === tool}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${props.tool === tool ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-white"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
        </button>
      ))}
      <label title="Pen type" className={`relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg ${penActive ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-white"}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{penIcons[props.penType]}</svg>
        <span className="absolute bottom-0.5 right-0.5 text-[7px]" aria-hidden="true">▾</span>
        <select value={props.penType} onPointerDown={() => props.onToolChange(props.penType)} onChange={(event) => props.onPenTypeChange(event.target.value as PenType)} aria-label="Pen type" className="absolute inset-0 cursor-pointer opacity-0">
          <option value="pen">● Ballpoint pen</option><option value="pencil">✎ Pencil</option>
          <option value="marker">▰ Marker</option><option value="highlighter">▤ Highlighter</option>
          <option value="brush">〰 Brush</option><option value="calligraphy">✒ Calligraphy pen</option>
          <option value="dashed">┄ Dashed pen</option>
        </select>
      </label>
      <label title="Eraser mode" className={`relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg ${props.tool === "eraser" ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-white"}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{eraserIcon}</svg>
        <span className="absolute bottom-0.5 right-0.5 text-[7px]" aria-hidden="true">▾</span>
        <select value={props.eraserMode} onPointerDown={() => props.onToolChange("eraser")} onChange={(event) => { props.onEraserModeChange(event.target.value as EraserMode); props.onToolChange("eraser"); }} aria-label="Eraser mode" className="absolute inset-0 cursor-pointer opacity-0">
          <option value="partial">◌ Partial eraser</option><option value="stroke">✕ Stroke eraser</option>
        </select>
      </label>
      <label className="relative ml-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/20" title="Ink color" style={{ backgroundColor: props.color }}>
        <span className="sr-only">Ink color</span>
        <input type="color" value={props.color} onChange={(event) => props.onColorChange(event.target.value)} aria-label="Ink color" className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <label className="flex items-center gap-1.5 px-1 text-[11px] text-gray-500" title={props.tool === "eraser" ? "Eraser size" : "Pen size"}>
        <span className="h-2 w-2 rounded-full bg-current" />
        <input type="range" min="1" max="20" value={props.penSize} onChange={(event) => props.onPenSizeChange(Number(event.target.value))} className="w-20 accent-indigo-500" aria-label={props.tool === "eraser" ? "Eraser size" : "Pen size"} />
      </label>
      {penActive && <label className="flex items-center gap-1 px-1 text-[10px] text-gray-500" title="Ink opacity"><span>Opacity</span><input type="range" min="10" max="100" value={Math.round(props.opacity * 100)} onChange={(event) => props.onOpacityChange(Number(event.target.value) / 100)} className="w-14 accent-indigo-500" aria-label="Ink opacity" /></label>}
      <button type="button" onClick={props.onUndo} disabled={!props.canUndo} title="Undo ink" aria-label="Undo ink" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-[var(--ml-bg-hover)] disabled:opacity-30"><span aria-hidden="true">↶</span></button>
      <button type="button" onClick={props.onRedo} disabled={!props.canRedo} title="Redo ink" aria-label="Redo ink" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-[var(--ml-bg-hover)] disabled:opacity-30"><span aria-hidden="true">↷</span></button>
      {props.embedded && props.onScreenLockedChange && (
        <button
          type="button"
          onClick={() => props.onScreenLockedChange?.(!props.screenLocked)}
          title={props.screenLocked ? "Screen locked while drawing — tap to allow scrolling" : "Screen unlocked — tap to freeze while drawing"}
          aria-label={props.screenLocked ? "Unlock drawing screen" : "Lock drawing screen"}
          aria-pressed={props.screenLocked}
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${props.screenLocked ? "bg-emerald-600/20 text-emerald-300" : "text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d={props.screenLocked ? "M8 10V7a4 4 0 0 1 8 0v3" : "M8 10V7a4 4 0 0 1 7.5-2"}/></svg>
        </button>
      )}
      <span className="ml-auto whitespace-nowrap text-[10px] text-gray-500">{props.saving ? "Saving in background…" : props.embedded ? `Palm rejection • ${props.screenLocked ? "Locked" : "Scroll on"}` : "Synced"}</span>
    </div>
  );
}
