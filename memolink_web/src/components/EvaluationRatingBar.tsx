import React, { useState, useEffect } from "react";
import { recordRating, type MessageRating } from "../api/evaluationApi";

interface Props {
  messageId: number;
  initial?: MessageRating;
}

// Full, self-explanatory statements (rated 1 = Strongly Disagree … 5 = Strongly Agree).
const SCALES: { type: string; label: string }[] = [
  { type: "answer_relevance", label: "This answer was relevant to my notes / materials." },
  { type: "citation_usefulness", label: "The source citations were useful and easy to follow." },
  { type: "answer_trust", label: "I trust this answer is accurate." },
];

const SUPPORTED = [
  { value: "yes", label: "Yes" },
  { value: "partially", label: "Partially" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

export function EvaluationRatingBar({ messageId, initial }: Props) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [supported, setSupported] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Restore previously-saved selections (survives reload).
  useEffect(() => {
    if (!initial) return;
    const v: Record<string, number> = {};
    for (const s of SCALES) {
      const x = initial[s.type];
      if (typeof x === "number") v[s.type] = x;
    }
    setValues(v);
    const sup = initial["answer_supported_by_notes"];
    if (typeof sup === "string") setSupported(sup);
  }, [initial]);

  if (dismissed) return null;

  // session is resolved server-side from the authenticated user
  function rate(type: string, value: number) {
    setValues(v => ({ ...v, [type]: value }));
    recordRating({ message_id: messageId, rating_type: type, rating_value: value });
  }

  function chooseSupported(value: string) {
    setSupported(value);
    recordRating({ message_id: messageId, rating_type: "answer_supported_by_notes", rating_value: 0, choice_value: value });
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-cyan-500/15 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-cyan-400/80">Rate this answer · optional &amp; anonymous · 1 = strongly disagree, 5 = strongly agree</span>
        <button onClick={() => setDismissed(true)} className="text-[10px] text-gray-600 hover:text-gray-400 shrink-0">skip ✕</button>
      </div>

      {SCALES.map(s => (
        <div key={s.type} className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-300 min-w-0 flex-1 leading-snug">{s.label}</span>
          <div className="flex gap-1 shrink-0">
            {[1, 2, 3, 4, 5].map(n => {
              const sel = values[s.type] === n;
              return (
                <button key={n} onClick={() => rate(s.type, n)} title={n === 1 ? "Strongly disagree" : n === 5 ? "Strongly agree" : String(n)}
                  className={`w-6 h-6 rounded text-[11px] border transition ${
                    sel ? "bg-cyan-600 border-cyan-500 text-white" : "bg-[var(--ml-bg-surface)] border-[var(--ml-bg-hover)] text-gray-400 hover:border-cyan-500/40"
                  }`}>{n}</button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-gray-300 min-w-0 flex-1 leading-snug">Was this answer supported by your own notes?</span>
        <div className="flex gap-1 shrink-0">
          {SUPPORTED.map(o => (
            <button key={o.value} onClick={() => chooseSupported(o.value)}
              className={`px-2 py-1 rounded-lg text-[10px] border transition ${
                supported === o.value ? "bg-cyan-600 border-cyan-500 text-white" : "bg-[var(--ml-bg-surface)] border-[var(--ml-bg-hover)] text-gray-400 hover:border-cyan-500/40"
              }`}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
