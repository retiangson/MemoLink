import React, { useState } from "react";
import { startSession } from "../api/evaluationApi";
import type { EvalSession } from "../hooks/useEvaluation";

interface Props {
  show: boolean;
  onClose: () => void;
  workspaceId: number | null;
  onStarted: (s: EvalSession) => void;
}

const ROLES = ["Student", "Software developer / IT professional", "Office / admin worker", "Researcher", "Teacher / educator", "Other"];
const FREQ = ["Never", "Rarely", "Sometimes", "Often", "Very often"];

const CONSENT = "I understand that this evaluation records quantitative usage metrics such as completion time, response time, ratings, confidence level, and feature success/failure for academic evaluation. The analytics dataset will not store private note content, full prompts, full AI answers, uploaded files, or API keys.";

function detectMeta() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : "Unknown";
  const browser = /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Unknown";
  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? "mobile" : "desktop";
  return { os, browser, device };
}

export function EvaluationSessionModal({ show, onClose, workspaceId, onStarted }: Props) {
  const [consent, setConsent] = useState(false);
  const [role, setRole] = useState("");
  const [freq, setFreq] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!show) return null;

  async function start() {
    setBusy(true); setError(null);
    try {
      const meta = detectMeta();
      const s = await startSession({
        consent_confirmed: consent,
        role: role || undefined,
        ai_tool_usage_frequency: freq || undefined,
        device_type: meta.device, browser: meta.browser, operating_system: meta.os,
        workspace_id: workspaceId,
      });
      onStarted({ session_id: s.session_id, participant_code: s.participant_code });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Could not start the evaluation session.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-[560px] max-w-full max-h-[88vh] overflow-y-auto p-6 shadow-2xl text-white" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 mb-1">
          <svg className="w-5 h-5 text-cyan-400" fill="currentColor" viewBox="0 0 16 16"><path d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/></svg>
          <h2 className="font-semibold text-base">MemoLink Evaluation Session</h2>
        </div>
        <p className="text-xs text-gray-500 mb-4">Records quantitative performance metrics for academic assessment.</p>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Your role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-cyan-500">
              <option value="">Select…</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">AI tool usage frequency</label>
            <select value={freq} onChange={e => setFreq(e.target.value)} className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-[13px] text-gray-200 focus:outline-none focus:border-cyan-500">
              <option value="">Select…</option>
              {FREQ.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-3 bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3.5 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-cyan-500 w-4 h-4 shrink-0" />
            <span className="text-[12px] text-gray-300 leading-relaxed">{CONSENT}</span>
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-[var(--ml-bg-hover)] hover:text-gray-200 transition">Cancel</button>
          <button onClick={start} disabled={!consent || busy} className="px-4 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition">
            {busy ? "Starting…" : "Start Evaluation"}
          </button>
        </div>
      </div>
    </div>
  );
}
