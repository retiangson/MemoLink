import React, { useEffect, useState } from "react";
import {
  listQuestions, createQuestion, updateQuestion, deleteQuestion, resetDefaultQuestions,
  getSurveyReport, downloadSurveyCsv,
  type SurveyQuestion, type QuestionUpsert, type AnswerType, type SurveyReport, type QuestionReport,
} from "../api/surveyApi";

const TYPE_LABELS: Record<AnswerType, string> = {
  likert: "Likert (1–5)",
  single: "Single choice",
  multi: "Multiple choice",
  short: "Short text",
  long: "Long text",
};

const ALL_TYPES: AnswerType[] = ["likert", "single", "multi", "short", "long"];

export function AdminSurveyPanel() {
  const [subTab, setSubTab] = useState<"questions" | "report">("questions");

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Evaluation Survey</h2>
          <p className="text-xs text-gray-500">Research data - stored separately from feedback / bug reports.</p>
        </div>
        <div className="flex gap-1 bg-[#12121a] border border-[#2a2a38] rounded-xl p-1">
          {(["questions", "report"] as const).map(t => (
            <button
              key={t}
              onClick={() => setSubTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                subTab === t ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t === "questions" ? "Questions" : "Report & Data"}
            </button>
          ))}
        </div>
      </div>

      {subTab === "questions" ? <QuestionsTab /> : <ReportTab />}
    </div>
  );
}

// ── Questions management ──────────────────────────────────────────────────────

const EMPTY: QuestionUpsert = {
  section: "General", question_text: "", answer_type: "likert",
  options: [], required: false, active: true,
};

