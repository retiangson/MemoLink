import { useState, useRef, useEffect, useCallback } from "react";

export interface ZoomPanTransform {
  zoom: number;
  panX: number;
  panY: number;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4.0;
const SWIPE_THRESHOLD_PX = 60;
const DRAG_START_PX = 5;

export interface UseZoomPanOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

interface ContentBounds {
  /** Natural distance from transform origin to the page-card's LEFT edge. */
  offsetX: number;
  /** Natural distance from transform origin to the page-card's TOP edge. */
  offsetY: number;
  /** Natural distance from transform origin to the page-card's RIGHT edge. */
  effectiveW: number;
  /** Natural distance from transform origin to the page-card's BOTTOM edge. */
  effectiveH: number;
}

const EMPTY_BOUNDS: ContentBounds = { offsetX: 0, offsetY: 0, effectiveW: 0, effectiveH: 0 };

/**
 * Measure the page card's natural (pre-zoom) position and size within the transform div.
 *
 * ZoomPanWrapper always renders the same structure:
 *   containerEl > [0] inner stable div > [0] reader content div > [0] page card element
 *
 * We read the rendered (post-zoom) rect and convert back to natural coordinates using
 * the current pan and zoom so that the result is stable across zoom levels.
 */
function measureBounds(
  containerEl: HTMLElement,
  panX: number,
  panY: number,
  zoom: number,
): ContentBounds {
  const pageCard = containerEl.children[0]?.children[0]?.children[0] as HTMLElement | null;
  if (!pageCard) return EMPTY_BOUNDS;
  const pRect = pageCard.getBoundingClientRect();
  const cRect = containerEl.getBoundingClientRect();
  if (!pRect.width || !pRect.height) return EMPTY_BOUNDS;

  // Convert rendered (viewport) position to local (pre-zoom) coordinates inside the transform div.
  const localLeft = (pRect.left - cRect.left - panX) / zoom;
  const localTop  = (pRect.top  - cRect.top  - panY) / zoom;
  const naturalW  = pRect.width  / zoom;
  const naturalH  = pRect.height / zoom;

  return {
    offsetX:   localLeft,
    offsetY:   localTop,
    effectiveW: localLeft + naturalW,
    effectiveH: localTop  + naturalH,
  };
}

/**
 * Clamp pan so the page card never scrolls beyond its own edges.
 *
 * For each axis we compute two "flush" pan values:
 *   - A = pan that puts the page's near edge flush with the container's near edge
 *   - B = pan that puts the page's far edge flush with the container's far edge
 * The valid range is [min(A,B), max(A,B)].
 *
 * This works whether the page is smaller than (both values have a small gap between
 * them) or larger than the container (they swap order, giving a wide traversal range).
 *
 * The centering offset from `flex justify-center` (or `py-6`/`px-4` padding) is
 * captured in offsetX/offsetY, so the right/bottom of the page is always reachable.
 */
function clampPan(
  panX: number,
  panY: number,
  zoom: number,
  containerW: number,
  containerH: number,
  b: ContentBounds,
): { panX: number; panY: number } {
  if (!b.effectiveW || !b.effectiveH) {
    // No measurement yet — conservative fallback
    return { panX: Math.min(0, panX), panY: Math.min(0, panY) };
  }

  // X axis
  const xNear = -b.offsetX * zoom;                 // left-flush panX
  const xFar  = containerW - b.effectiveW * zoom;  // right-flush panX
  const minPanX = Math.min(xNear, xFar);
  const maxPanX = Math.max(xNear, xFar);

  // Y axis
  const yNear = -b.offsetY * zoom;                  // top-flush panY
  const yFar  = containerH - b.effectiveH * zoom;   // bottom-flush panY
  const minPanY = Math.min(yNear, yFar);
  const maxPanY = Math.max(yNear, yFar);

  return {
    panX: Math.max(minPanX, Math.min(maxPanX, panX)),
    panY: Math.max(minPanY, Math.min(maxPanY, panY)),
  };
}

export function useZoomPan(active: boolean, options: UseZoomPanOptions = {}) {
  const [transform, _setTransform] = useState<ZoomPanTransform>({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const transformRef   = useRef<ZoomPanTransform>({ zoom: 1, panX: 0, panY: 0 });
  const containerRef   = useRef<HTMLDivElement>(null);
  const isDraggingRef  = useRef(false);
  const isPressedRef   = useRef(false);
  const dragStart      = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchStateRef  = useRef(new Map<number, { x: number; y: number }>());
  const lastPinchDistRef = useRef<number | null>(null);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  // Cached natural bounds measured once per drag; re-used for clamping during the gesture.
  const boundsRef = useRef<ContentBounds>(EMPTY_BOUNDS);

  const onSwipeLeftRef  = useRef(options.onSwipeLeft);
  const onSwipeRightRef = useRef(options.onSwipeRight);
  useEffect(() => { onSwipeLeftRef.current  = options.onSwipeLeft;  }, [options.onSwipeLeft]);
  useEffect(() => { onSwipeRightRef.current = options.onSwipeRight; }, [options.onSwipeRight]);

  const setTransform = useCallback((fn: (prev: ZoomPanTransform) => ZoomPanTransform) => {
    _setTransform((prev) => {
      const next = fn(prev);
      transformRef.current = next;
      return next;
    });
  }, []);

  // Reset everything when entering or exiting fullscreen
  useEffect(() => {
    const reset: ZoomPanTransform = { zoom: 1, panX: 0, panY: 0 };
    transformRef.current = reset;
    _setTransform(reset);
    isDraggingRef.current = false;
    isPressedRef.current  = false;
    boundsRef.current     = EMPTY_BOUNDS;
    setIsDragging(false);
  }, [active]);

  // Wheel + touch: native non-passive listeners so preventDefault actually works
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect   = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setTransform((prev) => {
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
        const ratio   = newZoom / prev.zoom;
        const rawPanX = mx - (mx - prev.panX) * ratio;
        const rawPanY = my - (my - prev.panY) * ratio;
        // Measure once; the natural offset is stable so the cached value stays valid.
        if (!boundsRef.current.effectiveW) {
          boundsRef.current = measureBounds(el, prev.panX, prev.panY, prev.zoom);
        }
        const clamped = clampPan(rawPanX, rawPanY, newZoom, el.clientWidth, el.clientHeight, boundsRef.current);
        return { zoom: newZoom, ...clamped };
      });
    };

    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        touchStateRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (e.touches.length === 1) {
        touchStartXRef.current   = e.touches[0].clientX;
        touchStartYRef.current   = e.touches[0].clientY;
        lastPinchDistRef.current = null;
      } else if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        lastPinchDistRef.current = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length >= 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        if (lastPinchDistRef.current !== null && dist > 0) {
          const scale = dist / lastPinchDistRef.current;
          const rect  = el.getBoundingClientRect();
          const mx = (a.clientX + b.clientX) / 2 - rect.left;
          const my = (a.clientY + b.clientY) / 2 - rect.top;
          setTransform((prev) => {
            const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * scale));
            const ratio   = newZoom / prev.zoom;
            const rawPanX = mx - (mx - prev.panX) * ratio;
            const rawPanY = my - (my - prev.panY) * ratio;
            const clamped = clampPan(rawPanX, rawPanY, newZoom, el.clientWidth, el.clientHeight, boundsRef.current);
            return { zoom: newZoom, ...clamped };
          });
        }
        lastPinchDistRef.current = dist;
        for (const t of Array.from(e.touches)) {
          touchStateRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      } else if (e.touches.length === 1) {
        const t    = e.touches[0];
        const prev = touchStateRef.current.get(t.identifier);
        if (prev) {
          setTransform((p) => {
            const rawPanX = p.panX + (t.clientX - prev.x);
            const rawPanY = p.panY + (t.clientY - prev.y);
            const clamped = clampPan(rawPanX, rawPanY, p.zoom, el.clientWidth, el.clientHeight, boundsRef.current);
            return { ...p, ...clamped };
          });
        }
        touchStateRef.current.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) touchStateRef.current.delete(t.identifier);
      if (e.touches.length < 2) lastPinchDistRef.current = null;

