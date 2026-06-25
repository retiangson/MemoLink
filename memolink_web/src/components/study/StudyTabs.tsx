import React, { useState } from "react";
import {
  generateFlashcards, generateExamReview, generateStudyPlan,
  detectWeakTopics, summarizeNote, generateQuiz,
  type FlashcardItem, type ExamReviewResponse, type StudyPlanResponse,
  type WeakTopicsResponse, type SummaryResponse, type QuizData,
} from "../../api/studyApi";
import { createNote } from "../../api/client";
import { QuizRenderer } from "../QuizRenderer";

export interface Note { id: number; title: string | null; }

export type Tab = "flashcards" | "quiz" | "exam" | "plan" | "weak" | "summary";

export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "flashcards", label: "Flashcards",    icon: "🃏" },
  { id: "quiz",       label: "Quiz",          icon: "❓" },
  { id: "exam",       label: "Exam Review",   icon: "📋" },
  { id: "plan",       label: "Study Plan",    icon: "📅" },
  { id: "weak",       label: "Weak Topics",   icon: "🔍" },
  { id: "summary",    label: "Summary",       icon: "📝" },
];

export function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-[3px] border-indigo-500/20 border-t-indigo-400 animate-spin" />
      </div>
      <p className="text-sm text-gray-500 animate-pulse">Generating with AI…</p>
    </div>
  );
}

