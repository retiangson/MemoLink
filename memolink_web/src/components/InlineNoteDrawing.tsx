import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { SourceAnnotation } from "../api/smartSourceApi";
import { AnnotationCanvas } from "./smart-source/AnnotationCanvas";

interface DrawingContextValue {
  noteId: number | null;
  annotations: SourceAnnotation[];
  onAnnotationsChanged: () => void;
}

export const InlineNoteDrawingContext = createContext<DrawingContextValue>({
  noteId: null,
  annotations: [],
  onAnnotationsChanged: () => undefined,
});

function InlineNoteDrawingView({
  node,
  selected,
  deleteNode,
}: {
  node: { attrs: { pageNumber: number } };
  selected: boolean;
  deleteNode: () => void;
}) {
  const drawing = useContext(InlineNoteDrawingContext);
  const pageNumber = Number(node.attrs.pageNumber) || 1;

  return (
    <NodeViewWrapper
      className={`note-drawing-block ${selected ? "note-drawing-block-selected" : ""}`}
      data-note-drawing-page={pageNumber}
      contentEditable={false}
    >
      <div data-inline-drawing-surface className="relative h-72 min-h-[18rem] overflow-hidden rounded-xl bg-white sm:h-96">
        {drawing.noteId == null ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Saving note before drawing…</div>
        ) : (
          <AnnotationCanvas
            noteId={drawing.noteId}
            sourceFileId={null}
            pageNumber={pageNumber}
            annotations={drawing.annotations}
            onPersisted={drawing.onAnnotationsChanged}
          />
        )}
        <button
          type="button"
          onClick={deleteNode}
          className="absolute bottom-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900/75 text-gray-300 shadow hover:bg-red-600 hover:text-white"
          title="Remove drawing area from note"
          aria-label="Remove drawing area from note"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16"/><path d="m9 7 1-3h4l1 3"/><path d="m6 7 1 14h10l1-14"/></svg>
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const InlineNoteDrawing = Node.create({
  name: "noteDrawing",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      pageNumber: {
        default: 1,
        parseHTML: (element: HTMLElement) => Math.max(1, Number(element.getAttribute("data-note-drawing-page")) || 1),
        renderHTML: (attributes: { pageNumber?: number }) => ({
          "data-note-drawing-page": Math.max(1, Number(attributes.pageNumber) || 1),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-note-drawing-page]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-drawing": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineNoteDrawingView, {
      stopEvent: ({ event }) => Boolean((event.target as HTMLElement).closest?.("[data-inline-drawing-surface]")),
    });
  },
});
