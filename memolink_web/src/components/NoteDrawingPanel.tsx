import type { SourceAnnotation } from "../api/smartSourceApi";
import { AnnotationCanvas } from "./smart-source/AnnotationCanvas";

interface NoteDrawingPanelProps {
  noteId: number;
  annotations: SourceAnnotation[];
  onAnnotationsChanged: () => void;
  onClose: () => void;
}

export function NoteDrawingPanel({ noteId, annotations, onAnnotationsChanged, onClose }: NoteDrawingPanelProps) {
  const noteAnnotations = annotations.filter((annotation) => annotation.source_file_id == null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Note drawing canvas">
      <div className="flex h-full max-h-[900px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-panel)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--ml-bg-hover)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Note Drawing</h2>
            <p className="text-[11px] text-gray-500">Drawings and handwriting autosave as editable strokes.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-white">Close</button>
        </div>
        <div className="relative min-h-0 flex-1 bg-white" style={{ backgroundImage: "radial-gradient(#d1d5db 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          <AnnotationCanvas
            noteId={noteId}
            sourceFileId={null}
            annotations={noteAnnotations}
            onPersisted={onAnnotationsChanged}
          />
        </div>
      </div>
    </div>
  );
}
