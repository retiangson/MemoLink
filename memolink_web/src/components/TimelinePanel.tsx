import React, { useState, useEffect, useCallback } from "react";
import { getTimeline, generateTimeline, type TimelineData } from "../api/timelineApi";

interface Props {
  noteId: number | null;
  onJump: (keyPhrase: string) => void;
}

const MOMENT_CONFIG: Record<string, { color: string; label: string; icon: string }> = {
  decision:  { color: "text-indigo-400 border-indigo-500/30 bg-indigo-500/5",  label: "Decision",  icon: "⚖️" },
  warning:   { color: "text-red-400 border-red-500/30 bg-red-500/5",           label: "Warning",   icon: "⚠️" },
  key_point: { color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",        label: "Key Point", icon: "💡" },
  deadline:  { color: "text-amber-400 border-amber-500/30 bg-amber-500/5",     label: "Deadline",  icon: "⏰" },
  question:  { color: "text-violet-400 border-violet-500/30 bg-violet-500/5",  label: "Question",  icon: "❓" },
};

function TimestampBadge({ ts }: { ts: string }) {
  return (
    <span className="shrink-0 font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#0a0a0f] border border-[#2a2a38] text-indigo-300">
      {ts}
    </span>
  );
}

function JumpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Jump to this section in the note"
      className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-500 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-md border border-transparent hover:border-indigo-500/20 transition"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
      Jump
    </button>
  );
}

function Section({
  title, count, color, children, defaultOpen = true,
}: {
  title: string; count: number; color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[#2a2a38] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[#1a1a24] hover:bg-[#1e1e2e] transition"
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${color}`}>{title}</span>
          <span className="text-[10px] text-gray-600 bg-[#12121a] border border-[#2a2a38] px-1.5 py-0.5 rounded-full">{count}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-gray-600 transition-transform ${open ? "" : "-rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="divide-y divide-[#2a2a38]">{children}</div>}
    </div>
  );
}

export function TimelinePanel({ noteId, onJump }: Props) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true); setError(null);
    try {
      const cached = await getTimeline(noteId);
      setData(cached);
    } catch { setError("Failed to load timeline."); }
    finally { setLoading(false); }
  }, [noteId]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    if (!noteId) return;
    setGenerating(true); setError(null);
    try {
      const result = await generateTimeline(noteId);
      setData(result);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to generate timeline.");
    } finally { setGenerating(false); }
  }

  const dur = data?.estimated_duration_seconds;
  const durLabel = dur
    ? dur >= 3600
      ? `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}m`
      : `${Math.floor(dur / 60)}m ${dur % 60}s`
    : null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 rounded-full border-[3px] border-indigo-500/20 border-t-indigo-400 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 px-1 py-2">

      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {durLabel && <span className="px-2 py-0.5 bg-[#12121a] border border-[#2a2a38] rounded-full">{durLabel} estimated</span>}
          {data?.word_count && <span className="px-2 py-0.5 bg-[#12121a] border border-[#2a2a38] rounded-full">{data.word_count.toLocaleString()} words</span>}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating || !noteId}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition shrink-0"
        >
          {generating ? (
            <>
              <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Analysing…
            </>
          ) : data ? "Regenerate" : "Generate Timeline"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}

      {!data && !error && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-3">
          <div className="text-4xl">⏱</div>
          <p className="text-sm font-medium text-gray-300">No timeline yet</p>
          <p className="text-xs text-gray-600 max-w-xs leading-relaxed">
            Click <strong className="text-gray-400">Generate Timeline</strong> to analyse this note and produce chapters, action items, and important moments with timestamps.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Summary */}
          {data.summary && (
            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-4 py-3">
              <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1.5">Overview</p>
              <p className="text-xs text-gray-300 leading-relaxed">{data.summary}</p>
            </div>
          )}

          {/* Chapters */}
          {data.chapters.length > 0 && (
            <Section title="Chapters" count={data.chapters.length} color="text-indigo-400">
              {data.chapters.map((c, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-[#13131c] transition group">
                  <TimestampBadge ts={c.timestamp} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white leading-snug">{c.title}</p>
                    {c.summary && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{c.summary}</p>}
                  </div>
                  {c.key_phrase && <JumpButton onClick={() => onJump(c.key_phrase)} />}
                </div>
              ))}
            </Section>
          )}

          {/* Action Items */}
          {data.action_items.length > 0 && (
            <Section title="Action Items" count={data.action_items.length} color="text-emerald-400">
              {data.action_items.map((a, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-[#13131c] transition">
                  <TimestampBadge ts={a.timestamp} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 leading-snug">{a.text}</p>
                    {a.assignee && (
                      <span className="inline-block mt-1 text-[10px] px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
                        {a.assignee}
                      </span>
                    )}
                  </div>
                  {a.key_phrase && <JumpButton onClick={() => onJump(a.key_phrase)} />}
                </div>
              ))}
            </Section>
          )}

          {/* Important Moments */}
          {data.important_moments.length > 0 && (
            <Section title="Important Moments" count={data.important_moments.length} color="text-amber-400">
              {data.important_moments.map((m, i) => {
                const cfg = MOMENT_CONFIG[m.type] ?? MOMENT_CONFIG.key_point;
                return (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-[#13131c] transition">
                    <TimestampBadge ts={m.timestamp} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 leading-snug italic">"{m.text}"</p>
                    </div>
                    {m.key_phrase && <JumpButton onClick={() => onJump(m.key_phrase)} />}
                  </div>
                );
              })}
            </Section>
          )}

          {data.chapters.length === 0 && data.action_items.length === 0 && data.important_moments.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-6">No chapters or action items detected. Try regenerating.</p>
          )}
        </>
      )}
    </div>
  );
}