function QuestionsTab() {
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null; body: QuestionUpsert } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setQuestions(await listQuestions()); }
    catch { setError("Failed to load questions."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setEditing({ id: null, body: { ...EMPTY, order_index: (questions[questions.length - 1]?.order_index ?? 0) + 1 } });
  }
  function startEdit(q: SurveyQuestion) {
    setEditing({ id: q.id, body: {
      section: q.section, question_key: q.question_key, question_text: q.question_text,
      answer_type: q.answer_type, options: q.options, order_index: q.order_index,
      required: q.required, active: q.active,
    }});
  }

  async function save() {
    if (!editing) return;
    if (!editing.body.question_text.trim()) { setError("Question text is required."); return; }
    setBusy(true); setError(null);
    try {
      if (editing.id == null) await createQuestion(editing.body);
      else await updateQuestion(editing.id, editing.body);
      setEditing(null);
      await load();
    } catch { setError("Save failed."); }
    finally { setBusy(false); }
  }

  async function remove(q: SurveyQuestion) {
    if (!confirm(`Delete question "${q.question_text}"? Existing answers are kept but lose their question definition.`)) return;
    await deleteQuestion(q.id);
    await load();
  }

  async function resetDefaults() {
    if (!confirm("Re-add any missing default survey questions?")) return;
    const r = await resetDefaultQuestions();
    alert(`${r.added} default question(s) added.`);
    await load();
  }

  // Group by section preserving order
  const sections: { name: string; items: SurveyQuestion[] }[] = [];
  for (const q of questions) {
    let sec = sections.find(s => s.name === q.section);
    if (!sec) { sec = { name: q.section, items: [] }; sections.push(sec); }
    sec.items.push(q);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400">{questions.length} question{questions.length !== 1 ? "s" : ""}</p>
        <div className="flex gap-2">
          <button onClick={resetDefaults} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-[#2a2a38] hover:text-gray-200 transition">Reset defaults</button>
          <button onClick={startNew} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition">+ Add question</button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="space-y-5">
          {sections.map(sec => (
            <div key={sec.name}>
              <h3 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2">{sec.name}</h3>
              <div className="space-y-1.5">
                {sec.items.map(q => (
                  <div key={q.id} className="flex items-start gap-3 bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-200">{q.question_text}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">{TYPE_LABELS[q.answer_type]}</span>
                        <span className="text-[10px] text-gray-600 font-mono">{q.question_key}</span>
                        {q.required && <span className="text-[10px] text-amber-400">required</span>}
                        {!q.active && <span className="text-[10px] text-gray-600">hidden</span>}
                        {q.options.length > 0 && <span className="text-[10px] text-gray-600">{q.options.length} options</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(q)} className="px-2 py-1 rounded-lg text-[11px] text-gray-400 border border-[#2a2a38] hover:text-indigo-300 transition">Edit</button>
                      <button onClick={() => remove(q)} className="px-2 py-1 rounded-lg text-[11px] text-gray-500 border border-[#2a2a38] hover:text-red-400 transition">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <QuestionEditor
          body={editing.body}
          isNew={editing.id == null}
          busy={busy}
          onChange={b => setEditing(e => e && ({ ...e, body: b }))}
          onCancel={() => { setEditing(null); setError(null); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function QuestionEditor({
  body, isNew, busy, onChange, onCancel, onSave,
}: {
  body: QuestionUpsert; isNew: boolean; busy: boolean;
  onChange: (b: QuestionUpsert) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = (patch: Partial<QuestionUpsert>) => onChange({ ...body, ...patch });
  const showOptions = body.answer_type === "single" || body.answer_type === "multi";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[520px] max-w-full max-h-[88vh] overflow-y-auto p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white mb-4">{isNew ? "Add question" : "Edit question"}</h3>
        <div className="space-y-3">
          <Field label="Section">
            <input value={body.section} onChange={e => set({ section: e.target.value })} className={inputCls} placeholder="e.g. B. Knowledge Capture" />
          </Field>
          <Field label="Question text">
            <textarea value={body.question_text} onChange={e => set({ question_text: e.target.value })} rows={2} className={`${inputCls} resize-y`} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Answer type">
              <select value={body.answer_type} onChange={e => set({ answer_type: e.target.value as AnswerType })} className={inputCls}>
                {ALL_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Order">
              <input type="number" value={body.order_index ?? 0} onChange={e => set({ order_index: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          {showOptions && (
            <Field label="Options (one per line)">
              <textarea
                value={body.options.join("\n")}
                onChange={e => set({ options: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) })}
                rows={4}
                className={`${inputCls} resize-y font-mono text-[12px]`}
                placeholder={"Option A\nOption B\nOther"}
              />
            </Field>
          )}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[13px] text-gray-300">
              <input type="checkbox" checked={body.required} onChange={e => set({ required: e.target.checked })} className="accent-indigo-500" /> Required
            </label>
            <label className="flex items-center gap-2 text-[13px] text-gray-300">
              <input type="checkbox" checked={body.active} onChange={e => set({ active: e.target.checked })} className="accent-indigo-500" /> Active (shown to users)
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-[#2a2a38] hover:text-gray-200 transition">Cancel</button>
          <button onClick={onSave} disabled={busy} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-[13px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Report & data ─────────────────────────────────────────────────────────────

function ReportTab() {
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getSurveyReport().then(setReport).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function exportCsv() {
    setDownloading(true);
    try { await downloadSurveyCsv(); } catch { alert("Export failed."); }
    finally { setDownloading(false); }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading report…</p>;
  if (!report) return <p className="text-sm text-red-400">Failed to load report.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">{report.total_responses}</span>
          <span className="text-sm text-gray-500">response{report.total_responses !== 1 ? "s" : ""} collected</span>
        </div>
        <button onClick={exportCsv} disabled={downloading} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-40 transition flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>
          {downloading ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {report.total_responses === 0 && (
        <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl p-6 text-center text-sm text-gray-500">
          No responses yet. Results and graphs will appear here once participants complete the survey.
        </div>
      )}

      <div className="space-y-4">
        {report.questions.map(q => <QuestionReportCard key={q.question_key} q={q} />)}
      </div>
    </div>
  );
}

function QuestionReportCard({ q }: { q: QuestionReport }) {
  const isChart = q.answer_type === "likert" || q.answer_type === "single" || q.answer_type === "multi";
  const entries = Object.entries(q.distribution);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[13px] text-gray-200">{q.question_text}</p>
        <div className="flex items-center gap-2 shrink-0">
          {q.average != null && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">avg {q.average}</span>
          )}
          <span className="text-[11px] text-gray-600">{q.response_count} ans</span>
        </div>
      </div>

      {isChart && (
        <div className="space-y-1.5">
          {entries.map(([label, count]) => {
            const pct = Math.round((count / max) * 100);
            const showLabel = q.answer_type === "likert" ? `${label}` : label;
            return (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-40 shrink-0 truncate text-right">{showLabel}</span>
                <div className="flex-1 h-5 bg-[#1a1a24] rounded overflow-hidden">
                  <div className="h-full bg-indigo-500/70 rounded transition-all" style={{ width: `${count === 0 ? 0 : Math.max(pct, 4)}%` }} />
                </div>
                <span className="text-[11px] text-gray-400 w-7 shrink-0">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {!isChart && (
        <div>
          {q.text_answers.length === 0 ? (
            <p className="text-[12px] text-gray-600 italic">No answers yet.</p>
          ) : (
            <>
              <button onClick={() => setOpen(o => !o)} className="text-[11px] text-indigo-400 hover:text-indigo-300 transition mb-1.5">
                {open ? "Hide" : "Show"} {q.text_answers.length} free-text answer{q.text_answers.length !== 1 ? "s" : ""}
              </button>
              {open && (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {q.text_answers.map((t, i) => (
                    <p key={i} className="text-[12px] text-gray-400 bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-2.5 py-1.5">“{t}”</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
