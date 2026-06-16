import React, { useEffect, useState } from "react";
import {
  getEvaluationSummary, getEvaluationReport, downloadEvaluationCsv, downloadEvaluationJson,
  type EvaluationSummary,
} from "../api/evaluationApi";

function fmt(v: number | null | undefined, suffix = "", dash = "-"): string {
  return v == null ? dash : `${v}${suffix}`;
}

// Friendly labels for rating types and feature/operation names shown in charts.
const LABELS: Record<string, string> = {
  answer_relevance: "Answer relevance",
  citation_usefulness: "Citation usefulness",
  answer_trust: "Answer trust (accuracy)",
  answer_supported_by_notes: "Answer supported by notes",
  yes: "Yes", partially: "Partially", no: "No", not_sure: "Not sure",
  task_difficulty: "Task difficulty",
  system_speed: "System speed",
  note_quality: "Note quality",
  transcript_accuracy: "Transcript accuracy",
  reminder_usefulness: "Reminder usefulness",
  translation_quality: "Translation quality",
  quiz_usefulness: "Quiz usefulness",
  timeline_usefulness: "Timeline usefulness",
  overall_usefulness: "Overall usefulness",
  rag_chat: "RAG chat",
  note: "Notes",
  reminder: "Reminders",
  survey: "Survey",
  translation: "Translation",
  transcription: "Transcription",
  quiz: "Quiz / Study",
  study_mode: "Study mode",
  timeline: "Lecture timeline",
  command: "Slash command",
  smart_action: "Smart action",
  tts: "Text-to-speech",
  gmail: "Gmail",
};

function prettify(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function relabel(data: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) out[prettify(k)] = v;
  return out;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-white mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-gray-600">{hint}</p>}
    </div>
  );
}

function BarChart({ title, data, suffix = "" }: { title: string; data: Record<string, number>; suffix?: string }) {
  const entries = Object.entries(data);
  if (!entries.length) return null;
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-4">
      <p className="text-[13px] text-gray-200 mb-3">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-40 shrink-0 truncate text-right">{k}</span>
            <div className="flex-1 h-5 bg-[#1a1a24] rounded overflow-hidden">
              <div className="h-full bg-cyan-500/70 rounded" style={{ width: `${Math.max((v / max) * 100, 3)}%` }} />
            </div>
            <span className="text-[11px] text-gray-400 w-16 shrink-0">{v}{suffix}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminEvaluationPanel() {
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getEvaluationSummary().then(setSummary).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function generate() {
    setBusy("report");
    try { setReport((await getEvaluationReport()).markdown); } catch { /* ignore */ }
    finally { setBusy(null); }
  }
  async function dl(kind: "csv" | "json") {
    setBusy(kind);
    try { kind === "csv" ? await downloadEvaluationCsv() : await downloadEvaluationJson(); }
    catch { alert("Export failed or disabled."); }
    finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading evaluation analytics…</p>;
  if (!summary) return <p className="text-sm text-red-400">Failed to load analytics.</p>;

  const s = summary;
  const confidenceChart: Record<string, number> = {};
  s.confidence_alignment.forEach(c => { confidenceChart[`${c.confidence_level} (trust ${fmt(c.avg_trust)})`] = c.count; });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Evaluation Analytics</h2>
          <p className="text-xs text-gray-500">Quantitative research telemetry - separate from logs and feedback.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={generate} disabled={busy === "report"} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition">
            {busy === "report" ? "Generating…" : "Generate Report"}
          </button>
          <button onClick={() => dl("csv")} disabled={busy === "csv"} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-40 transition">CSV (zip)</button>
          <button onClick={() => dl("json")} disabled={busy === "json"} className="px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-[var(--ml-bg-hover)] hover:text-white transition">JSON</button>
        </div>
      </div>

      <p className="text-[11px] text-gray-600 mb-4">
        Stats are gathered automatically while <span className="text-gray-400">Evaluation Analytics</span> is on, up to a per-participant <span className="text-gray-400">collection window (default 30 minutes of usage time)</span> - switching tabs or logging out pauses it; it never resets on its own. Set each participant's window and reset their budget in <span className="text-gray-400">Users → Evaluation</span>.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
        <Card label="Participants" value={String(s.total_participants)} />
        <Card label="Completed sessions" value={`${s.completed_sessions}/${s.total_sessions}`} />
        <Card label="Avg session time" value={fmt(s.avg_session_time_seconds, "s")} />
        <Card label="Task completion" value={s.task_completion_rate != null ? `${Math.round(s.task_completion_rate * 100)}%` : "-"} hint={`${s.completed_tasks}/${s.total_tasks} tasks`} />
        <Card label="Avg response time" value={fmt(s.avg_response_time_ms, " ms")} />
        <Card label="First-token latency" value={fmt(s.avg_first_token_latency_ms, " ms")} />
        <Card label="Fallback rate" value={s.fallback_rate != null ? `${Math.round(s.fallback_rate * 100)}%` : "-"} hint={`${s.ai_metric_count} samples`} />
        <Card label="Relevance / Citation / Trust" value={`${fmt(s.avg_relevance_rating)} / ${fmt(s.avg_citation_rating)} / ${fmt(s.avg_trust_rating)}`} hint="avg /5" />
      </div>

      {/* Charts */}
      <div className="space-y-3">
        {Object.keys(s.ratings_by_type).length > 0 && (
          <BarChart title="Average user rating by question (out of 5)" data={relabel(s.ratings_by_type)} />
        )}
        {s.supported_by_notes && Object.keys(s.supported_by_notes).length > 0 && (
          <BarChart title="“Was this answer supported by your own notes?” - responses" data={relabel(s.supported_by_notes)} />
        )}
        {Object.keys(confidenceChart).length > 0 && (
          <BarChart title="Confidence alignment - answers per confidence level (with avg trust rating)" data={confidenceChart} />
        )}
        {Object.keys(s.response_time_by_feature).length > 0 && (
          <BarChart title="Average response time by feature (ms)" data={relabel(s.response_time_by_feature)} suffix=" ms" />
        )}
        {Object.keys(s.feature_usage).length > 0 && (
          <BarChart title="Feature usage count" data={relabel(s.feature_usage)} />
        )}
        {s.ai_metric_count === 0 && s.total_sessions === 0 && (
          <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-6 text-center text-sm text-gray-500">
            No evaluation data yet. Ask a participant to start an evaluation session from the profile menu.
          </div>
        )}
      </div>

      {/* Generated report markdown */}
      {report && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Generated report (paste into Assessment 2)</h3>
            <button onClick={() => navigator.clipboard?.writeText(report)} className="px-2.5 py-1 rounded-lg text-[11px] text-gray-300 border border-[var(--ml-bg-hover)] hover:text-white transition">Copy</button>
          </div>
          <pre className="bg-[#0e0e15] border border-[var(--ml-bg-hover)] rounded-xl p-4 text-[11px] text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-96 overflow-y-auto">{report}</pre>
        </div>
      )}
    </div>
  );
}
