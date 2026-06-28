import React, { useRef } from "react";
import type { SourceAnnotation, StrokePoint } from "../../api/smartSourceApi";
import { useAnnotationCanvas } from "../../hooks/useAnnotationCanvas";
import { AnnotationToolbar } from "./AnnotationToolbar";

interface Props {
  noteId: number;
  sourceFileId: number | null;
  pageNumber?: number;
  annotations: SourceAnnotation[];
  onPersisted: () => void;
}

function pointsPath(points: StrokePoint[]): string {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x * 1000} ${point.y * 1000}`).join(" ");
}

export function AnnotationCanvas({ noteId, sourceFileId, pageNumber = 1, annotations, onPersisted }: Props) {
  const surfaceRef = useRef<SVGSVGElement>(null);
  const canvas = useAnnotationCanvas(noteId, sourceFileId, pageNumber, annotations, onPersisted);

  function pointFromEvent(event: React.PointerEvent<SVGSVGElement>): StrokePoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      pressure: event.pressure || (event.buttons ? 0.5 : 0),
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      time: Date.now(),
    };
  }

  return (
    <div className="absolute inset-0">
      <div className="absolute left-0 right-0 top-0 z-10">
        <AnnotationToolbar
          tool={canvas.tool} onToolChange={canvas.setTool}
          color={canvas.color} onColorChange={canvas.setColor}
          penSize={canvas.penSize} onPenSizeChange={canvas.setPenSize}
          onUndo={() => void canvas.undo()} onRedo={() => void canvas.redo()}
          canUndo={canvas.canUndo} canRedo={canvas.canRedo} saving={canvas.saving}
        />
      </div>
      {canvas.error && (
        <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between gap-2 rounded bg-red-950/90 px-2 py-1 text-[11px] text-red-300">
          <span>{canvas.error}</span>
          {canvas.draft && <button type="button" onClick={() => void canvas.finishStroke()} className="font-semibold underline">Retry</button>}
        </div>
      )}
      <svg
        ref={surfaceRef}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className={`h-full w-full touch-none ${canvas.tool === "view" ? "pointer-events-none" : ""}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointFromEvent(event);
          if (canvas.tool === "text" || canvas.tool === "comment") {
            const text = window.prompt(canvas.tool === "comment" ? "Sticky comment" : "Text box");
            if (text) void canvas.addTextAnnotation(point, canvas.tool, text);
            return;
          }
          canvas.beginStroke(point, event.pointerType);
        }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) canvas.appendPoint(pointFromEvent(event)); }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); void canvas.finishStroke(); }}
        onPointerCancel={() => void canvas.finishStroke()}
      >
        {canvas.annotations.map((annotation) => {
          const stroke = annotation.strokes_json;
          if (!stroke) {
            const anchor = annotation.location_anchor as { x?: number; y?: number } | null;
            if (!annotation.comment_text || anchor?.x == null || anchor?.y == null) return null;
            return (
              <g key={annotation.id} transform={`translate(${anchor.x * 1000} ${anchor.y * 1000})`} onPointerDown={(event) => { if (canvas.tool === "eraser") { event.stopPropagation(); void canvas.eraseAnnotation(annotation.id); } }}>
                <rect width="220" height="80" rx="8" fill={annotation.annotation_type === "comment" ? "#facc15" : "#111827"} fillOpacity="0.9" />
                <text x="10" y="25" fill={annotation.annotation_type === "comment" ? "#111827" : (annotation.color || "#ffffff")} fontSize="18">{annotation.comment_text.slice(0, 24)}</text>
              </g>
            );
          }
          return (
            <path
              key={annotation.id}
              d={pointsPath(stroke.points)}
              fill="none"
              stroke={annotation.color || "#6366f1"}
              strokeWidth={(annotation.pen_size || 3) * (annotation.annotation_type === "highlighter" ? 3 : 1)}
              strokeOpacity={annotation.annotation_type === "highlighter" ? 0.35 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              onPointerDown={(event) => {
                if (canvas.tool !== "eraser") return;
                event.stopPropagation();
                void canvas.eraseAnnotation(annotation.id);
              }}
            />
          );
        })}
        {canvas.draft && (
          <path d={pointsPath(canvas.draft.points)} fill="none" stroke={canvas.color} strokeWidth={canvas.penSize * (canvas.tool === "highlighter" ? 3 : 1)} strokeOpacity={canvas.tool === "highlighter" ? 0.35 : 1} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </div>
  );
}
