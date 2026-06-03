import React, { useEffect, useState, useCallback } from "react";
import {
  getInsights,
  analyzeInsights,
  dismissInsight,
  ProactiveInsight,
  InsightType,
  InsightSeverity,
} from "../api/insightsApi";

// ── Visual config ──────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<InsightType, React.ReactNode> = {
  missing_reminder: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/>
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>
    </svg>
  ),
  incomplete_actions: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
      <path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2z"/>
      <path d="M7 5.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 1 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0M7 9.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m-1.496-.854a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0l-.5-.5a.5.5 0 0 1 .708-.708l.146.147 1.146-1.147a.5.5 0 0 1 .708 0"/>
    </svg>
  ),
  unreviewed_upload: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
      <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2z"/>
    </svg>
  ),
  urgency_signal: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
      <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
    </svg>
  ),
};

const TYPE_LABELS: Record<InsightType, string> = {
  missing_reminder:   "Missing Reminder",
  incomplete_actions: "Incomplete Actions",
  unreviewed_upload:  "Unreviewed Upload",
  urgency_signal:     "Urgency Signal",
};

const SEVERITY_COLORS: Record<InsightSeverity, string> = {
  urgent:  "border-red-500 text-red-400",
  warning: "border-amber-500 text-amber-400",
  info:    "border-indigo-500 text-indigo-400",
};

const SEVERITY_BG: Record<InsightSeverity, string> = {
  urgent:  "bg-red-500/8",
  warning: "bg-amber-500/8",
  info:    "bg-indigo-500/8",
};

// ── Component ──────────────────────────────────────────────────────────────────

interface InsightsPanelProps {
  workspaceId: number | null;
  onOpenNote?: (noteId: number) => void;
}

export function InsightsPanel({ workspaceId, onOpenNote }: InsightsPanelProps) {
  const [insights, setInsights] = useState<ProactiveInsight[]>([]);
  const [open, setOpen] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) { setInsights([]); return; }
    try {
      setInsights(await getInsights(workspaceId));
    } catch {
      // Silently keep empty - non-critical feature
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const handleScan = async () => {
    if (!workspaceId) return;
    setScanning(true);
    setError(null);
    try {
      setInsights(await analyzeInsights(workspaceId));
    } catch {
      setError("Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleDismiss = async (id: number) => {
    await dismissInsight(id);
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  if (!workspaceId) return null;

  const urgentCount = insights.filter((i) => i.severity === "urgent").length;
  const warningCount = insights.filter((i) => i.severity === "warning").length;
  const badgeCount = urgentCount + warningCount;

  return (
    <div className="border-b border-[#1e1e2a]">
      {/* ── Section header ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1a1a24] transition text-left"
      >
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2"/>
          </svg>
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">AI Insights</span>
          {badgeCount > 0 && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${urgentCount > 0 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
              {badgeCount}
            </span>
          )}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3 h-3 text-gray-600 transition-transform ${open ? "" : "-rotate-90"}`} fill="currentColor" viewBox="0 0 16 16">
          <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Scan button */}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/10 disabled:opacity-50 transition"
          >
            {scanning ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Scanning notes…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
                </svg>
                Scan Notes
              </>
            )}
          </button>

          {error && <p className="text-[11px] text-red-400 text-center">{error}</p>}

          {/* Insight cards */}
          {insights.length === 0 && !scanning && (
            <p className="text-[11px] text-gray-600 text-center py-2">
              No insights yet - click Scan Notes to analyse your workspace.
            </p>
          )}

          {insights.map((ins) => (
            <div
              key={ins.id}
              className={`rounded-xl border-l-2 px-3 py-2.5 ${SEVERITY_COLORS[ins.severity]} ${SEVERITY_BG[ins.severity]}`}
            >
              {/* Type label + dismiss */}
              <div className="flex items-center justify-between mb-1">
                <div className={`flex items-center gap-1 ${SEVERITY_COLORS[ins.severity]}`}>
                  {TYPE_ICONS[ins.insight_type]}
                  <span className="text-[9px] font-semibold uppercase tracking-wider">
                    {TYPE_LABELS[ins.insight_type]}
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(ins.id)}
                  className="text-gray-600 hover:text-gray-400 transition p-0.5"
                  title="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* Title */}
              <p className="text-[11px] font-medium text-gray-200 leading-snug">{ins.title}</p>

              {/* Description */}
              {ins.description && (
                <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{ins.description}</p>
              )}

              {/* Open Note action */}
              {ins.note_id && onOpenNote && (
                <button
                  onClick={() => onOpenNote(ins.note_id!)}
                  className="mt-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 transition underline underline-offset-2"
                >
                  Open note →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
