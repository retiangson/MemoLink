import React, { useRef, useCallback } from "react";

interface SplitPaneProps {
  direction: "horizontal" | "vertical";
  ratio: number;
  onRatioChange: (r: number) => void;
  first: React.ReactNode;
  second: React.ReactNode;
  minRatio?: number;
  maxRatio?: number;
}

export function SplitPane({
  direction,
  ratio,
  onRatioChange,
  first,
  second,
  minRatio = 0.2,
  maxRatio = 0.8,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let r =
          direction === "horizontal"
            ? (ev.clientX - rect.left) / rect.width
            : (ev.clientY - rect.top) / rect.height;
        r = Math.max(minRatio, Math.min(maxRatio, r));
        onRatioChange(r);
      };

      const onMouseUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [direction, minRatio, maxRatio, onRatioChange]
  );

  const pct = `${ratio * 100}%`;
  const rest = `${(1 - ratio) * 100}%`;

  if (direction === "horizontal") {
    return (
      <div ref={containerRef} className="flex flex-row h-full w-full overflow-hidden">
        <div style={{ width: pct }} className="overflow-hidden flex flex-col min-w-0">
          {first}
        </div>
        <div
          onMouseDown={onMouseDown}
          className="w-1 shrink-0 bg-[var(--ml-bg-panel)] hover:bg-indigo-500/60 active:bg-indigo-500 cursor-col-resize transition-colors select-none"
        />
        <div style={{ width: rest }} className="overflow-hidden flex flex-col min-w-0">
          {second}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full overflow-hidden">
      <div style={{ height: pct }} className="overflow-hidden flex flex-col min-h-0">
        {first}
      </div>
      <div
        onMouseDown={onMouseDown}
        className="h-1 shrink-0 bg-[var(--ml-bg-panel)] hover:bg-indigo-500/60 active:bg-indigo-500 cursor-row-resize transition-colors select-none"
      />
      <div style={{ height: rest }} className="overflow-hidden flex flex-col min-h-0">
        {second}
      </div>
    </div>
  );
}
