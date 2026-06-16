import React, { useState } from "react";
import { startTask, completeTask, endSession } from "../api/evaluationApi";
import type { EvalSession } from "../hooks/useEvaluation";

interface Props {
  session: EvalSession;
  workspaceId: number | null;
  onEnd: () => void;
}

interface TaskDef { key: string; name: string; feature: string; optional?: boolean; }

const TASKS: TaskDef[] = [
  { key: "create_note", name: "Create or upload a note", feature: "note" },
  { key: "ask_rag_question", name: "Ask a question based on the note", feature: "rag_chat" },
  { key: "check_citation", name: "Review the source citation", feature: "rag_chat" },
  { key: "create_reminder", name: "Generate / create a reminder", feature: "reminder" },
  { key: "rate_answer", name: "Rate the answer & citation", feature: "rating" },
  { key: "complete_survey", name: "Complete the qualitative survey", feature: "survey" },
  { key: "translate_text", name: "Translate a short text", feature: "translation", optional: true },
  { key: "generate_quiz", name: "Generate a quiz", feature: "quiz", optional: true },
  { key: "generate_timeline", name: "Generate a lecture timeline", feature: "timeline", optional: true },
  { key: "use_command", name: "Use a slash command", feature: "command", optional: true },
];

type TaskState = { taskId?: number; startedAt?: number; done?: boolean; ms?: number; busy?: boolean };

export function EvaluationPanel({ session, workspaceId, onEnd }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [states, setStates] = useState<Record<string, TaskState>>({});
  const [ending, setEnding] = useState(false);

  const completed = Object.values(states).filter(s => s.done).length;

  async function toggle(t: TaskDef) {
    const st = states[t.key] ?? {};
    if (st.busy || st.done) return;
    if (!st.taskId) {
      // Start
      setStates(s => ({ ...s, [t.key]: { ...st, busy: true } }));
      try {
        const r = await startTask(session.session_id, t.key, t.name, t.feature, workspaceId);
        setStates(s => ({ ...s, [t.key]: { taskId: r.task_id, startedAt: performance.now(), busy: false } }));
      } catch {
        setStates(s => ({ ...s, [t.key]: { busy: false } }));
      }
    }
  }

  async function finish(t: TaskDef) {
    const st = states[t.key];
    if (!st?.taskId || st.done) return;
    const ms = st.startedAt ? Math.round(performance.now() - st.startedAt) : undefined;
    setStates(s => ({ ...s, [t.key]: { ...st, busy: true } }));
    try {
      await completeTask(st.taskId, { success: true, time_taken_ms: ms });
      setStates(s => ({ ...s, [t.key]: { ...st, done: true, ms, busy: false } }));
    } catch {
      setStates(s => ({ ...s, [t.key]: { ...st, busy: false } }));
    }
  }

  async function end() {
    setEnding(true);
    try { await endSession(session.session_id, true); } catch { /* ignore */ }
    onEnd();
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 bg-[#14141c] border border-cyan-500/30 rounded-2xl shadow-2xl text-white overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-cyan-500/10 border-b border-cyan-500/20">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="text-xs font-medium truncate">Evaluation · {session.participant_code}</span>
        </div>
        <button onClick={() => setCollapsed(c => !c)} className="text-gray-400 hover:text-white text-xs px-1">
          {collapsed ? "▴" : "▾"}
        </button>
      </div>

      {!collapsed && (
        <div className="p-2.5">
          <p className="text-[10px] text-gray-500 mb-2 px-1">{completed}/{TASKS.length} tasks · click to start, ✓ when done</p>
          <div className="space-y-1 max-h-[46vh] overflow-y-auto">
            {TASKS.map(t => {
              const st = states[t.key] ?? {};
              const started = !!st.taskId;
              return (
                <div key={t.key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-[11px] ${
                  st.done ? "bg-emerald-500/10 border-emerald-500/25" : started ? "bg-cyan-500/10 border-cyan-500/25" : "bg-[var(--ml-bg-surface)] border-[var(--ml-bg-hover)]"
                }`}>
                  <span className="flex-1 min-w-0">
                    <span className={`${st.done ? "text-emerald-300 line-through" : "text-gray-300"}`}>{t.name}</span>
                    {t.optional && <span className="text-[9px] text-gray-600 ml-1">opt</span>}
                    {st.done && st.ms != null && <span className="text-[9px] text-gray-500 ml-1">{(st.ms / 1000).toFixed(1)}s</span>}
                  </span>
                  {st.done ? (
                    <span className="text-emerald-400 shrink-0">✓</span>
                  ) : started ? (
                    <button onClick={() => finish(t)} disabled={st.busy} className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-emerald-600/80 hover:bg-emerald-500 text-white disabled:opacity-40">Done</button>
                  ) : (
                    <button onClick={() => toggle(t)} disabled={st.busy} className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-cyan-600/70 hover:bg-cyan-500 text-white disabled:opacity-40">Start</button>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={end} disabled={ending} className="w-full mt-2.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25 disabled:opacity-40 transition">
            {ending ? "Ending…" : "End evaluation session"}
          </button>
        </div>
      )}
    </div>
  );
}
