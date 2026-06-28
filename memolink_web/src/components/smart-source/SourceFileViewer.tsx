import React from "react";
import type { SourceAnnotation, SourceFileMetadata } from "../../api/smartSourceApi";
import { useSourceFileCache } from "../../hooks/useSourceFileCache";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { PdfSourceViewer } from "./PdfSourceViewer";

interface Props {
  noteId: number;
  source: SourceFileMetadata | null;
  annotations: SourceAnnotation[];
  onAnnotationsChanged: () => void;
  onCacheStatus: (status: string) => void;
}

export function SourceFileViewer({ noteId, source, annotations, onAnnotationsChanged, onCacheStatus }: Props) {
  const cache = useSourceFileCache(source);
  React.useEffect(() => onCacheStatus(cache.status), [cache.status, onCacheStatus]);
  if (!source) return <div className="flex h-full items-center justify-center text-sm text-gray-500">Link or upload an original source to use this workspace.</div>;
  const isPdf = source.mime_type === "application/pdf" || source.original_filename.toLowerCase().endsWith(".pdf");
  const isImage = source.mime_type?.startsWith("image/");
  return (
    <div className="relative h-full overflow-hidden bg-[#171720]">
      {cache.status === "loading" && <div className="absolute inset-0 z-20 grid place-items-center bg-black/40 text-sm text-gray-300">Loading local source cache…</div>}
      {cache.status === "stale" && <div className="absolute left-3 right-3 top-12 z-30 rounded-lg bg-amber-500/90 p-2 text-xs text-black">The OneDrive source version changed. Your annotations are preserved. <button onClick={cache.refresh} className="font-semibold underline">Load the new version</button></div>}
      {cache.error && <div className="p-5 text-sm text-red-400">{cache.error}</div>}
      {cache.objectUrl && isPdf && <PdfSourceViewer noteId={noteId} sourceFileId={source.id} objectUrl={cache.objectUrl} annotations={annotations} onAnnotationsChanged={onAnnotationsChanged} />}
      {cache.objectUrl && isImage && (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          <div className="relative inline-block max-h-full max-w-full">
            <img src={cache.objectUrl} alt={source.original_filename} className="block max-h-[calc(100vh-15rem)] max-w-full object-contain" />
            <AnnotationCanvas noteId={noteId} sourceFileId={source.id} annotations={annotations} onPersisted={onAnnotationsChanged} />
          </div>
        </div>
      )}
      {cache.objectUrl && !isPdf && !isImage && <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-500">Preview is currently available for PDF and image sources. The original remains cached locally and available in OneDrive.</div>}
    </div>
  );
}
