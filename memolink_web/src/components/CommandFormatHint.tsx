import React from "react";

export const NOTE_COMMANDS = new Set([
  "improve","enhance","summarize","natural","humanize",
  "update","add","undo","quiz","discussion","read",
]);

export const FORMAT_HINTS: Record<string, { format: string; examples: string[] }> = {
  write: {
    format: "/Write  your writing prompt",
    examples: [
      "Write a research essay on adaptive AI systems",
      "Help me write my assessment report on distributed systems security",
      "Draft a professional email to my supervisor about project progress",
    ],
  },
  feedback:  {
    format: "/Feedback  title : message",
    examples: [
      "Better Quiz UI : Add a review mode after submission",
      "Dark mode icons : Replace emoji with SVG icons",
    ],
  },
  reportbug: {
    format: "/ReportBug  title : description",
    examples: [
      "Upload Crash : App crashes with files larger than 10 MB",
      "Tab key broken : Tab doesn't autocomplete in Firefox",
    ],
  },
  reminder:  {
    format: "/Reminder  title : YYYY-MM-DD HH:MM",
    examples: [
      "Submit Assignment : 2026-06-10 18:00",
      "Team Meeting : 2026-06-15 09:30",
    ],
  },
};

interface Props {
  command: string;
  onClose: () => void;
}

export function CommandFormatHint({ command, onClose }: Props) {
  const hint = FORMAT_HINTS[command.toLowerCase()];
  if (!hint) return null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full mb-1.5 left-0 right-0 z-40 bg-black/60 backdrop-blur-md border border-white/8 rounded-xl shadow-xl overflow-hidden">
        <div className="px-3 pt-2.5 pb-1.5">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Format</p>
          <code className="text-xs text-indigo-300 font-mono">{hint.format}</code>
        </div>
        <div className="border-t border-white/6 px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Examples</p>
          {hint.examples.map((ex, i) => (
            <p key={i} className="text-[11px] text-gray-500 font-mono leading-relaxed">
              <span className="text-gray-700">›</span> {ex}
            </p>
          ))}
        </div>
      </div>
    </>
  );
}
