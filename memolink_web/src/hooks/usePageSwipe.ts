import { useRef } from "react";

export type SwipeDirection = "prev" | "next" | null;

/** Shared swipe-distance logic, reused by the React hook below and by EpubReaderView's
 *  raw DOM listeners attached inside the rendition's iframe documents. */
export function computeSwipeDirection(dx: number, dy: number, threshold: number): SwipeDirection {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return null;
  return dx < 0 ? "next" : "prev";
}

/** Detects a horizontal swipe (left = next, right = prev) without blocking normal vertical scrolling. */
export function usePageSwipe(onPrev: () => void, onNext: () => void, threshold = 50) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dir = computeSwipeDirection(t.clientX - start.x, t.clientY - start.y, threshold);
    if (dir === "next") onNext();
    else if (dir === "prev") onPrev();
  }

  return { onTouchStart, onTouchEnd };
}