function SaveNoteButton({ content, title, workspaceId }: { content: string; title: string; workspaceId: number | null }) {
  const [saved, setSaved] = useState(false);
  async function handleSave() {
    if (!workspaceId) return;
    await createNote(title, `<p>${content.replace(/\n/g, "</p><p>")}</p>`, null, workspaceId);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  return (
    <button
      onClick={handleSave}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition"
    >
      {saved ? "✓ Saved!" : "💾 Save as Note"}
    </button>
  );
}

// ── Quiz tab ──────────────────────────────────────────────────────────────────

const QUIZ_TYPES: { id: string; label: string }[] = [
  { id: "default",               label: "Default" },
  { id: "reading_comprehension", label: "Reading Comprehension" },
  { id: "math_problem_solving",  label: "Math / Problem Solving" },
  { id: "logic_reasoning",       label: "Logic & Reasoning" },
  { id: "vocabulary",            label: "Vocabulary" },
  { id: "critical_thinking",     label: "Critical Thinking" },
  { id: "other",                 label: "Other (custom)" },
];

export function QuizTab({ workspaceId, notes }: { workspaceId: number | null; notes: Note[] }) {
  const [noteId, setNoteId] = useState<string>("all");
  const [count, setCount] = useState(10);
  const [quizType, setQuizType] = useState("default");
  const [customFocus, setCustomFocus] = useState("");
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!workspaceId) return;
    setLoading(true); setError(null); setQuiz(null);
    try {
      const res = await generateQuiz(
        workspaceId,
        noteId === "all" ? null : Number(noteId),
        count,
        quizType,
        quizType === "other" ? customFocus.trim() : undefined,
      );
      if (!res.questions.length) { setError("No questions generated. Try adding more notes to this workspace."); return; }
      setQuiz(res);
    } catch { setError("Failed to generate quiz. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleSaveNote(title: string, content: string) {
    if (!workspaceId) return;
    await createNote(title, `<p>${content.replace(/\n/g, "</p><p>")}</p>`, null, workspaceId);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Note</label>
          <select
            value={noteId}
            onChange={e => { setNoteId(e.target.value); setQuiz(null); }}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 min-w-[160px]"
          >
            <option value="all">All notes</option>
            {notes.map(n => <option key={n.id} value={String(n.id)}>{n.title || "Untitled"}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Questions</label>
          <select
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
          >
            {[5, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} questions</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Quiz type</label>
          <select
            value={quizType}
            onChange={e => { setQuizType(e.target.value); setQuiz(null); }}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 min-w-[170px]"
          >
            {QUIZ_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        {quizType === "other" && (
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-[10px] text-gray-600 uppercase tracking-wider">Describe the focus</label>
            <input
              type="text"
              value={customFocus}
              onChange={e => setCustomFocus(e.target.value)}
              placeholder="e.g. understand the meaning of the story"
              maxLength={200}
              className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
        )}
        <button
          onClick={handleGenerate}
          disabled={loading || !workspaceId || (quizType === "other" && !customFocus.trim())}
          className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
        >
          Generate Quiz
        </button>
      </div>

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {quiz && <QuizRenderer quiz={quiz} onSaveNote={handleSaveNote} />}
    </div>
  );
}

// ── Flashcards tab ────────────────────────────────────────────────────────────

export function FlashcardsTab({ workspaceId, notes }: { workspaceId: number | null; notes: Note[] }) {
  const [noteId, setNoteId] = useState<string>("all");
  const [count, setCount] = useState(10);
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!workspaceId) return;
    setLoading(true); setError(null); setCards([]); setIdx(0); setRevealed(false); setKnown(new Set());
    try {
      const res = await generateFlashcards(workspaceId, noteId === "all" ? null : Number(noteId), count);
      if (!res.cards.length) { setError("No flashcards generated. Try adding more notes to this workspace."); return; }
      setCards(res.cards);
    } catch { setError("Failed to generate flashcards. Please try again."); }
    finally { setLoading(false); }
  }

  const card = cards[idx];
  const knownCount = known.size;

  function handleKnow() {
    setKnown(k => new Set([...k, idx]));
    next();
  }
  function handleAgain() {
    setKnown(k => { const n = new Set(k); n.delete(idx); return n; });
    next();
  }
  function next() { setRevealed(false); setIdx(i => Math.min(i + 1, cards.length - 1)); }
  function prev() { setRevealed(false); setIdx(i => Math.max(i - 1, 0)); }

  const saveContent = cards.map((c, i) => `Q${i+1}: ${c.question}\nA: ${c.answer}`).join("\n\n");

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Note</label>
          <select
            value={noteId}
            onChange={e => setNoteId(e.target.value)}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 min-w-[160px]"
          >
            <option value="all">All notes</option>
            {notes.map(n => <option key={n.id} value={String(n.id)}>{n.title || "Untitled"}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Count</label>
          <select
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
          >
            {[5, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} cards</option>)}
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !workspaceId}
          className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
        >
          Generate Flashcards
        </button>
      </div>

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {cards.length > 0 && (
        <>
          {/* Progress */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Card {idx + 1} of {cards.length}</span>
            <span className="text-emerald-400 font-medium">{knownCount} known · {cards.length - knownCount} to review</span>
          </div>
          <div className="w-full bg-[var(--ml-bg-panel)] rounded-full h-1.5">
            <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${((idx + 1) / cards.length) * 100}%` }} />
          </div>

          {/* Card */}
          <div
            onClick={() => setRevealed(r => !r)}
            className="cursor-pointer min-h-[180px] bg-[var(--ml-bg-surface)] border-2 border-[var(--ml-bg-hover)] hover:border-indigo-500/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center select-none transition"
          >
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">
              {revealed ? "Answer" : "Question - click to reveal"}
            </p>
            <p className={`text-base font-medium leading-relaxed transition-all ${revealed ? "text-emerald-300" : "text-white"}`}>
              {revealed ? card.answer : card.question}
            </p>
            {!revealed && (
              <p className="text-[10px] text-gray-700 mt-4">tap to flip</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3">
            <button onClick={prev} disabled={idx === 0} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[var(--ml-bg-hover)] rounded-lg disabled:opacity-30 transition">◀ Prev</button>
            <div className="flex gap-2">
              <button
                onClick={handleAgain}
                className="px-4 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition"
              >🔄 Review Again</button>
              <button
                onClick={handleKnow}
                className="px-4 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition"
              >✓ I Know This</button>
            </div>
            <button onClick={next} disabled={idx === cards.length - 1} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[var(--ml-bg-hover)] rounded-lg disabled:opacity-30 transition">Next ▶</button>
          </div>

          <div className="flex justify-end">
            <SaveNoteButton content={saveContent} title={`Flashcards - ${new Date().toLocaleDateString()}`} workspaceId={workspaceId} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Exam Review tab ───────────────────────────────────────────────────────────

export function ExamReviewTab({ workspaceId, notes }: { workspaceId: number | null; notes: Note[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [review, setReview] = useState<ExamReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleNote(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleGenerate() {
    if (!workspaceId) return;
    setLoading(true); setError(null); setReview(null);
    try {
      const res = await generateExamReview(workspaceId, [...selected]);
      setReview(res);
    } catch { setError("Failed to generate exam review. Please try again."); }
    finally { setLoading(false); }
  }

  const saveContent = review ? [
    `Overview: ${review.overview}`,
    `\nKey Concepts:\n${review.key_concepts.map(c => `• ${c}`).join("\n")}`,
    `\nDefinitions:\n${review.definitions.map(d => `${d.term}: ${d.definition}`).join("\n")}`,
    `\nImportant Facts:\n${review.important_facts.map(f => `• ${f}`).join("\n")}`,
    `\nLikely Exam Questions:\n${review.likely_questions.map((q, i) => `${i+1}. ${q}`).join("\n")}`,
    `\nTopics to Focus On:\n${review.focus_topics.map(t => `• ${t}`).join("\n")}`,
  ].join("") : "";

  return (
    <div className="space-y-4">
      {/* Note selector */}
      <div>
        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">
          Select notes <span className="text-gray-700">(leave all unchecked to include everything)</span>
        </p>
        <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
          {notes.map(n => (
            <label key={n.id} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg cursor-pointer hover:border-indigo-500/30 transition">
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggleNote(n.id)}
                className="accent-indigo-500"
              />
              <span className="text-xs text-gray-300 truncate">{n.title || "Untitled"}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !workspaceId}
        className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
      >
        Generate Exam Review
      </button>

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {review && (
        <div className="space-y-4">
          {review.overview && (
            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3">
              <p className="text-xs text-gray-300 leading-relaxed">{review.overview}</p>
            </div>
          )}

          {[
            { title: "Key Concepts", items: review.key_concepts, color: "text-indigo-400" },
            { title: "Important Facts", items: review.important_facts, color: "text-cyan-400" },
            { title: "Topics to Focus On", items: review.focus_topics, color: "text-amber-400" },
          ].map(({ title, items, color }) => items.length > 0 && (
            <div key={title}>
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${color}`}>{title}</p>
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-400">
                    <span className="text-indigo-500 shrink-0 mt-0.5">•</span><span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {review.definitions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Definitions</p>
              <div className="space-y-1.5">
                {review.definitions.map((d, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr] gap-3 text-xs bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2">
                    <span className="font-semibold text-white shrink-0">{d.term}</span>
                    <span className="text-gray-400">{d.definition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {review.likely_questions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-2">Likely Exam Questions</p>
              <ol className="space-y-1.5">
                {review.likely_questions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-400 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2">
                    <span className="text-violet-400 font-bold shrink-0">{i + 1}.</span><span>{q}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex justify-end">
            <SaveNoteButton content={saveContent} title={`Exam Review - ${new Date().toLocaleDateString()}`} workspaceId={workspaceId} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Study Plan tab ────────────────────────────────────────────────────────────

export function StudyPlanTab({ workspaceId }: { workspaceId: number | null }) {
  const [days, setDays] = useState(7);
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<StudyPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!workspaceId) return;
    setLoading(true); setError(null); setPlan(null);
    try {
      const res = await generateStudyPlan(workspaceId, days, goal);
      setPlan(res);
    } catch { setError("Failed to generate study plan. Please try again."); }
    finally { setLoading(false); }
  }

  const saveContent = plan ? [
    `Study Plan: ${plan.overall_goal}`,
    ...plan.plan.map(d =>
      `\n${d.label} - ${d.focus}\nTopics: ${d.topics.join(", ")}\nTasks:\n${d.tasks.map(t => `• ${t}`).join("\n")}`,
    ),
  ].join("\n") : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Days to study</label>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
          >
            {[1, 3, 5, 7, 10, 14, 21, 30].map(d => <option key={d} value={d}>{d} day{d !== 1 ? "s" : ""}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Goal (optional)</label>
          <input
            type="text"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="e.g. Prepare for my final exam in operating systems"
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !workspaceId}
          className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
        >
          Generate Plan
        </button>
      </div>

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {plan && (
        <div className="space-y-3">
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Goal</p>
            <p className="text-sm font-medium text-white">{plan.overall_goal}</p>
          </div>

          <div className="space-y-2">
            {plan.plan.map((d, i) => (
              <div key={i} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--ml-bg-hover)] bg-[#1a1a24]">
                  <span className="text-xs font-bold text-indigo-400 shrink-0">{d.label}</span>
                  <span className="text-xs font-semibold text-white">{d.focus}</span>
                </div>
                <div className="px-4 py-2.5 space-y-2">
                  {d.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {d.topics.map((t, j) => (
                        <span key={j} className="text-[10px] px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                  {d.tasks.length > 0 && (
                    <ul className="space-y-0.5">
                      {d.tasks.map((t, j) => (
                        <li key={j} className="flex gap-2 text-[11px] text-gray-400">
                          <span className="text-indigo-500 shrink-0">•</span><span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.note_titles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.note_titles.map((t, j) => (
                        <span key={j} className="text-[10px] px-2 py-0.5 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] text-gray-500 rounded-md">📝 {t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <SaveNoteButton content={saveContent} title={`Study Plan - ${plan.overall_goal}`} workspaceId={workspaceId} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Weak Topics tab ───────────────────────────────────────────────────────────

export function WeakTopicsTab({ workspaceId }: { workspaceId: number | null }) {
  const [result, setResult] = useState<WeakTopicsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!workspaceId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await detectWeakTopics(workspaceId);
      setResult(res);
    } catch { setError("Failed to analyse conversations. Please try again."); }
    finally { setLoading(false); }
  }

  const FREQ_COLOR = (f: number) => f >= 5 ? "bg-red-500/10 border-red-500/20 text-red-400" : f >= 3 ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-sky-500/10 border-sky-500/20 text-sky-400";

  return (
    <div className="space-y-4">
      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3">
        <p className="text-xs text-gray-500 leading-relaxed">
          MemoLink scans your recent conversation questions in this workspace to find topics you repeatedly ask about or struggle with. Requires at least 5 questions in this workspace.
        </p>
      </div>

      <button
        onClick={handleScan}
        disabled={loading || !workspaceId}
        className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
      >
        Scan Conversations
      </button>

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <>
          {result.message && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
              <p className="text-xs text-amber-300">{result.message}</p>
            </div>
          )}

          {result.topics.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">Found {result.topics.length} topic{result.topics.length !== 1 ? "s" : ""} you frequently ask about:</p>
              {result.topics.map((t, i) => (
                <div key={i} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">{t.topic}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${FREQ_COLOR(t.frequency)}`}>
                      ×{t.frequency}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{t.simple_explanation}</p>
                  {t.study_tip && (
                    <div className="flex gap-2 bg-indigo-500/5 border border-indigo-500/15 rounded-lg px-3 py-2">
                      <span className="text-indigo-400 shrink-0 text-[10px] font-semibold uppercase tracking-wider pt-0.5">Tip</span>
                      <p className="text-[11px] text-gray-400">{t.study_tip}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.topics.length === 0 && !result.message && (
            <p className="text-sm text-gray-500 text-center py-8">No recurring patterns found. Great - you ask diverse questions!</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Summary tab ───────────────────────────────────────────────────────────────

export function SummaryTab({ workspaceId, notes }: { workspaceId: number | null; notes: Note[] }) {
  const [noteId, setNoteId] = useState<string>("");
  const [level, setLevel] = useState<"short" | "medium" | "detailed">("medium");
  const [result, setResult] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!workspaceId || !noteId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await summarizeNote(workspaceId, Number(noteId), level);
      setResult(res);
    } catch { setError("Failed to generate summary. Please try again."); }
    finally { setLoading(false); }
  }

  const LEVEL_LABELS = { short: "3–5 Key Points", medium: "Paragraph Summary", detailed: "Full Structured" };
  const saveContent = result ? (result.bullet_points ? result.bullet_points.map(b => `• ${b}`).join("\n") : result.summary) : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Note</label>
          <select
            value={noteId}
            onChange={e => setNoteId(e.target.value)}
            className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">Select a note…</option>
            {notes.map(n => <option key={n.id} value={String(n.id)}>{n.title || "Untitled"}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-gray-600 uppercase tracking-wider">Detail level</label>
          <div className="flex gap-1 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg p-0.5">
            {(["short", "medium", "detailed"] as const).map(l => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${level === l ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-200"}`}
              >
                {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading || !workspaceId || !noteId}
          className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
        >
          Generate Summary
        </button>
      </div>

      {level && (
        <p className="text-[11px] text-gray-600">{LEVEL_LABELS[level]}</p>
      )}

      {loading && <Spinner />}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{result.note_title} · <span className="capitalize">{result.level}</span></p>
            <SaveNoteButton content={saveContent} title={`Summary (${result.level}) - ${result.note_title}`} workspaceId={workspaceId} />
          </div>

          {result.bullet_points ? (
            <ul className="space-y-2">
              {result.bullet_points.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-300 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-2.5">
                  <span className="text-indigo-400 shrink-0 font-bold">{i + 1}.</span><span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-4">
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{result.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
