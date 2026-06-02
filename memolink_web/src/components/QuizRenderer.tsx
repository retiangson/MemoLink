import React, { useState } from "react";

interface Question {
  id: number;
  type: "single" | "multi";
  question: string;
  options: string[];
  correct: number[];
  explanation: string;
}

interface QuizData {
  title: string;
  questions: Question[];
}

interface Props {
  quiz: QuizData;
  onSaveNote?: (title: string, content: string) => void;
}

export function QuizRenderer({ quiz, onSaveNote }: Props) {
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(qId: number, optIdx: number, type: "single" | "multi") {
    if (submitted) return;
    setAnswers((prev) => {
      const current = prev[qId] ?? [];
      if (type === "single") return { ...prev, [qId]: [optIdx] };
      const has = current.includes(optIdx);
      return { ...prev, [qId]: has ? current.filter((i) => i !== optIdx) : [...current, optIdx] };
    });
  }

  function handleSubmit() {
    if (Object.keys(answers).length === 0) return;
    setSubmitted(true);
  }

  const score = submitted
    ? quiz.questions.filter((q) => {
        const given = (answers[q.id] ?? []).slice().sort().join(",");
        const right = q.correct.slice().sort().join(",");
        return given === right;
      }).length
    : 0;

  const pct = submitted ? Math.round((score / quiz.questions.length) * 100) : 0;

  function buildMarkdown(): string {
    const date = new Date().toLocaleDateString("en-NZ", { year: "numeric", month: "short", day: "numeric" });
    const lines: string[] = [
      `# ${quiz.title} — Results`,
      ``,
      `**Score: ${score}/${quiz.questions.length} (${pct}%)** · ${date}`,
      ``,
      `---`,
      ``,
    ];
    quiz.questions.forEach((q, qi) => {
      const selected = answers[q.id] ?? [];
      const isCorrect = selected.slice().sort().join(",") === q.correct.slice().sort().join(",");
      lines.push(`**Q${qi + 1}.** ${q.question}`);
      lines.push(``);
      q.options.forEach((opt, oi) => {
        const picked = selected.includes(oi);
        const right = q.correct.includes(oi);
        const mark = right ? "✓" : picked && !right ? "✗" : " ";
        const label = picked ? (right ? `**${opt}** *(correct)*` : `~~${opt}~~ *(incorrect)*`) : right ? `**${opt}** *(correct answer)*` : opt;
        lines.push(`- ${mark} ${label}`);
      });
      if (q.explanation) {
        lines.push(``);
        lines.push(`> ${q.explanation}`);
      }
      lines.push(``);
    });
    const wrong = quiz.questions.filter((q) => {
      const given = (answers[q.id] ?? []).slice().sort().join(",");
      return given !== q.correct.slice().sort().join(",");
    });
    if (wrong.length > 0) {
      lines.push(`---`);
      lines.push(``);
      lines.push(`**Topics to review:** ${wrong.map((q) => q.question.split("?")[0].replace(/^(What|How|Why|Which|When|Who|Where)\s+(is|are|was|were|does|do|did|should|can|will)\s+/i, "").slice(0, 40)).join(", ")}`);
    }
    return lines.join("\n");
  }

  function handleSave() {
    if (!onSaveNote || saved) return;
    const title = `${quiz.title} — Results (${pct}%)`;
    onSaveNote(title, buildMarkdown());
    setSaved(true);
  }

  return (
    <div className="mt-2 rounded-2xl border border-[#2a2a38] bg-[#12121a] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a38] bg-[#1a1a24]">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0 2 0V6a.5.5 0 0 0-.311-.463z"/>
            <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466z"/>
          </svg>
          <span className="text-sm font-semibold text-gray-200">{quiz.title}</span>
        </div>
        <span className="text-[11px] text-gray-500">{quiz.questions.length} questions</span>
      </div>

      {/* Score bar */}
      {submitted && (
        <div className={`flex items-center justify-between px-5 py-3 border-b border-[#2a2a38] ${
          pct >= 80 ? "bg-green-900/20" : pct >= 60 ? "bg-amber-900/20" : "bg-red-900/20"
        }`}>
          <div>
            <p className={`text-base font-bold ${pct >= 80 ? "text-green-400" : pct >= 60 ? "text-amber-400" : "text-red-400"}`}>
              {score}/{quiz.questions.length} correct — {pct}%
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {pct >= 80 ? "Great work!" : pct >= 60 ? "Not bad - review the topics below." : "Review the explanations below."}
            </p>
          </div>
          <div className="w-12 h-12 rounded-full flex items-center justify-center border-2 border-current shrink-0"
            style={{ color: pct >= 80 ? "#4ade80" : pct >= 60 ? "#fbbf24" : "#f87171" }}>
            <span className="text-sm font-bold">{pct}%</span>
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="divide-y divide-[#2a2a38]">
        {quiz.questions.map((q, qi) => {
          const selected = answers[q.id] ?? [];
          const isCorrect = submitted && (() => {
            const given = selected.slice().sort().join(",");
            const right = q.correct.slice().sort().join(",");
            return given === right;
          })();

          return (
            <div key={q.id} className="px-5 py-4">
              <div className="flex items-start gap-2 mb-3">
                {submitted && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${isCorrect ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {isCorrect ? "✓" : "✗"}
                  </span>
                )}
                <p className="text-sm text-gray-200 font-medium leading-snug">
                  <span className="text-gray-500 mr-1.5">Q{qi + 1}.</span>{q.question}
                </p>
              </div>

              <div className="space-y-2 ml-1">
                {q.options.map((opt, oi) => {
                  const isSelected = selected.includes(oi);
                  const isRight = q.correct.includes(oi);
                  let optCls = "border-[#2a2a38] text-gray-400 hover:border-indigo-500/40 hover:text-gray-200";
                  if (submitted) {
                    if (isRight) optCls = "border-green-500/50 bg-green-500/10 text-green-300";
                    else if (isSelected && !isRight) optCls = "border-red-500/50 bg-red-500/10 text-red-300";
                    else optCls = "border-[#2a2a38] text-gray-600";
                  } else if (isSelected) {
                    optCls = "border-indigo-500/60 bg-indigo-500/10 text-indigo-300";
                  }

                  return (
                    <button
                      key={oi}
                      onClick={() => toggle(q.id, oi, q.type)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left text-sm transition ${optCls} ${submitted ? "cursor-default" : ""}`}
                    >
                      <span className={`w-4 h-4 shrink-0 rounded-${q.type === "single" ? "full" : "md"} border flex items-center justify-center ${
                        submitted
                          ? isRight ? "border-green-500 bg-green-500/30" : isSelected ? "border-red-500 bg-red-500/30" : "border-[#3a3a48]"
                          : isSelected ? "border-indigo-500 bg-indigo-500/30" : "border-[#3a3a48]"
                      }`}>
                        {(isSelected || (submitted && isRight)) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>

              {submitted && q.explanation && (
                <div className="mt-3 px-3 py-2 rounded-xl bg-[#1e1e2a] border border-[#2a2a38]">
                  <p className="text-[11px] text-indigo-400 font-medium uppercase tracking-wider mb-1">Explanation</p>
                  <p className="text-xs text-gray-400 leading-relaxed">{q.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[#2a2a38] flex items-center justify-between gap-3">
        {!submitted ? (
          <>
            <p className="text-xs text-gray-600">{Object.keys(answers).length}/{quiz.questions.length} answered</p>
            <button
              onClick={handleSubmit}
              disabled={Object.keys(answers).length === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
            >
              Submit Quiz
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-600">
              {pct >= 80 ? "Excellent result!" : pct >= 60 ? "Good effort — review missed topics." : "Review the explanations above."}
            </p>
            {onSaveNote && (
              <button
                onClick={handleSave}
                disabled={saved}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  saved
                    ? "bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 cursor-default"
                    : "bg-[#1e1e2a] border border-[#2a2a38] text-gray-300 hover:border-indigo-500/40 hover:text-indigo-300"
                }`}
              >
                {saved ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Saved to Notes
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Save Results to Notes
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
