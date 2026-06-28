import React, { useEffect, useRef, useState } from "react";
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

export type AnnotationCanvasController = ReturnType<typeof useAnnotationCanvas>;

function annotationSurfaceHeight(annotation: SourceAnnotation, fallback: number): number {
  const anchor = annotation.location_anchor as { coordinateSpace?: string; surfaceHeight?: number } | null;
  return anchor?.coordinateSpace === "note-document" && Number(anchor.surfaceHeight) > 0
    ? Number(anchor.surfaceHeight)
    : fallback;
}

function pointsPath(points: StrokePoint[], surfaceHeight: number): string {
  return points.map((point, index) => `${index ? "L" : "M"} ${point.x * 1000} ${point.y * surfaceHeight}`).join(" ");
}

function strokeAppearance(annotation: Pick<SourceAnnotation, "annotation_type" | "tool_type" | "pen_size">) {
  const tool = annotation.tool_type;
  const baseSize = annotation.pen_size || 3;
  if (annotation.annotation_type === "highlighter") return { width: baseSize * 3, opacity: 0.35 };
  if (tool === "marker") return { width: baseSize * 2, opacity: 0.9 };
  if (tool === "pencil") return { width: Math.max(1, baseSize * 0.75), opacity: 0.65 };
  return { width: baseSize, opacity: 1 };
}

