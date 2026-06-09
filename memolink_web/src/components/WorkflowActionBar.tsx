import React, { useState } from "react";
import { confirmAction, type WorkflowAction } from "../api/workflowApi";
import type { Message } from "../types";

interface Props {
  actions: WorkflowAction[];
  conversationId: number;
  workspaceId: number | null;
  model: string | null;
  onActionDone?: (type: string) => void;
  onConversationMessages?: (messages: Message[]) => void;
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

// Conversational prompt shown as a question before the action buttons
const ACTION_QUESTIONS: Record<string, string> = {
  search_web:             "Do you want me to search the web for this?",
  create_note:            "Want to save this response as a note?",
  create_reminder:        "Should I create a reminder for this?",
  extract_tasks:          "Want me to extract the tasks from this?",
  summarise_workspace:    "Would you like a summary of your workspace?",
  prepare_report_outline: "Want me to create a report outline from your notes?",
  organise_notes:         "Should I create a note organisation map?",
  suggest_title:          "Want me to suggest a better title for this note?",
};

// Short label shown on the Yes button
const ACTION_YES_LABELS: Record<string, string> = {
  search_web:             "Yes, search online",
  create_note:            "Yes, save as note",
  create_reminder:        "Yes, add reminder",
  extract_tasks:          "Yes, extract tasks",
  summarise_workspace:    "Yes, summarise",
  prepare_report_outline: "Yes, create outline",
  organise_notes:         "Yes, organise",
  suggest_title:          "Yes, suggest title",
};

type ActionState = "idle" | "loading" | "done" | "error";

export function WorkflowActionBar({ actions, conversationId, workspaceId, model, onActionDone, onConversationMessages }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [states, setStates] = useState<Record<string, ActionState>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  if (!actions.length || dismissed) return null;

  const anyDone = Object.values(states).some(s => s === "done");
  const allSettled = actions.every(a => {
    const s = states[a.id];
    return s === "done" || s === "error";
  });

  async function handleAction(action: WorkflowAction, userMessage?: string) {
    if (states[action.id] && states[action.id] !== "idle" && states[action.id] !== "error") return;
    setStates(s => ({ ...s, [action.id]: "loading" }));
    try {
      const responseText = userMessage ?? ACTION_YES_LABELS[action.type] ?? action.label;
      const res = await confirmAction(conversationId, action, responseText, workspaceId, model);
      setStates(s => ({ ...s, [action.id]: res.ok ? "done" : "error" }));
      setResults(r => ({ ...r, [action.id]: res.result }));
      onConversationMessages?.([res.user_message, res.assistant_message]);
      if (res.ok) {
        onActionDone?.(action.type);
        if (action.type === "search_web") setDismissed(true);
      }
    } catch {
      setStates(s => ({ ...s, [action.id]: "error" }));
    }
  }

  // Single action - show a full conversational prompt
  if (actions.length === 1) {
    const action = actions[0];
    const state = states[action.id] ?? "idle";
    const icon = ACTION_ICONS[action.type] ?? "⚙️";
    const question = ACTION_QUESTIONS[action.type] ?? action.label;
    const yesLabel = ACTION_YES_LABELS[action.type] ?? "Yes";

    return (
      <div className="mt-3 pt-3 border-t border-[#2a2a38]/60">
        {state === "idle" && (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="text-base leading-none shrink-0">{icon}</span>
              <span>{question}</span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1 rounded-lg text-xs text-gray-500 border border-[#2a2a38] hover:text-gray-200 hover:border-[#3a3a48] transition"
              >
                No
              </button>
              <button
                onClick={() => handleAction(action, yesLabel)}
                className="px-3 py-1 rounded-lg text-xs font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 hover:bg-indigo-500/20 transition"
              >
                {icon} {yesLabel}
              </button>
            </div>
          </div>
        )}

        {state === "loading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin shrink-0" />
            <span>Working on it…</span>
          </div>
        )}

        {state === "done" && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>{results[action.id] ?? "Done!"}</span>
          </div>
        )}

        {state === "error" && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs text-red-400">⚠ Something went wrong.</span>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1 rounded-lg text-xs text-gray-500 border border-[#2a2a38] hover:text-gray-200 transition"
              >
                Skip
              </button>
              <button
                onClick={() => { setStates(s => ({ ...s, [action.id]: "idle" })); }}
                className="px-3 py-1 rounded-lg text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Multiple actions - show a "I can help with:" prompt with individual buttons
  return (
    <div className="mt-3 pt-3 border-t border-[#2a2a38]/60 space-y-2">
      {!allSettled && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">I can help with a few things:</p>
          <button
            onClick={() => setDismissed(true)}
            className="text-[10px] text-gray-600 hover:text-gray-400 transition px-1"
          >
            Skip all ✕
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const state = states[action.id] ?? "idle";
          const icon = ACTION_ICONS[action.type] ?? "⚙️";
          const result = results[action.id];

          if (state === "done") {
            return (
              <span key={action.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Done
              </span>
            );
          }

          return (
            <button
              key={action.id}
              onClick={() => handleAction(action, action.label)}
              disabled={state === "loading"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                state === "error"
                  ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15"
                  : state === "loading"
                    ? "bg-[#1e1e2a] border-[#2a2a38] text-gray-500 cursor-not-allowed"
                    : "bg-[#1a1a24] border-[#2a2a38] text-gray-300 hover:border-indigo-500/40 hover:text-indigo-300 hover:bg-indigo-500/5"
              }`}
            >
              {state === "loading" ? (
                <div className="w-3 h-3 rounded-full border-2 border-gray-500/30 border-t-gray-400 animate-spin shrink-0" />
              ) : state === "error" ? (
                <span className="shrink-0">⚠</span>
              ) : (
                <span className="shrink-0 text-sm leading-none">{icon}</span>
              )}
              <span>{state === "error" ? "Retry" : action.label}</span>
            </button>
          );
        })}

        {/* No thanks button only when nothing is done yet */}
        {!anyDone && (
          <button
            onClick={() => setDismissed(true)}
            className="px-3 py-1.5 rounded-xl text-xs text-gray-600 border border-[#2a2a38]/50 hover:text-gray-400 hover:border-[#2a2a38] transition"
          >
            No thanks
          </button>
        )}
      </div>
    </div>
  );
}
