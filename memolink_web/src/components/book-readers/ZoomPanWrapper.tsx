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

  // At zoom=1 outside fullscreen, allow single-touch native scroll.
  // Once pinched in (zoom > 1) or in fullscreen, intercept all touch so
  // panning works correctly and the browser doesn't fight us.
  const isZoomedIn = zoom > 1.01;
  const touchAction = (active || isZoomedIn) ? "none" : "pan-x pan-y";

  // Always render the SAME two-level DOM structure regardless of active state.
  // Changing the wrapper structure causes React to re-mount children, which blanks
  // the PDF canvas, resets TTS playback state, and re-fetches book content.
  return (
    <div
      ref={containerRef}
      className={`flex-1 relative min-h-0 flex flex-col overflow-hidden ${active ? surfaceClass : ""}`}
      style={{
        cursor: active ? (isDragging ? "grabbing" : "grab") : undefined,
        touchAction,
      }}
      onMouseDown={active ? handlers.onMouseDown : undefined}
    >
      {/* Stable child-wrapper: transform always applied (no-op at zoom=1/pan=0),
          so pinch-to-zoom works outside fullscreen without changing DOM structure. */}
      <div
        style={
          (active || isZoomedIn)
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
                // Keep transform in the DOM even at zoom=1 so the transition is
                // smooth if the user pinches — but as a no-op value.
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                transformOrigin: "0 0",
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