export function renderInkToDataUrl(annotations: SourceAnnotation[], currentSurfaceHeight: number): string | null {
  const strokes = annotations.filter((annotation) => annotation.strokes_json?.points.length);
  if (!strokes.length || typeof document === "undefined") return null;
  const width = 1200;
  const safeSurfaceHeight = Math.max(300, currentSurfaceHeight);
  const height = Math.min(2600, Math.max(500, Math.round(width * safeSurfaceHeight / 680)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const annotation of strokes) {
    const points = annotation.strokes_json?.points;
    if (!points?.length) continue;
    const recordedHeight = annotationSurfaceHeight(annotation, safeSurfaceHeight);
    const appearance = strokeAppearance(annotation);
    context.beginPath();
    points.forEach((point, index) => {
      const x = point.x * width;
      const absoluteY = point.y * recordedHeight;
      const y = absoluteY / safeSurfaceHeight * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = annotation.color || "#111827";
    context.globalAlpha = appearance.opacity;
    context.lineWidth = appearance.width * width / 1000;
    context.stroke();
  }
  context.globalAlpha = 1;
  // JPEG keeps the explicit, user-triggered AI request comfortably below API
  // gateway limits even for long notes. This raster is never persisted.
  return canvas.toDataURL("image/jpeg", 0.9);
}

export function inkBottomPx(annotations: SourceAnnotation[], currentSurfaceHeight: number): number {
  let bottom = 0;
  for (const annotation of annotations) {
    const points = annotation.strokes_json?.points;
    if (!points?.length) continue;
    const recordedHeight = annotationSurfaceHeight(annotation, currentSurfaceHeight);
    for (const point of points) bottom = Math.max(bottom, point.y * recordedHeight);
  }
  return bottom;
}

export function AnnotationSurface({
  canvas,
  active = true,
  documentCoordinates = false,
  surfaceHeightRef,
  screenLocked = true,
}: {
  canvas: AnnotationCanvasController;
  active?: boolean;
  documentCoordinates?: boolean;
  surfaceHeightRef?: React.MutableRefObject<number>;
  screenLocked?: boolean;
}) {
  const surfaceRef = useRef<SVGSVGElement>(null);
  const activePenPointersRef = useRef(new Set<number>());
  const activeTouchPointersRef = useRef(new Set<number>());
  const stylusDetectedRef = useRef(false);
  const lastPenInputAtRef = useRef(0);
  const [surfaceHeight, setSurfaceHeight] = useState(1000);

  useEffect(() => {
    if (!documentCoordinates || !surfaceRef.current) return;
    const element = surfaceRef.current;
    const update = () => {
      const height = Math.max(300, element.getBoundingClientRect().height);
      setSurfaceHeight(height);
      if (surfaceHeightRef) surfaceHeightRef.current = height;
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [documentCoordinates, surfaceHeightRef]);

  function pointFromClient(clientX: number, clientY: number, pressure: number, tiltX: number, tiltY: number, buttons: number): StrokePoint {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, pressure: 0, time: Date.now() };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      pressure: pressure || (buttons ? 0.5 : 0),
      tiltX,
      tiltY,
      time: Date.now(),
    };
  }

  function rejectsAsPalm(event: React.PointerEvent<SVGSVGElement>): boolean {
    if (event.pointerType !== "touch") return false;
    return stylusDetectedRef.current || activePenPointersRef.current.size > 0 || performance.now() - lastPenInputAtRef.current < 900;
  }

  const viewHeight = documentCoordinates ? surfaceHeight : 1000;
  return (
    <>
      {canvas.error && (
        <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between gap-2 rounded bg-red-950/90 px-2 py-1 text-[11px] text-red-300">
          <span>{canvas.error}</span>
          {canvas.draft && <button type="button" onClick={() => void canvas.finishStroke(documentCoordinates ? { coordinateSpace: "note-document", surfaceHeight: viewHeight } : {})} className="font-semibold underline">Retry</button>}
        </div>
      )}
      <svg
        ref={surfaceRef}
        viewBox={`0 0 1000 ${viewHeight}`}
        preserveAspectRatio="none"
        className={`absolute inset-0 h-full w-full ${screenLocked ? "touch-none" : "touch-pan-y"} ${!active || canvas.tool === "view" ? "pointer-events-none" : ""}`}
        onPointerDown={(event) => {
          if (rejectsAsPalm(event) || (!screenLocked && event.pointerType === "touch")) return;
          if (event.pointerType === "pen") {
            stylusDetectedRef.current = true;
            for (const pointerId of activeTouchPointersRef.current) {
              if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
            }
            activeTouchPointersRef.current.clear();
            canvas.cancelStroke();
            activePenPointersRef.current.add(event.pointerId);
            lastPenInputAtRef.current = performance.now();
          } else if (event.pointerType === "touch") {
            activeTouchPointersRef.current.add(event.pointerId);
          }
          if (event.cancelable) event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = pointFromClient(event.clientX, event.clientY, event.pressure, event.tiltX, event.tiltY, event.buttons);
          if (canvas.tool === "text" || canvas.tool === "comment") {
            const text = window.prompt(canvas.tool === "comment" ? "Sticky comment" : "Text box");
            if (text) void canvas.addTextAnnotation(point, canvas.tool, text);
            return;
          }
          canvas.beginStroke(point, event.pointerType);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          if (rejectsAsPalm(event)) return;
          if (event.pointerType === "pen") lastPenInputAtRef.current = performance.now();
          if (event.cancelable) event.preventDefault();
          const nativeEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
          for (const pointEvent of nativeEvents) {
            canvas.appendPoint(pointFromClient(pointEvent.clientX, pointEvent.clientY, pointEvent.pressure, pointEvent.tiltX, pointEvent.tiltY, pointEvent.buttons));
          }
        }}
        onPointerUp={(event) => {
          activePenPointersRef.current.delete(event.pointerId);
          activeTouchPointersRef.current.delete(event.pointerId);
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          if (rejectsAsPalm(event)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          event.currentTarget.releasePointerCapture(event.pointerId);
          void canvas.finishStroke(documentCoordinates ? { coordinateSpace: "note-document", surfaceHeight: event.currentTarget.getBoundingClientRect().height } : {});
        }}
        onPointerCancel={(event) => {
          activePenPointersRef.current.delete(event.pointerId);
          activeTouchPointersRef.current.delete(event.pointerId);
          void canvas.finishStroke(documentCoordinates ? { coordinateSpace: "note-document", surfaceHeight: event.currentTarget.getBoundingClientRect().height } : {});
        }}
      >
        {canvas.annotations.map((annotation) => {
          const stroke = annotation.strokes_json;
          const annotationHeight = documentCoordinates ? annotationSurfaceHeight(annotation, viewHeight) : 1000;
          if (!stroke) {
            const anchor = annotation.location_anchor as { x?: number; y?: number } | null;
            if (!annotation.comment_text || anchor?.x == null || anchor?.y == null) return null;
            return (
              <g key={annotation.id} transform={`translate(${anchor.x * 1000} ${anchor.y * annotationHeight})`} onPointerDown={(event) => { if (canvas.tool === "eraser") { event.stopPropagation(); void canvas.eraseAnnotation(annotation.id); } }}>
                <rect width="220" height="80" rx="8" fill={annotation.annotation_type === "comment" ? "#facc15" : "#111827"} fillOpacity="0.9" />
                <text x="10" y="25" fill={annotation.annotation_type === "comment" ? "#111827" : (annotation.color || "#ffffff")} fontSize="18">{annotation.comment_text.slice(0, 24)}</text>
              </g>
            );
          }
          const appearance = strokeAppearance(annotation);
          return (
            <path key={annotation.id} d={pointsPath(stroke.points, annotationHeight)} fill="none" stroke={annotation.color || "#6366f1"} strokeWidth={appearance.width} strokeOpacity={appearance.opacity} strokeLinecap="round" strokeLinejoin="round" onPointerDown={(event) => { if (canvas.tool === "eraser") { event.stopPropagation(); void canvas.eraseAnnotation(annotation.id); } }} />
          );
        })}
        {canvas.draft && (() => {
          const draftAppearance = strokeAppearance({ annotation_type: canvas.tool === "highlighter" ? "highlighter" : "pen", tool_type: canvas.tool, pen_size: canvas.penSize });
          return <path d={pointsPath(canvas.draft.points, viewHeight)} fill="none" stroke={canvas.color} strokeWidth={draftAppearance.width} strokeOpacity={draftAppearance.opacity} strokeLinecap="round" strokeLinejoin="round" />;
        })()}
      </svg>
    </>
  );
}

export function AnnotationCanvas({ noteId, sourceFileId, pageNumber = 1, annotations, onPersisted }: Props) {
  const canvas = useAnnotationCanvas(noteId, sourceFileId, pageNumber, annotations, onPersisted);
  return (
    <div className="absolute inset-0">
      <div className="absolute left-0 right-0 top-0 z-10">
        <AnnotationToolbar tool={canvas.tool} onToolChange={canvas.setTool} color={canvas.color} onColorChange={canvas.setColor} penSize={canvas.penSize} onPenSizeChange={canvas.setPenSize} onUndo={() => void canvas.undo()} onRedo={() => void canvas.redo()} canUndo={canvas.canUndo} canRedo={canvas.canRedo} saving={canvas.saving} />
      </div>
      <AnnotationSurface canvas={canvas} />
    </div>
  );
}
