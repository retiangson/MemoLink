import {
  TABS, type Tab, type Note,
  FlashcardsTab, QuizTab, ExamReviewTab, StudyPlanTab, WeakTopicsTab, SummaryTab,
} from "./study/StudyTabs";

interface Props {
  tool: Tab;
  workspaceId: number | null;
  notes: Note[];
}

export function StudyToolView({ tool, workspaceId, notes }: Props) {
  const meta = TABS.find((t) => t.id === tool);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <h2 className="text-base font-semibold text-white mb-5">
        {meta?.icon} {meta?.label}
      </h2>

      {!workspaceId ? (
        <p className="text-sm text-gray-500">No active workspace.</p>
      ) : (
        <>
          {tool === "flashcards" && <FlashcardsTab workspaceId={workspaceId} notes={notes} />}
          {tool === "quiz" && <QuizTab workspaceId={workspaceId} notes={notes} />}
          {tool === "exam" && <ExamReviewTab workspaceId={workspaceId} notes={notes} />}
          {tool === "plan" && <StudyPlanTab workspaceId={workspaceId} />}
          {tool === "weak" && <WeakTopicsTab workspaceId={workspaceId} />}
          {tool === "summary" && <SummaryTab workspaceId={workspaceId} notes={notes} />}
        </>
      )}
    </main>
  );
}
