import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { SourceAnnotation } from "../../api/smartSourceApi";
import { AnnotationCanvas } from "./AnnotationCanvas";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  noteId: number;
  sourceFileId: number;
  objectUrl: string;
  annotations: SourceAnnotation[];
  onAnnotationsChanged: () => void;
}

export function PdfSourceViewer({ noteId, sourceFileId, objectUrl, annotations, onAnnotationsChanged }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [hostSize, setHostSize] = useState({ width: 800, height: 900 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setHostSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    setError(null);
    setPageNumber(1);
    void (async () => {
      try {
        const response = await fetch(objectUrl);
        if (!response.ok) throw new Error("Could not read the cached PDF");
        const task = pdfjsLib.getDocument({ data: await response.arrayBuffer() });
        const document = await task.promise;
        if (disposed) {
          await document.destroy();
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
      const document = documentRef.current;
      documentRef.current = null;
      if (document) void document.destroy();
    };
  }, [objectUrl]);

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
        const availableHeight = Math.max(240, hostSize.height - 72);
        const cssScale = Math.min(availableWidth / base.width, availableHeight / base.height);
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

  return (
    <div ref={hostRef} className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-center gap-3 bg-black/35 text-xs text-gray-200">
        <button type="button" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)} className="rounded px-2 py-1 disabled:opacity-35">Previous</button>
        <span>Page {pageNumber} of {pageCount || "…"}</span>
        <button type="button" disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber((page) => page + 1)} className="rounded px-2 py-1 disabled:opacity-35">Next</button>
      </div>
      {error ? <div className="grid flex-1 place-items-center text-sm text-red-400">{error}</div> : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <div className="relative shrink-0 bg-white shadow-xl">
            <canvas ref={canvasRef} className="block" />
            <AnnotationCanvas noteId={noteId} sourceFileId={sourceFileId} pageNumber={pageNumber} annotations={annotations} onPersisted={onAnnotationsChanged} />
          </div>
        </div>
      )}
    </div>
  );
}
