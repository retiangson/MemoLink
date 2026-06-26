import { useState, useRef, useEffect, useCallback } from "react";

export interface ZoomPanTransform {
  zoom: number;
  panX: number;
  panY: number;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4.0;

export function useZoomPan(active: boolean) {
  const [transform, _setTransform] = useState<ZoomPanTransform>({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const transformRef = useRef<ZoomPanTransform>({ zoom: 1, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchState = useRef(new Map<number, { x: number; y: number }>());
  const lastPinchDist = useRef<number | null>(null);

  const setTransform = useCallback((fn: (prev: ZoomPanTransform) => ZoomPanTransform) => {
    _setTransform((prev) => {
      const next = fn(prev);
      transformRef.current = next;
      return next;
    });
  }, []);

  // Reset whenever active changes
  useEffect(() => {
    const reset: ZoomPanTransform = { zoom: 1, panX: 0, panY: 0 };
    transformRef.current = reset;
    _setTransform(reset);
    setIsDragging(false);
  }, [active]);

  // Wheel zoom must be a non-passive native listener so preventDefault works
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setTransform((prev) => {
        const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
        const ratio = newZoom / prev.zoom;
        return { zoom: newZoom, panX: mx - (mx - prev.panX) * ratio, panY: my - (my - prev.panY) * ratio };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [active, setTransform]);

  // Release drag if mouse is released anywhere on the page
  useEffect(() => {
    if (!active) return;
    const up = () => setIsDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [active]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!active || e.button !== 0) return;
      e.preventDefault();
      const { panX, panY } = transformRef.current;
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      setIsDragging(true);
    },
    [active],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTransform((prev) => ({
        ...prev,
        panX: dragStart.current.panX + dx,
        panY: dragStart.current.panY + dy,
      }));
    },
    [isDragging, setTransform],
  );

  const onMouseUp = useCallback(() => setIsDragging(false), []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!active) return;
      for (const t of Array.from(e.changedTouches)) {
        touchState.current.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        lastPinchDist.current = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      } else {
        lastPinchDist.current = null;
      }
    },
    [active],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!active) return;
      if (e.touches.length >= 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        if (lastPinchDist.current !== null && dist > 0) {
          const scale = dist / lastPinchDist.current;
          const rect = containerRef.current?.getBoundingClientRect();
          const mx = (a.clientX + b.clientX) / 2 - (rect?.left ?? 0);
          const my = (a.clientY + b.clientY) / 2 - (rect?.top ?? 0);
          setTransform((prev) => {
            const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * scale));
            const ratio = newZoom / prev.zoom;
            return { zoom: newZoom, panX: mx - (mx - prev.panX) * ratio, panY: my - (my - prev.panY) * ratio };
          });
        }
        lastPinchDist.current = dist;
        for (const t of Array.from(e.touches)) {
          touchState.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const prev = touchState.current.get(t.identifier);
        if (prev) {
          setTransform((p) => ({ ...p, panX: p.panX + (t.clientX - prev.x), panY: p.panY + (t.clientY - prev.y) }));
        }
        touchState.current.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    },
    [active, setTransform],
  );

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) touchState.current.delete(t.identifier);
    if (e.touches.length < 2) lastPinchDist.current = null;
  }, []);

  return {
    containerRef,
    transform,
    isDragging,
    handlers: { onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove, onTouchEnd },
  };
}
