import React from "react";
import { useZoomPan } from "../../hooks/useZoomPan";

interface Props {
  active: boolean;
  children: React.ReactNode;
  /** Rendered outside the zoom/pan transform so it stays fixed during pan/zoom. */
  overlay?: React.ReactNode;
  surfaceClass?: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function ZoomPanWrapper({ active, children, overlay, surfaceClass = "", onSwipeLeft, onSwipeRight }: Props) {
  const { containerRef, transform, isDragging, handlers } = useZoomPan(active, { onSwipeLeft, onSwipeRight });
  const { zoom, panX, panY } = transform;

  // Always render the SAME two-level DOM structure regardless of active state.
  // Changing the wrapper structure causes React to re-mount children, which blanks
  // the PDF canvas, resets TTS playback state, and re-fetches book content.
  return (
    <div
      ref={containerRef}
      className={`flex-1 relative min-h-0 flex flex-col ${active ? `overflow-hidden ${surfaceClass}` : ""}`}
      style={{
        cursor: active ? (isDragging ? "grabbing" : "grab") : undefined,
        touchAction: active ? "none" : undefined,
      }}
      onMouseDown={active ? handlers.onMouseDown : undefined}
    >
      {/* Stable child-wrapper: transform applied in active mode, plain flex in passive */}
      <div
        style={
          active
            ? {
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                overflow: "visible",
                transformOrigin: "0 0",
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                willChange: "transform",
              }
            : {
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }
        }
      >
        {children}
      </div>

      {overlay && (
        active ? (
          // In active mode: overlay sits outside the transform so it doesn't scale/pan.
          // pointer-events-none on the container lets book-content pointer events through;
          // the arrow buttons (inside the innermost pointer-events-auto div) stay clickable.
          <div
            className="absolute inset-0 pointer-events-none"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none w-full h-full relative">
              <div className="pointer-events-auto">{overlay}</div>
            </div>
          </div>
        ) : (
          overlay
        )
      )}

      {/* Drag-capture overlay: prevents iframes from stealing mouse events during pan */}
      {active && isDragging && (
        <div className="absolute inset-0 z-10" style={{ cursor: "grabbing" }} />
      )}
    </div>
  );
}
