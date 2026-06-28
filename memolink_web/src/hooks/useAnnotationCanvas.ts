import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSourceAnnotation,
  deleteSourceAnnotation,
  updateSourceAnnotation,
  type SourceAnnotation,
  type StrokePoint,
} from "../api/smartSourceApi";

export type AnnotationTool = "view" | "pen" | "pencil" | "marker" | "highlighter" | "brush" | "calligraphy" | "dashed" | "text" | "comment" | "eraser";
export type PenType = "pen" | "pencil" | "marker" | "highlighter" | "brush" | "calligraphy" | "dashed";
export type EraserMode = "partial" | "stroke";

interface DraftStroke {
  pointerType: string;
  points: StrokePoint[];
}

interface PersistenceJob {
  key: string;
  run: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 220;
const ERASER_RADIUS = 0.018;
let nextTemporaryId = -1;

const PEN_DEFAULTS: Record<PenType, { size: number; opacity: number }> = {
  pen: { size: 3, opacity: 1 },
  pencil: { size: 2, opacity: 0.62 },
  marker: { size: 7, opacity: 0.9 },
  highlighter: { size: 10, opacity: 0.32 },
  brush: { size: 6, opacity: 0.92 },
  calligraphy: { size: 5, opacity: 1 },
  dashed: { size: 3, opacity: 1 },
};

function sameStroke(left: SourceAnnotation, right: SourceAnnotation): boolean {
  return JSON.stringify(left.strokes_json) === JSON.stringify(right.strokes_json);
}

function splitStrokeAtPoint(points: StrokePoint[], point: StrokePoint, radius = ERASER_RADIUS): StrokePoint[][] {
  const radiusSquared = radius * radius;
  const segments: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  for (const candidate of points) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    if (dx * dx + dy * dy <= radiusSquared) {
      if (current.length >= 2) segments.push(current);
      current = [];
    } else {
      current.push(candidate);
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

export function useAnnotationCanvas(
  noteId: number,
  sourceFileId: number | null,
  pageNumber: number | null,
  initialAnnotations: SourceAnnotation[],
  _onPersisted: () => void,
) {
  const [tool, setToolState] = useState<AnnotationTool>("view");
  const [penType, setPenTypeState] = useState<PenType>("pen");
  const [eraserMode, setEraserMode] = useState<EraserMode>("partial");
  const [color, setColor] = useState("#6366f1");
  const [penSize, setPenSize] = useState(PEN_DEFAULTS.pen.size);
  const [opacity, setOpacity] = useState(PEN_DEFAULTS.pen.opacity);
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const draftRef = useRef<DraftStroke | null>(null);
  const [localAnnotations, setLocalAnnotations] = useState<SourceAnnotation[]>(initialAnnotations);
  const localAnnotationsRef = useRef(initialAnnotations);
  const [redoStack, setRedoStack] = useState<SourceAnnotation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef<PersistenceJob[]>([]);
  const failedJobsRef = useRef<PersistenceJob[]>([]);
  const queueTimerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const deletedIdsRef = useRef(new Set<number>());
  const scopeRef = useRef(`${noteId}:${sourceFileId ?? "note"}:${pageNumber ?? "all"}`);
  const eraseBeforeRef = useRef<SourceAnnotation[] | null>(null);

  const replaceAnnotations = useCallback((update: (current: SourceAnnotation[]) => SourceAnnotation[]) => {
    setLocalAnnotations((current) => {
      const next = update(current);
      localAnnotationsRef.current = next;
      return next;
    });
  }, []);

  const annotations = useMemo(
    () => localAnnotations.filter((annotation) =>
      (annotation.source_file_id ?? null) === sourceFileId
      && (sourceFileId !== null || annotation.book_id == null)
      && (pageNumber === null || (annotation.page_number ?? 1) === pageNumber)
    ),
    [localAnnotations, pageNumber, sourceFileId],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (jobsRef.current.length) {
      const job = jobsRef.current.shift()!;
      try {
        await job.run();
      } catch (caught) {
        failedJobsRef.current.push(job);
        if (mountedRef.current) setError(caught instanceof Error ? `${caught.message} — tap Retry` : "Annotation save failed — tap Retry");
      } finally {
        if (mountedRef.current) setPendingCount(jobsRef.current.length + failedJobsRef.current.length);
      }
    }
    processingRef.current = false;
  }, []);

  const scheduleQueue = useCallback((job: PersistenceJob) => {
    const existing = jobsRef.current.findIndex((queued) => queued.key === job.key);
    if (existing >= 0) jobsRef.current[existing] = job;
    else jobsRef.current.push(job);
    setPendingCount(jobsRef.current.length + failedJobsRef.current.length);
    if (queueTimerRef.current != null) window.clearTimeout(queueTimerRef.current);
    queueTimerRef.current = window.setTimeout(() => {
      queueTimerRef.current = null;
      void processQueue();
    }, SAVE_DEBOUNCE_MS);
  }, [processQueue]);

  const retryFailed = useCallback(() => {
    if (!failedJobsRef.current.length) return;
    jobsRef.current.unshift(...failedJobsRef.current.splice(0));
    setError(null);
    setPendingCount(jobsRef.current.length);
    void processQueue();
  }, [processQueue]);

  const cancelQueuedJob = useCallback((key: string) => {
    jobsRef.current = jobsRef.current.filter((job) => job.key !== key);
    failedJobsRef.current = failedJobsRef.current.filter((job) => job.key !== key);
    setPendingCount(jobsRef.current.length + failedJobsRef.current.length);
  }, []);

  useEffect(() => {
    const scope = `${noteId}:${sourceFileId ?? "note"}:${pageNumber ?? "all"}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      localAnnotationsRef.current = initialAnnotations;
      setLocalAnnotations(initialAnnotations);
      deletedIdsRef.current.clear();
      setRedoStack([]);
      return;
    }
    // A workspace refresh may contain older data than the optimistic canvas.
    // Merge server rows by id and preserve all temporary/pending rows.
    replaceAnnotations((current) => {
      const pending = current.filter((annotation) => annotation.id < 0);
      const serverIds = new Set(initialAnnotations.map((annotation) => annotation.id));
      const localPersisted = current.filter((annotation) => annotation.id > 0 && !serverIds.has(annotation.id));
      const serverRows = initialAnnotations.filter((annotation) => !deletedIdsRef.current.has(annotation.id));
      return [...serverRows, ...localPersisted, ...pending];
    });
  }, [initialAnnotations, noteId, pageNumber, replaceAnnotations, sourceFileId]);

  useEffect(() => () => {
    if (queueTimerRef.current != null) window.clearTimeout(queueTimerRef.current);
    mountedRef.current = false;
    // Drain already queued requests on view changes. A full browser shutdown may
    // still cancel in-flight HTTP, which cannot be made reliable with keepalive
    // through the authenticated Axios client.
    void processQueue();
  }, [processQueue]);

  function setTool(nextTool: AnnotationTool) {
    setToolState(nextTool);
    if (["pen", "pencil", "marker", "highlighter", "brush", "calligraphy", "dashed"].includes(nextTool)) {
      setPenTypeState(nextTool as PenType);
    }
  }

  function setPenType(nextPenType: PenType) {
    setPenTypeState(nextPenType);
    setToolState(nextPenType);
    setPenSize(PEN_DEFAULTS[nextPenType].size);
    setOpacity(PEN_DEFAULTS[nextPenType].opacity);
  }

  function beginStroke(point: StrokePoint, pointerType: string) {
    if (tool === "view" || tool === "eraser" || tool === "text" || tool === "comment") return;
    draftRef.current = { pointerType, points: [point] };
    setDraft({ pointerType, points: [point] });
  }

  function appendPoint(point: StrokePoint) {
    if (!draftRef.current) return;
    draftRef.current.points.push(point);
  }

  function cancelStroke() {
    draftRef.current = null;
    setDraft(null);
  }

  function getDraft(): DraftStroke | null {
    return draftRef.current;
  }

  function annotationPayload(annotation: SourceAnnotation) {
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...payload } = annotation;
    return payload;
  }

  function queueCreate(annotation: SourceAnnotation) {
    const temporaryId = annotation.id;
    scheduleQueue({
      key: `create:${temporaryId}`,
      run: async () => {
        const created = await createSourceAnnotation(annotationPayload(annotation));
        const optimistic = localAnnotationsRef.current.find((item) => item.id === temporaryId);
        if (!optimistic) {
          // The user erased/undid while this POST was in flight. Compensate so
          // the server cannot retain a stroke that is no longer on the canvas.
          await deleteSourceAnnotation(created.id);
          return;
        }
        const changedWhileSaving = !sameStroke(annotation, optimistic);
        const merged = { ...created, strokes_json: optimistic.strokes_json };
        if (changedWhileSaving) await updateSourceAnnotation(created.id, { strokes_json: optimistic.strokes_json });
        if (mountedRef.current) replaceAnnotations((current) => current.map((item) => item.id === temporaryId ? merged : item));
      },
    });
  }

  function finishStroke(anchorMetadata: Record<string, unknown> = {}) {
    const completed = draftRef.current;
    cancelStroke();
    if (!completed || completed.points.length < 2) return;
    const savedPageNumber = pageNumber ?? 1;
    const temporary: SourceAnnotation = {
      id: nextTemporaryId--,
      note_id: noteId,
      source_file_id: sourceFileId,
      book_id: null,
      page_number: savedPageNumber,
      location_anchor: { coordinateSpace: "normalized", page: savedPageNumber, ...anchorMetadata },
      annotation_type: tool === "highlighter" ? "highlighter" : completed.pointerType === "pen" ? "handwriting" : "pen",
      strokes_json: { version: 1, pointerType: completed.pointerType, penType, opacity, points: completed.points },
      highlight_data: null,
      comment_text: null,
      color,
      pen_size: penSize,
      tool_type: penType,
      created_at: new Date().toISOString(),
      updated_at: null,
    };
    replaceAnnotations((current) => [...current, temporary]);
    setRedoStack([]);
    setError(null);
    queueCreate(temporary);
  }

  function beginErase() {
    eraseBeforeRef.current = localAnnotationsRef.current;
  }

  function eraseAtPoint(point: StrokePoint) {
    if (tool !== "eraser") return;
    replaceAnnotations((current) => current.flatMap((annotation) => {
      const points = annotation.strokes_json?.points;
      if (!points?.length) return annotation;
      const segments = splitStrokeAtPoint(points, point);
      if (segments.length === 1 && segments[0].length === points.length) return annotation;
      if (eraserMode === "stroke") return [];
      return segments.map((segment, index) => ({
        ...annotation,
        id: index === 0 ? annotation.id : nextTemporaryId--,
        strokes_json: { ...annotation.strokes_json!, points: segment },
        updated_at: new Date().toISOString(),
      }));
    }));
  }

  function finishErase() {
    const before = eraseBeforeRef.current;
    eraseBeforeRef.current = null;
    if (!before) return;
    const after = localAnnotationsRef.current;
    const afterById = new Map(after.map((annotation) => [annotation.id, annotation]));
    for (const original of before) {
      const current = afterById.get(original.id);
      if (!current) {
        if (original.id > 0) {
          deletedIdsRef.current.add(original.id);
          scheduleQueue({ key: `delete:${original.id}`, run: () => deleteSourceAnnotation(original.id) });
        } else {
          cancelQueuedJob(`create:${original.id}`);
        }
      } else if (original.id > 0 && !sameStroke(original, current)) {
        scheduleQueue({ key: `update:${original.id}`, run: async () => { await updateSourceAnnotation(original.id, { strokes_json: current.strokes_json }); } });
      } else if (original.id < 0 && !sameStroke(original, current)) {
        queueCreate(current);
      }
    }
    const beforeIds = new Set(before.map((annotation) => annotation.id));
    after.filter((annotation) => annotation.id < 0 && !beforeIds.has(annotation.id)).forEach(queueCreate);
    setRedoStack([]);
  }

  function eraseAnnotation(id: number) {
    const target = localAnnotationsRef.current.find((annotation) => annotation.id === id);
    if (!target) return;
    replaceAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    if (id > 0) {
      deletedIdsRef.current.add(id);
      scheduleQueue({ key: `delete:${id}`, run: () => deleteSourceAnnotation(id) });
    } else cancelQueuedJob(`create:${id}`);
  }

  function addTextAnnotation(point: StrokePoint, annotationType: "text" | "comment", text: string) {
    if (!text.trim()) return;
    const temporary: SourceAnnotation = {
      id: nextTemporaryId--, note_id: noteId, source_file_id: sourceFileId, book_id: null,
      page_number: pageNumber ?? 1,
      location_anchor: { coordinateSpace: "normalized", page: pageNumber ?? 1, x: point.x, y: point.y },
      annotation_type: annotationType, strokes_json: null, highlight_data: null, comment_text: text.trim(),
      color, pen_size: penSize, tool_type: annotationType, created_at: new Date().toISOString(), updated_at: null,
    };
    replaceAnnotations((current) => [...current, temporary]);
    setRedoStack([]);
    queueCreate(temporary);
  }

  function undo() {
    const latest = annotations[annotations.length - 1];
    if (!latest) return;
    replaceAnnotations((current) => current.filter((annotation) => annotation.id !== latest.id));
    setRedoStack((current) => [...current, latest]);
    if (latest.id > 0) {
      deletedIdsRef.current.add(latest.id);
      scheduleQueue({ key: `delete:${latest.id}`, run: () => deleteSourceAnnotation(latest.id) });
    } else cancelQueuedJob(`create:${latest.id}`);
  }

  function redo() {
    const latest = redoStack[redoStack.length - 1];
    if (!latest) return;
    const recreated = { ...latest, id: nextTemporaryId--, created_at: new Date().toISOString(), updated_at: null };
    replaceAnnotations((current) => [...current, recreated]);
    setRedoStack((current) => current.slice(0, -1));
    queueCreate(recreated);
  }

  return {
    tool, setTool, penType, setPenType, eraserMode, setEraserMode,
    color, setColor, penSize, setPenSize, opacity, setOpacity,
    draft, getDraft, annotations, saving: pendingCount > 0, pendingCount, error, retryFailed,
    canUndo: annotations.length > 0, canRedo: redoStack.length > 0,
    beginStroke, appendPoint, cancelStroke, finishStroke,
    beginErase, eraseAtPoint, finishErase, eraseAnnotation, addTextAnnotation, undo, redo,
  };
}
