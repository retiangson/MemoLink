import { useEffect, useRef } from "react";

/**
 * Captures a completed native text selection as soon as the owning document reports it.
 * Mobile browsers do not reliably emit mouseup after long-press selection, while
 * selectionchange is emitted for both initial selection and handle adjustments.
 */
export function useSelectionChangeCapture(capture: () => boolean): void {
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      captureRef.current();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);
}
