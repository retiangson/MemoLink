import React, { useState } from "react";
import { HIGHLIGHT_COLORS } from "./highlightColors";

interface Props {
  value: string;
  onChange: (colorId: string) => void;
}

// Sits immediately after the "Read Aloud" button in every highlight-capable reader's
// footer. Clicking the current swatch opens a row of the other presets; picking one sets
// the color used for the *next* highlight created via selection + the Highlight pill.
export function HighlightColorPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current = HIGHLIGHT_COLORS.find((c) => c.id === value) ?? HIGHLIGHT_COLORS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Highlight color: ${current.label}`}
        className="w-7 h-7 rounded-lg border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition flex items-center justify-center"
      >
        <span className="w-3.5 h-3.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: current.swatch }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-50 flex items-center gap-1.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg shadow-xl p-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => { onChange(c.id); setOpen(false); }}
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
