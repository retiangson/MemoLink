import {
  TABS, type Tab, type Note,
  FlashcardsTab, QuizTab, ExamReviewTab, StudyPlanTab, WeakTopicsTab, SummaryTab,
} from "./study/StudyTabs";
import { StudyToolIcon, getStudyToolStyle } from "./StudyToolIcon";

interface Props {
  tool: Tab;
  workspaceId: number | null;
  notes: Note[];
}

export function StudyToolView({ tool, workspaceId, notes }: Props) {
  const meta = TABS.find((t) => t.id === tool);
  const style = getStudyToolStyle(tool);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-white mb-5">
        <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md ${style.bg} ${style.fg}`}>
          <StudyToolIcon tool={tool} className="w-3.5 h-3.5" />
        </span>
        {meta?.label}
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
