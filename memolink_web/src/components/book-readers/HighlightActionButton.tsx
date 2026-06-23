import React, { useState } from "react";

interface Props {
  x: number;
  y: number;
  onHighlight: () => Promise<void>;
}

// Floating pill shown above an active text selection in any of the three text-based
// readers (PDF/EPUB/PPTX) — clicking it saves the selection as a highlight and appends
// it to the book's "{Title} - Highlights" note.
export function HighlightActionButton({ x, y, onHighlight }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  async function handleClick() {
    if (state !== "idle") return;
    setState("saving");
    try {
      await onHighlight();
      setState("done");
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      onClick={handleClick}
      style={{ position: "fixed", left: x, top: y, transform: "translate(-50%, -100%) translateY(-8px)" }}
      className="z-50 px-3 py-1.5 text-xs font-medium rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 transition disabled:opacity-70"
      disabled={state !== "idle"}
    >
      {state === "done" ? "Added ✓" : state === "saving" ? "Saving…" : "Highlight"}
    </button>
  );
}
