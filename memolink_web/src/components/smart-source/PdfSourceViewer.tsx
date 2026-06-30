import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { SourceAnnotation } from "../../api/smartSourceApi";
import { AnnotationCanvas } from "./AnnotationCanvas";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  noteId: number;
  sourceFileId: number;
  bookId: number | null;
  objectUrl: string;
  annotations: SourceAnnotation[];
  onAnnotationsChanged: () => void;
}

export function PdfSourceViewer({ noteId, sourceFileId, bookId, objectUrl, annotations, onAnnotationsChanged }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [hostSize, setHostSize] = useState({ width: 800, height: 900 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isMaximized) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMaximized(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMaximized]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setHostSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [isMaximized]);

  useEffect(() => {
    let disposed = false;
    setError(null);
    setPageNumber(1);
    void (async () => {
      try {
        const response = await fetch(objectUrl);
        if (!response.ok) throw new Error("Could not read the cached PDF");
        const task = pdfjsLib.getDocument({ data: await response.arrayBuffer() });
        loadingTaskRef.current = task;
        const document = await task.promise;
        if (disposed) {
          void task.destroy().catch(() => {});
          return;
        }
        documentRef.current = document;
        setPageCount(document.numPages);
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : "Could not open this PDF");
      }
    })();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      documentRef.current = null;
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (task) void task.destroy().catch(() => {});
    };
  }, [objectUrl]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageNumber]);

  useEffect(() => {
    const document = documentRef.current;
    const canvas = canvasRef.current;
    if (!document || !canvas || hostSize.width <= 0 || hostSize.height <= 0) return;
    let disposed = false;
    renderTaskRef.current?.cancel();
    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(240, hostSize.width - 32);
        // Fit to the available width and let the viewer scroll vertically. Fitting
        // against height as well makes portrait documents unreadably small inside
        // the note workspace, especially when side panels are open.
        const cssScale = Math.max(0.25, Math.min(3, availableWidth / base.width));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        if (disposed) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${viewport.width / pixelRatio}px`;
        canvas.style.height = `${viewport.height / pixelRatio}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering is unavailable");
        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (caught) {
        if (!disposed && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setError("Could not render this PDF page");
        }
      }
    })();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [hostSize, pageCount, pageNumber]);

  const viewer = (
    <div ref={hostRef} className={`flex min-h-0 flex-col bg-[#171720] ${isMaximized ? "fixed inset-0 z-[100] h-dvh w-screen" : "h-full"}`}>
      {error ? (
        <div className="grid flex-1 place-items-center text-sm text-red-400">{error}</div>
      ) : (
        <div ref={scrollRef} className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
          <div className="relative shrink-0 bg-white shadow-xl">
            <canvas ref={canvasRef} className="block" />
            <AnnotationCanvas noteId={noteId} sourceFileId={sourceFileId} bookId={bookId} pageNumber={pageNumber} annotations={annotations} onPersisted={onAnnotationsChanged} />
          </div>
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center justify-center gap-2 bg-black/35 px-4 text-xs text-gray-200">
        <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)} title="Previous page" className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-35 hover:bg-white/10 transition">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="min-w-[90px] text-center">Page {pageNumber} of {pageCount || "…"}</span>
        <button type="button" disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber((p) => p + 1)} title="Next page" className="flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-35 hover:bg-white/10 transition">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <button
          type="button"
          onClick={() => setIsMaximized((current) => !current)}
          title={isMaximized ? "Restore note view (Esc)" : "Maximize document"}
          aria-label={isMaximized ? "Restore document view" : "Maximize document"}
          aria-pressed={isMaximized}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          {isMaximized ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
          )}
        </button>
      </div>
    </div>
  );
  return isMaximized ? createPortal(viewer, document.body) : viewer;
}
