import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSourceAnnotation,
  deleteSourceAnnotation,
  type SourceAnnotation,
  type StrokePayload,
  type StrokePoint,
} from "../api/smartSourceApi";

export type AnnotationTool = "view" | "pen" | "pencil" | "marker" | "highlighter" | "text" | "comment" | "eraser";

interface DraftStroke {
  pointerType: string;
  points: StrokePoint[];
}

export function useAnnotationCanvas(
  noteId: number,
  sourceFileId: number | null,
  pageNumber: number | null,
  initialAnnotations: SourceAnnotation[],
  onPersisted: () => void,
) {
  const [tool, setTool] = useState<AnnotationTool>("view");
  const [color, setColor] = useState("#6366f1");
  const [penSize, setPenSize] = useState(3);
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const draftRef = useRef<DraftStroke | null>(null);
  const draftFrameRef = useRef<number | null>(null);
  const [localAnnotations, setLocalAnnotations] = useState<SourceAnnotation[]>(initialAnnotations);
  const [redoStack, setRedoStack] = useState<SourceAnnotation[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const annotations = useMemo(
    () => localAnnotations.filter((annotation) =>
      (annotation.source_file_id ?? null) === sourceFileId
      && (sourceFileId !== null || annotation.book_id == null)
      && (pageNumber === null || (annotation.page_number ?? 1) === pageNumber)
    ),
    [localAnnotations, pageNumber, sourceFileId],
  );

  useEffect(() => { setLocalAnnotations(initialAnnotations); }, [initialAnnotations]);
  useEffect(() => () => {
    if (draftFrameRef.current != null) cancelAnimationFrame(draftFrameRef.current);
  }, []);

  function renderDraftOnNextFrame() {
    if (draftFrameRef.current != null) return;
    draftFrameRef.current = requestAnimationFrame(() => {
      draftFrameRef.current = null;
      const current = draftRef.current;
      setDraft(current ? { ...current, points: [...current.points] } : null);
    });
  }

  function beginStroke(point: StrokePoint, pointerType: string) {
    if (tool === "view" || tool === "eraser" || tool === "text" || tool === "comment") return;
    draftRef.current = { pointerType, points: [point] };
    setDraft({ pointerType, points: [point] });
  }

  function appendPoint(point: StrokePoint) {
    if (!draftRef.current) return;
    draftRef.current.points.push(point);
    renderDraftOnNextFrame();
  }

  function cancelStroke() {
    draftRef.current = null;
    if (draftFrameRef.current != null) {
      cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = null;
    }
    setDraft(null);
  }

  async function finishStroke(anchorMetadata: Record<string, unknown> = {}) {
    const completed = draftRef.current;
    draftRef.current = null;
    if (draftFrameRef.current != null) {
      cancelAnimationFrame(draftFrameRef.current);
      draftFrameRef.current = null;
    }
    setDraft(null);
    if (!completed || completed.points.length < 2) return;
    const strokes: StrokePayload = { version: 1, pointerType: completed.pointerType, points: completed.points };
    setSaving(true);
    setError(null);
    try {
      const annotationType = tool === "highlighter"
        ? "highlighter"
        : completed.pointerType === "pen" ? "handwriting" : "pen";
      const savedPageNumber = pageNumber ?? 1;
      const created = await createSourceAnnotation({
        note_id: noteId,
        source_file_id: sourceFileId,
        book_id: null,
        page_number: savedPageNumber,
        location_anchor: { coordinateSpace: "normalized", page: savedPageNumber, ...anchorMetadata },
        annotation_type: annotationType,
        strokes_json: strokes,
        highlight_data: null,
        comment_text: null,
        color,
        pen_size: penSize,
        tool_type: tool,
      });
      setLocalAnnotations((current) => [...current, created]);
      setRedoStack([]);
      onPersisted();
    } catch (caught) {
      draftRef.current = completed;
      setDraft(completed);
      setError(caught instanceof Error ? caught.message : "Annotation save failed — stroke kept for retry");
    } finally {
      setSaving(false);
    }
  }

  async function eraseAnnotation(id: number) {
    setError(null);
    try {
      await deleteSourceAnnotation(id);
      setLocalAnnotations((current) => current.filter((annotation) => annotation.id !== id));
      onPersisted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not erase annotation");
    }
  }

  async function addTextAnnotation(point: StrokePoint, annotationType: "text" | "comment", text: string) {
    if (!text.trim()) return;
    setError(null);
    try {
      const created = await createSourceAnnotation({
      note_id: noteId,
      source_file_id: sourceFileId,
      book_id: null,
      page_number: pageNumber ?? 1,
      location_anchor: { coordinateSpace: "normalized", page: pageNumber ?? 1, x: point.x, y: point.y },
      annotation_type: annotationType,
      strokes_json: null,
      highlight_data: null,
      comment_text: text.trim(),
      color,
      pen_size: penSize,
      tool_type: annotationType,
    });
      setLocalAnnotations((current) => [...current, created]);
      setRedoStack([]);
      onPersisted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save annotation text");
    }
  }

  async function undo() {
    const latest = annotations[annotations.length - 1];
    if (!latest) return;
    setError(null);
    try {
      await deleteSourceAnnotation(latest.id);
      setLocalAnnotations((current) => current.filter((annotation) => annotation.id !== latest.id));
      setRedoStack((current) => [...current, latest]);
      onPersisted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not undo annotation");
    }
  }

  async function redo() {
    const latest = redoStack[redoStack.length - 1];
    if (!latest) return;
    setError(null);
    try {
      const recreated = await createSourceAnnotation({
      note_id: noteId,
      source_file_id: sourceFileId,
      book_id: latest.book_id,
      page_number: latest.page_number,
      location_anchor: latest.location_anchor,
      annotation_type: latest.annotation_type,
      strokes_json: latest.strokes_json,
      highlight_data: latest.highlight_data,
      comment_text: latest.comment_text,
      color: latest.color,
      pen_size: latest.pen_size,
      tool_type: latest.tool_type,
    });
      setLocalAnnotations((current) => [...current, recreated]);
      setRedoStack((current) => current.slice(0, -1));
      onPersisted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not redo annotation");
    }
  }

  return {
    tool, setTool, color, setColor, penSize, setPenSize,
    draft, annotations, saving, error, canUndo: annotations.length > 0, canRedo: redoStack.length > 0,
    beginStroke, appendPoint, cancelStroke, finishStroke, eraseAnnotation, addTextAnnotation, undo, redo,
  };
}
