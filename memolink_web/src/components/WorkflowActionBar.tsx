import React, { useState } from "react";
import { executeAction, type WorkflowAction } from "../api/workflowApi";

interface Props {
  actions: WorkflowAction[];
  conversationId: number;
  workspaceId: number | null;
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

type BtnState = "idle" | "loading" | "done" | "error";

export function WorkflowActionBar({ actions, conversationId, workspaceId }: Props) {
  const [states, setStates] = useState<Record<string, BtnState>>({});

  if (!actions.length) return null;

  async function handleClick(action: WorkflowAction) {
    if (states[action.id] && states[action.id] !== "idle") return;
    setStates(s => ({ ...s, [action.id]: "loading" }));
    try {
      const res = await executeAction(conversationId, action, workspaceId);
      setStates(s => ({ ...s, [action.id]: res.ok ? "done" : "error" }));
    } catch {
      setStates(s => ({ ...s, [action.id]: "error" }));
    }
  }

  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#2a2a38]/60">
      {actions.map((action) => {
        const state = states[action.id] ?? "idle";
        const icon = ACTION_ICONS[action.type] ?? "⚙️";

        return (
          <button
            key={action.id}
            onClick={() => handleClick(action)}
            disabled={state === "loading" || state === "done"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              state === "done"
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 cursor-default"
                : state === "error"
                  ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15"
                  : state === "loading"
                    ? "bg-[#1e1e2a] border-[#2a2a38] text-gray-500 cursor-not-allowed"
                    : "bg-[#1a1a24] border-[#2a2a38] text-gray-300 hover:border-indigo-500/40 hover:text-indigo-300 hover:bg-indigo-500/5"
            }`}
          >
            {state === "loading" ? (
              <div className="w-3 h-3 rounded-full border-2 border-gray-500/30 border-t-gray-400 animate-spin shrink-0" />
            ) : state === "done" ? (
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : state === "error" ? (
              <span className="shrink-0">⚠</span>
            ) : (
              <span className="shrink-0 text-sm leading-none">{icon}</span>
            )}
            <span>{state === "done" ? "Done" : state === "error" ? "Failed — retry" : action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
