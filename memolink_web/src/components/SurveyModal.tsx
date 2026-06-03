import React, { useEffect, useState } from "react";
import {
  getActiveSurvey, submitSurvey,
  type ActiveSurvey, type SurveyQuestion, type SurveyAnswerInput,
} from "../api/surveyApi";

interface Props {
  show: boolean;
  onClose: () => void;
  workspaceId: number | null;
}

type AnswerMap = Record<string, string | string[]>;

const LIKERT_LABELS = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"];

export function SurveyModal({ show, onClose, workspaceId }: Props) {
  const [survey, setSurvey] = useState<ActiveSurvey | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"consent" | "form" | "done">("consent");
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantCode, setParticipantCode] = useState("");

  useEffect(() => {
    if (!show) return;
    setStep("consent"); setConsent(false); setAnswers({}); setOtherText({});
    setError(null); setParticipantCode("");
    setLoading(true);
    getActiveSurvey()
      .then(setSurvey)
      .catch(() => setError("Could not load the survey. Please try again."))
      .finally(() => setLoading(false));
  }, [show]);

  if (!show) return null;

  function setAnswer(key: string, value: string | string[]) {
    setAnswers(a => ({ ...a, [key]: value }));
  }

  function toggleMulti(key: string, opt: string) {
    setAnswers(a => {
      const cur = Array.isArray(a[key]) ? (a[key] as string[]) : [];
      return { ...a, [key]: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] };
    });
  }

  function isAnswered(q: SurveyQuestion): boolean {
    const v = answers[q.question_key];
    if (q.answer_type === "multi") return Array.isArray(v) && v.length > 0;
    return v != null && String(v).trim() !== "";
  }

  function resolveValue(q: SurveyQuestion): string | string[] | undefined {
    const v = answers[q.question_key];
    if (v == null) return undefined;
    // "Other" free text for single-choice
    if (q.answer_type === "single" && v === "Other" && otherText[q.question_key]?.trim()) {
      return otherText[q.question_key].trim();
    }
    return v;
  }

  async function handleSubmit() {
    if (!survey) return;
    const allQuestions = survey.sections.flatMap(s => s.questions);
    const missing = allQuestions.find(q => q.required && !isAnswered(q));
    if (missing) {
      setError(`Please answer: "${missing.question_text}"`);
      return;
    }
    const payload: SurveyAnswerInput[] = [];
    for (const q of allQuestions) {
      if (!isAnswered(q)) continue;
      const val = resolveValue(q);
      if (val === undefined) continue;
      payload.push({ question_key: q.question_key, answer_value: val });
    }
    setSubmitting(true); setError(null);
    try {
      const res = await submitSurvey(consent, payload, workspaceId);
      setParticipantCode(res.participant_code);
      setStep("done");
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[680px] max-w-full max-h-[88vh] flex flex-col shadow-2xl text-white overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38] shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5z"/>
              <path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5z"/>
              <path d="M10.854 7.854a.5.5 0 0 0-.708-.708L7.5 9.793 6.354 8.646a.5.5 0 1 0-.708.708l1.5 1.5a.5.5 0 0 0 .708 0z"/>
            </svg>
            <div>
              <h2 className="font-semibold text-base leading-tight">{survey?.title ?? "MemoLink Evaluation Survey"}</h2>
              <p className="text-[11px] text-gray-500">Academic evaluation · ~3 minutes</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#2a2a38] transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-sm text-gray-500">Loading survey…</p>}

          {!loading && step === "consent" && survey && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 leading-relaxed">{survey.intro}</p>
              <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl p-4">
                <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">Before you start</p>
                <ul className="space-y-1.5 text-[13px] text-gray-400">
                  {[
                    "Create or upload one note / document / transcript.",
                    "Ask MemoLink a question based on that content.",
                    "Check whether the answer includes a useful source / citation.",
                    "Generate or review one reminder / action item.",
                    "Try to find the information again using chat.",
                  ].map((t, i) => (
                    <li key={i} className="flex gap-2"><span className="text-indigo-500 shrink-0">{i + 1}.</span><span>{t}</span></li>
                  ))}
                </ul>
              </div>
              <label className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-indigo-500 w-4 h-4 shrink-0" />
                <span className="text-[13px] text-gray-300 leading-relaxed">{survey.consent_text}</span>
              </label>
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          )}

          {!loading && step === "form" && survey && (
            <div className="space-y-7">
              {survey.sections.map(sec => (
                <div key={sec.section}>
                  <h3 className="text-sm font-semibold text-indigo-300 mb-3 pb-1.5 border-b border-[#2a2a38]">{sec.section}</h3>
                  <div className="space-y-5">
                    {sec.questions.map(q => (
                      <QuestionField
                        key={q.id}
                        q={q}
                        value={answers[q.question_key]}
                        otherText={otherText[q.question_key] ?? ""}
                        onChange={v => setAnswer(q.question_key, v)}
                        onToggleMulti={opt => toggleMulti(q.question_key, opt)}
                        onOtherText={t => setOtherText(o => ({ ...o, [q.question_key]: t }))}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">Thank you!</h3>
              <p className="text-sm text-gray-400 max-w-sm">Your responses were recorded for the MemoLink evaluation. Your participant code is:</p>
              <span className="px-3 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono text-sm">{participantCode}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#2a2a38] shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-gray-700">MemoLink · Capstone evaluation</p>
          <div className="flex gap-2">
            {step === "consent" && (
              <button
                disabled={!consent || loading}
                onClick={() => { setError(null); setStep("form"); }}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Start survey →
              </button>
            )}
            {step === "form" && (
              <>
                <button onClick={() => setStep("consent")} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-[#2a2a38] hover:text-gray-200 transition">Back</button>
                <button
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition"
                >
                  {submitting ? "Submitting…" : "Submit survey"}
                </button>
              </>
            )}
            {step === "done" && (
              <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition">Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Single question renderer ──────────────────────────────────────────────────

function QuestionField({
  q, value, otherText, onChange, onToggleMulti, onOtherText,
}: {
  q: SurveyQuestion;
  value: string | string[] | undefined;
  otherText: string;
  onChange: (v: string) => void;
  onToggleMulti: (opt: string) => void;
  onOtherText: (t: string) => void;
}) {
  const label = (
    <p className="text-[13px] text-gray-200 mb-2">
      {q.question_text}{q.required && <span className="text-red-400 ml-1">*</span>}
    </p>
  );

  if (q.answer_type === "likert") {
    return (
      <div>
        {label}
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map(n => {
            const sel = String(value) === String(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => onChange(String(n))}
                title={LIKERT_LABELS[n - 1]}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition ${
                  sel ? "bg-indigo-600 border-indigo-500 text-white" : "bg-[#12121a] border-[#2a2a38] text-gray-400 hover:border-indigo-500/40"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 px-0.5">
          <span className="text-[10px] text-gray-600">Strongly Disagree</span>
          <span className="text-[10px] text-gray-600">Strongly Agree</span>
        </div>
      </div>
    );
  }

  if (q.answer_type === "single") {
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {q.options.map(opt => {
            const sel = value === opt;
            return (
              <label key={opt} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition ${
                sel ? "bg-indigo-500/10 border-indigo-500/40" : "bg-[#12121a] border-[#2a2a38] hover:border-[#3a3a48]"
              }`}>
                <input type="radio" name={q.question_key} checked={sel} onChange={() => onChange(opt)} className="accent-indigo-500" />
                <span className="text-[13px] text-gray-300">{opt}</span>
              </label>
            );
          })}
          {value === "Other" && (
            <input
              value={otherText}
              onChange={e => onOtherText(e.target.value)}
              placeholder="Please specify…"
              className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-[13px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          )}
        </div>
      </div>
    );
  }

  if (q.answer_type === "multi") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {q.options.map(opt => {
            const sel = arr.includes(opt);
            return (
              <label key={opt} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition ${
                sel ? "bg-indigo-500/10 border-indigo-500/40" : "bg-[#12121a] border-[#2a2a38] hover:border-[#3a3a48]"
              }`}>
                <input type="checkbox" checked={sel} onChange={() => onToggleMulti(opt)} className="accent-indigo-500" />
                <span className="text-[13px] text-gray-300">{opt}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  if (q.answer_type === "long") {
    return (
      <div>
        {label}
        <textarea
          value={(value as string) ?? ""}
          onChange={e => onChange(e.target.value)}
          rows={4}
          className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-[13px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-y"
          placeholder="Your answer…"
        />
      </div>
    );
  }

  // short
  return (
    <div>
      {label}
      <input
        value={(value as string) ?? ""}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-[13px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        placeholder="Your answer…"
      />
    </div>
  );
}
