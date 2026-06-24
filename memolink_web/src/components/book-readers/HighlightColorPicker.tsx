import React, { useState } from "react";
import { HIGHLIGHT_COLORS } from "./highlightColors";

interface Props {
  value: string;
  onChange: (colorId: string) => void;
  disabled?: boolean;
  onApply?: (colorId: string) => Promise<void> | void;
}

// Single combined control in every highlight-capable reader's footer: a swatch + "Highlight"
// label. Disabled until the reader has an active text selection; clicking it then opens the
// color row — picking a color highlights the current selection with that color and remembers
// it as the default swatch shown next time.
export function HighlightColorPicker({ value, onChange, disabled = false, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const current = HIGHLIGHT_COLORS.find((c) => c.id === value) ?? HIGHLIGHT_COLORS[0];
  const isDisabled = disabled || status !== "idle";

  async function pick(colorId: string) {
    setOpen(false);
    onChange(colorId);
    if (!onApply) return;
    setStatus("saving");
    try {
      await onApply(colorId);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("idle");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => !isDisabled && setOpen((v) => !v)}
        disabled={isDisabled}
        title={disabled ? "Select text to highlight" : `Highlight color: ${current.label}`}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition ${
          isDisabled
            ? "border-[var(--ml-bg-hover)] text-gray-600 opacity-50 cursor-not-allowed"
            : "border-[var(--ml-bg-hover)] text-gray-300 hover:bg-[var(--ml-bg-hover)]"
        }`}
      >
        <span className="w-3 h-3 rounded-full ring-1 ring-black/20 shrink-0" style={{ backgroundColor: current.swatch }} />
        {status === "done" ? "Added ✓" : status === "saving" ? "Saving…" : "Highlight"}
      </button>
      {open && !isDisabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-50 flex items-center gap-1.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg shadow-xl p-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => pick(c.id)}
                className={`w-6 h-6 rounded-full ring-2 transition ${c.id === value ? "ring-white/80 scale-110" : "ring-transparent hover:ring-white/30"}`}
                style={{ backgroundColor: c.swatch }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
