import { useEffect, useRef, type RefObject } from "react";

/**
 * Captures a completed native text selection as soon as the owning document reports it.
 * Mobile browsers do not reliably emit mouseup after long-press selection, while
 * selectionchange is emitted for both initial selection and handle adjustments.
 */
export function useSelectionChangeCapture(
  containerRef: RefObject<HTMLElement | null>,
  capture: () => void,
): void {
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    const ownerDocument = containerRef.current?.ownerDocument
      ?? (typeof document !== "undefined" ? document : null);
    if (!ownerDocument) return;

    const onSelectionChange = () => {
      const container = containerRef.current;
      const selection = ownerDocument.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      if (!container || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
      captureRef.current();
    };
    ownerDocument.addEventListener("selectionchange", onSelectionChange);
    return () => ownerDocument.removeEventListener("selectionchange", onSelectionChange);
  }, [containerRef]);
}
