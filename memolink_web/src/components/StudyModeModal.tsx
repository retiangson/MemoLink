import { useState } from "react";
import {
  TABS, type Tab, type Note,
  FlashcardsTab, QuizTab, ExamReviewTab, StudyPlanTab, WeakTopicsTab, SummaryTab,
} from "./study/StudyTabs";

interface Props {
  show: boolean;
  onClose: () => void;
  workspaceId: number | null;
  notes: Note[];
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function StudyModeModal({ show, onClose, workspaceId, notes }: Props) {
  const [tab, setTab] = useState<Tab>("flashcards");

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-[#0d0d12] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--ml-bg-panel)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎓</span>
          <div>
            <span className="text-base font-semibold text-white">Study Mode</span>
            <span className="ml-2 text-xs text-gray-600">AI-powered study tools</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[var(--ml-bg-panel)] rounded-lg transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 shrink-0 border-r border-[var(--ml-bg-panel)] flex flex-col py-4 px-3 gap-1">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition ${
                tab === id
                  ? "bg-indigo-600/20 text-indigo-300 font-medium"
                  : "text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-panel)]"
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </button>
          ))}

          <div className="mt-auto px-3 py-3 border-t border-[var(--ml-bg-panel)]">
            <p className="text-[10px] text-gray-700 leading-relaxed">
              All study tools use your workspace notes as source material. Results can be saved as notes.
            </p>
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <h2 className="text-base font-semibold text-white mb-5">
            {TABS.find(t => t.id === tab)?.icon} {TABS.find(t => t.id === tab)?.label}
          </h2>

          {tab === "flashcards" && <FlashcardsTab workspaceId={workspaceId} notes={notes} />}
          {tab === "quiz"       && <QuizTab workspaceId={workspaceId} notes={notes} />}
          {tab === "exam"       && <ExamReviewTab workspaceId={workspaceId} notes={notes} />}
          {tab === "plan"       && <StudyPlanTab workspaceId={workspaceId} />}
          {tab === "weak"       && <WeakTopicsTab workspaceId={workspaceId} />}
          {tab === "summary"    && <SummaryTab workspaceId={workspaceId} notes={notes} />}
        </main>
      </div>
    </div>
  );
}
