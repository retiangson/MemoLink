import React from "react";
import { useZoomPan } from "../../hooks/useZoomPan";

interface Props {
  active: boolean;
  children: React.ReactNode;
}

export function ZoomPanWrapper({ active, children }: Props) {
  const { containerRef, transform, isDragging, handlers } = useZoomPan(active);

  if (!active) return <>{children}</>;

  const { zoom, panX, panY } = transform;

  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden"
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
      {...handlers}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          transformOrigin: "0 0",
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          willChange: "transform",
        }}
      >
        {children}
      </div>
      {/* Overlay during drag: captures events above iframes so the drag doesn't get stolen */}
      {isDragging && <div className="absolute inset-0 z-10" style={{ cursor: "grabbing" }} />}
    </div>
  );
}
