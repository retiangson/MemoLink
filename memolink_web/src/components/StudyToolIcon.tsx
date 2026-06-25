import type { Tab } from "./study/StudyTabs";

const STUDY_TOOL_STYLES: Record<Tab, { bg: string; fg: string; label: string }> = {
  flashcards: { bg: "bg-sky-500/15", fg: "text-sky-400", label: "Flashcards" },
  quiz: { bg: "bg-amber-500/15", fg: "text-amber-400", label: "Quiz" },
  exam: { bg: "bg-violet-500/15", fg: "text-violet-400", label: "Exam Review" },
  plan: { bg: "bg-emerald-500/15", fg: "text-emerald-400", label: "Study Plan" },
  weak: { bg: "bg-rose-500/15", fg: "text-rose-400", label: "Weak Topics" },
  summary: { bg: "bg-cyan-500/15", fg: "text-cyan-400", label: "Summary" },
};

export function getStudyToolStyle(tool: Tab) {
  return STUDY_TOOL_STYLES[tool];
}

export function StudyToolIcon({ tool, className = "w-4 h-4" }: { tool: Tab; className?: string }) {
  switch (tool) {
    case "flashcards":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="8" width="14" height="10" rx="1.5" strokeLinejoin="round" />
          <rect x="7" y="4" width="14" height="10" rx="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "quiz":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="3" width="18" height="18" rx="3" strokeLinejoin="round" />
          <path d="M9.5 9.2a2.5 2.5 0 1 1 3.7 2.2c-.7.4-1.2.9-1.2 1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "exam":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M9 3.5h6a1 1 0 0 1 1 1V5h1.5A1.5 1.5 0 0 1 19 6.5v14A1.5 1.5 0 0 1 17.5 22h-11A1.5 1.5 0 0 1 5 20.5v-14A1.5 1.5 0 0 1 6.5 5H8v-.5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M8.5 11.5l1.3 1.3 2.2-2.6M8.5 16.5l1.3 1.3 2.2-2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 12h3M14 17h3" strokeLinecap="round" />
        </svg>
      );
    case "plan":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="5" width="18" height="16" rx="2" strokeLinejoin="round" />
          <path d="M3 9.5h18M8 3v4M16 3v4" strokeLinecap="round" />
          <path d="M7.5 13.5h3M7.5 17h5.5" strokeLinecap="round" />
        </svg>
      );
    case "weak":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "summary":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M14 3v4h4" strokeLinejoin="round" />
          <path d="M8.5 12.5h7M8.5 15.5h4.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function StudyCapIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
      <path d="M12 4 2 9l10 5 10-5Z" strokeLinejoin="round" />
      <path d="M6 11.5V17c0 1 2.5 2 6 2s6-1 6-2v-5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 9v5" strokeLinecap="round" />
    </svg>
  );
}