      // Horizontal swipe at low zoom → page navigation
      if (e.touches.length === 0 && e.changedTouches.length === 1 && transformRef.current.zoom < 1.05) {
        const dx = e.changedTouches[0].clientX - touchStartXRef.current;
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartYRef.current);
        if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > dy) {
          if (dx < 0) onSwipeLeftRef.current?.();
          else        onSwipeRightRef.current?.();
        }
      }
    };

    el.addEventListener("wheel",      onWheel,      { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true  });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true  });

    return () => {
      el.removeEventListener("wheel",      onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, [active, setTransform]);

  // Global mousemove/mouseup — drag continues even when cursor leaves the container
  useEffect(() => {
    if (!active) return;

    const onMove = (e: MouseEvent) => {
      if (!isPressedRef.current) return;
      const dxTotal = e.clientX - dragStart.current.x;
      const dyTotal = e.clientY - dragStart.current.y;

      if (!isDraggingRef.current && Math.hypot(dxTotal, dyTotal) < DRAG_START_PX) return;
      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        setIsDragging(true);
      }

      const el = containerRef.current;
      if (!el) return;
      const { zoom } = transformRef.current;

      const rawPanX = dragStart.current.panX + dxTotal;
      const rawPanY = dragStart.current.panY + dyTotal;
      const clamped = clampPan(rawPanX, rawPanY, zoom, el.clientWidth, el.clientHeight, boundsRef.current);

      _setTransform((prev) => {
        const next = { zoom: prev.zoom, ...clamped };
        transformRef.current = next;
        return next;
      });
    };

    const onUp = () => {
      if (!isPressedRef.current) return;
      isPressedRef.current = false;
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [active]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!active || e.button !== 0) return;
      e.preventDefault();
      const el = containerRef.current;
      const { panX, panY, zoom } = transformRef.current;
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      // Measure natural bounds once at drag-start; reused for the whole gesture.
      if (el) boundsRef.current = measureBounds(el, panX, panY, zoom);
      isPressedRef.current = true;
    },
    [active],
  );

  return { containerRef, transform, isDragging, handlers: { onMouseDown } };
}
