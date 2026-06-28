import React from "react";
import type { AnnotationTool } from "../../hooks/useAnnotationCanvas";

interface Props {
  tool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  penSize: number;
  onPenSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
}

export function AnnotationToolbar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ml-bg-hover)] bg-[var(--ml-bg-panel)] px-3 py-2">
      {(["view", "pen", "highlighter", "text", "comment", "eraser"] as AnnotationTool[]).map((tool) => (
        <button
          key={tool}
          onClick={() => props.onToolChange(tool)}
          className={`rounded-lg px-2.5 py-1 text-xs capitalize ${props.tool === tool ? "bg-indigo-600 text-white" : "text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
        >
          {tool}
        </button>
      ))}
      <input type="color" value={props.color} onChange={(event) => props.onColorChange(event.target.value)} aria-label="Annotation color" className="h-7 w-8" />
      <label className="flex items-center gap-1 text-xs text-gray-500">
        Size
        <input type="range" min="1" max="20" value={props.penSize} onChange={(event) => props.onPenSizeChange(Number(event.target.value))} />
      </label>
      <button onClick={props.onUndo} disabled={!props.canUndo} className="text-xs text-gray-400 disabled:opacity-30">Undo</button>
      <button onClick={props.onRedo} disabled={!props.canRedo} className="text-xs text-gray-400 disabled:opacity-30">Redo</button>
      <span className="ml-auto text-[11px] text-gray-500">{props.saving ? "Saving annotation…" : "Annotations sync across devices"}</span>
    </div>
  );
}
