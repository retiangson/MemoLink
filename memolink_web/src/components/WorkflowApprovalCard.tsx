import React, { useState } from "react";
import { executeWorkflow, type WorkflowAction } from "../api/workflowApi";

interface Props {
  understanding: string;
  actions: WorkflowAction[];
  conversationId: number;
  workspaceId: number | null;
  model: string | null;
  onDone?: (summary: string) => void;
}

const ACTION_ICONS: Record<string, string> = {
  create_reminder:        "⏰",
  create_note:            "📝",
  summarise_workspace:    "📋",
  search_web:             "🌐",
  organise_notes:         "🗂️",
  suggest_title:          "✏️",
  extract_tasks:          "✅",
  prepare_report_outline: "📄",
};

type ActionState = "pending" | "running" | "done" | "failed" | "skipped";

export function WorkflowApprovalCard({ understanding, actions, conversationId, workspaceId, model, onDone }: Props) {
  const [approved, setApproved] = useState<Set<string>>(new Set(actions.map(a => a.id)));
  const [phase, setPhase] = useState<"approval" | "executing" | "done">("approval");
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [actionResults, setActionResults] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");

  function toggleAction(id: string) {
    if (phase !== "approval") return;
    setApproved(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function approveAll() {
    setApproved(new Set(actions.map(a => a.id)));
  }

  async function handleExecute() {
    const toRun = actions.filter(a => approved.has(a.id));
    const skipped = actions.filter(a => !approved.has(a.id));

    const initialStates: Record<string, ActionState> = {};
    actions.forEach(a => { initialStates[a.id] = approved.has(a.id) ? "pending" : "skipped"; });
    setActionStates(initialStates);
    setPhase("executing");

    try {
      let summaryAcc = "";
      for await (const event of executeWorkflow(conversationId, toRun, workspaceId, model)) {
        if (event.workflow_step) {
          const step = event.workflow_step as { id: string };
          setActionStates(s => ({ ...s, [step.id]: "running" }));
        }
        if (event.workflow_done) {
          const d = event.workflow_done as { id: string; result: string; ok: boolean };
          setActionStates(s => ({ ...s, [d.id]: d.ok ? "done" : "failed" }));
          setActionResults(r => ({ ...r, [d.id]: d.result }));
        }
        if (event.t) {
          summaryAcc += event.t as string;
          setSummary(summaryAcc);
        }
        if (event.done) {
          setPhase("done");
          onDone?.(summaryAcc);
        }
      }
    } catch (e) {
      setSummary("Execution failed. Please try again.");
      setPhase("done");
    }
  }

  const approvedCount = approved.size;
  const totalCount = actions.length;

  return (
    <div className="mt-2 rounded-2xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[var(--ml-bg-hover)] bg-[#1a1a24]">
        <span className="text-base">⚡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Workflow Agent</p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{understanding}</p>
        </div>
        {phase === "approval" && (
          <span className="shrink-0 text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
            {approvedCount}/{totalCount} selected
          </span>
        )}
        {phase === "executing" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
            <span className="text-[10px] text-indigo-400">Running…</span>
          </div>
        )}
        {phase === "done" && (
          <span className="shrink-0 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            ✓ Done
          </span>
        )}
      </div>

      {/* Action list */}
      <div className="divide-y divide-[var(--ml-bg-hover)]">
        {actions.map((action) => {
          const isApproved = approved.has(action.id);
          const state = actionStates[action.id];
          const result = actionResults[action.id];
          const icon = ACTION_ICONS[action.type] ?? "⚙️";

          return (
            <div
              key={action.id}
              onClick={() => toggleAction(action.id)}
              className={`flex items-start gap-3 px-5 py-3 transition ${
                phase === "approval" ? "cursor-pointer hover:bg-[#1a1a26]" : ""
              } ${state === "skipped" ? "opacity-40" : ""}`}
            >
              {/* Checkbox / status indicator */}
              <div className="shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center">
                {state === "running" && (
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
                )}
                {state === "done" && (
                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {state === "failed" && (
                  <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {(state === "pending" || state === "skipped" || !state) && (
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                    isApproved ? "border-indigo-500 bg-indigo-500/20" : "border-[#3a3a48]"
                  }`}>
                    {isApproved && <div className="w-2 h-2 rounded-sm bg-indigo-400" />}
                  </div>
                )}
              </div>

              {/* Action content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{icon}</span>
                  <p className={`text-xs font-medium leading-snug ${
                    state === "done" ? "text-emerald-300" :
                    state === "failed" ? "text-red-300" :
                    state === "skipped" ? "text-gray-600" :
                    isApproved ? "text-gray-200" : "text-gray-500"
                  }`}>
                    {action.label}
                  </p>
                </div>
                {action.preview && !result && (
                  <p className="text-[10px] text-gray-600 mt-0.5 ml-5">{action.preview}</p>
                )}
                {result && (
                  <p className={`text-[10px] mt-0.5 ml-5 ${state === "done" ? "text-emerald-500/80" : "text-red-400/80"}`}>
                    {result}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {phase === "approval" && (
        <div className="px-5 py-3 border-t border-[var(--ml-bg-hover)] bg-[#0f0f16] flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              onClick={approveAll}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition"
            >
              Select all
            </button>
            <span className="text-gray-700">·</span>
            <button
              onClick={() => setApproved(new Set())}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition"
            >
              Deselect all
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPhase("done")}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 border border-[var(--ml-bg-hover)] rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleExecute}
              disabled={approvedCount === 0}
              className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
            >
              Approve {approvedCount > 0 ? `(${approvedCount})` : ""}
            </button>
          </div>
        </div>
      )}

      {/* Execution summary */}
      {(phase === "executing" || phase === "done") && summary && (
        <div className="px-5 py-3 border-t border-[var(--ml-bg-hover)] bg-[#0f0f16]">
          <p className="text-xs text-gray-300 leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}
