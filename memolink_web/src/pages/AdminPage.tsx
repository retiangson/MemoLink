import React, { useState, useEffect, useCallback } from "react";
import {
  fetchAdminFeedback, updateFeedbackStatus, fetchAdminUsers, updateUserRole, updateUserLevel,
  fetchAdminFeatures, updateAdminFeatures, fetchSystemLogs, clearSystemLogs,
  type FeedbackItem, type AdminUser, type FeatureFlags, type AccessLevel, type SystemLogItem,
} from "../api/adminApi";
import { MODELS } from "../constants/models";
import { AdminSurveyPanel } from "../components/AdminSurveyPanel";
import { AdminEvaluationPanel } from "../components/AdminEvaluationPanel";
import { getEvaluationParticipants, setUserBudget, resetEvaluationBudget, type ParticipantBudget } from "../api/evaluationApi";

function fmtMMSS(s: number): string {
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type Tab = "feedback" | "features" | "users" | "logs" | "survey" | "evaluation";

const _LEVEL_ORDER: Record<string, number> = { regular: 0, plus: 1, pro: 2 };

const LEVEL_FEATURES: { minKey: keyof FeatureFlags; label: string }[] = [
  { minKey: "web_search_min_level",       label: "Web Search" },
  { minKey: "research_mode_min_level",    label: "Research Mode" },
  { minKey: "image_generation_min_level", label: "Image Generation" },
  { minKey: "model_selection_min_level",  label: "Model Selection" },
  { minKey: "translation_min_level",      label: "Translation" },
  { minKey: "file_upload_min_level",          label: "File Upload" },
  { minKey: "model_attribution_min_level",    label: "Model Attribution" },
  { minKey: "tts_min_level",                  label: "Text-to-Speech" },
  { minKey: "slash_commands_min_level",       label: "Slash Commands" },
  { minKey: "custom_api_keys_min_level",      label: "Custom API Keys" },
  { minKey: "video_import_min_level",         label: "Video Import" },
];

const TRANSLATE_LANGUAGES = [
  "English", "Māori", "Chinese", "Japanese", "Korean",
  "Spanish", "French", "German", "Portuguese", "Italian",
  "Russian", "Arabic", "Hindi", "Tagalog",
];

type FbStatus = "all" | "open" | "read" | "resolved";

interface Props {
  onClose: () => void;
  currentUserId: number;
  onResetWalkthrough?: () => void;
}

export function AdminPage({ onClose, currentUserId, onResetWalkthrough }: Props) {
  const [tab, setTab] = useState<Tab>("feedback");

  // Feedback state
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbTypeFilter, setFbTypeFilter] = useState("all");
  const [fbStatusFilter, setFbStatusFilter] = useState<FbStatus>("open");
  const [selectedFb, setSelectedFb] = useState<FeedbackItem | null>(null);
  const [openCount, setOpenCount] = useState(0);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [evalParts, setEvalParts] = useState<Record<number, ParticipantBudget>>({});
  const [evalDefaultMins, setEvalDefaultMins] = useState(30);
  const [budgetInput, setBudgetInput] = useState<Record<number, string>>({});
  const [levelChanging, setLevelChanging] = useState<Record<number, boolean>>({});

  // Logs state
  const [logs, setLogs] = useState<SystemLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsPages, setLogsPages] = useState(1);
  const [logsLevelFilter, setLogsLevelFilter] = useState("");
  const [logsSourceFilter, setLogsSourceFilter] = useState("");
  const [expandedLog, setExpandedLog] = useState<number | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Feature flags state
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagsSaved, setFlagsSaved] = useState(false);
  const [flagsError, setFlagsError] = useState<string | null>(null);
  const [levelTab, setLevelTab] = useState<AccessLevel>("regular");

  const loadLogs = useCallback(async (page = 1) => {
    setLogsLoading(true);
    try {
      const res = await fetchSystemLogs(logsLevelFilter || undefined, logsSourceFilter || undefined, page);
      setLogs(res.items);
      setLogsTotal(res.total);
      setLogsPage(res.page);
      setLogsPages(res.pages);
    } catch { /* ignore */ }
    finally { setLogsLoading(false); }
  }, [logsLevelFilter, logsSourceFilter]);

  useEffect(() => {
    if (tab === "feedback") loadFeedback();
    else if (tab === "users") loadUsers();
    else if (tab === "features") loadFlags();
    else if (tab === "logs") loadLogs(1);
  }, [tab]);

  useEffect(() => {
    if (tab === "feedback") loadFeedback();
  }, [fbTypeFilter, fbStatusFilter]);

  useEffect(() => {
    if (tab === "logs") loadLogs(1);
  }, [logsLevelFilter, logsSourceFilter]);

  async function loadFeedback() {
    setFbLoading(true);
    try {
      const [items, allOpen] = await Promise.all([
        fetchAdminFeedback(fbTypeFilter, fbStatusFilter),
        fetchAdminFeedback("all", "open"),
      ]);
      setFeedback(items);
      setOpenCount(allOpen.length);
    } catch { /* ignore */ }
    finally { setFbLoading(false); }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try { setUsers(await fetchAdminUsers()); }
    catch { /* ignore */ }
    finally { setUsersLoading(false); }
    loadEvalParticipants();
  }

  async function loadEvalParticipants() {
    try {
      const list = await getEvaluationParticipants();
      const map: Record<number, ParticipantBudget> = {};
      list.participants.forEach((p) => { map[p.user_id] = p; });
      setEvalParts(map);
      setEvalDefaultMins(list.default_budget_minutes);
    } catch { /* analytics may be unavailable */ }
  }

  async function applyUserBudget(userId: number) {
    const raw = (budgetInput[userId] ?? "").trim();
    const mins = raw === "" ? null : Math.max(1, parseInt(raw, 10) || 0);
    try { await setUserBudget(userId, mins); await loadEvalParticipants(); }
    catch { alert("Could not set budget."); }
  }

  async function resetUserBudget(userId: number) {
    try { await resetEvaluationBudget(userId, false); await loadEvalParticipants(); }
    catch { alert("Reset failed."); }
  }

  async function clearUserData(userId: number, email: string) {
    if (!confirm(`Permanently DELETE all evaluation data contributed by ${email} (metrics, ratings, tasks, timings) and restart their window?\n\nThis cannot be undone.`)) return;
    try { await resetEvaluationBudget(userId, true); await loadEvalParticipants(); }
    catch { alert("Clear failed."); }
  }

  async function loadFlags() {
    setFlagsLoading(true);
    try { setFlags(await fetchAdminFeatures()); }
    catch { /* ignore */ }
    finally { setFlagsLoading(false); }
  }

  async function handleStatusChange(id: number, status: string) {
    await updateFeedbackStatus(id, status);
    setFeedback((p) => p.map((f) => f.id === id ? { ...f, status: status as any } : f));
    setSelectedFb((prev) => prev?.id === id ? { ...prev, status: status as any } : prev);
    // Keep open count accurate
    setOpenCount((prev) => {
      const wasOpen = feedback.find((f) => f.id === id)?.status === "open";
      if (wasOpen && status !== "open") return Math.max(0, prev - 1);
      if (!wasOpen && status === "open") return prev + 1;
      return prev;
    });
  }

  async function handleRoleToggle(userId: number, makeAdmin: boolean) {
    await updateUserRole(userId, makeAdmin);
    setUsers((p) => p.map((u) => u.id === userId ? { ...u, is_admin: makeAdmin } : u));
  }

  async function handleLevelChange(userId: number, level: AccessLevel) {
    setLevelChanging((p) => ({ ...p, [userId]: true }));
    try {
      await updateUserLevel(userId, level);
      setUsers((p) => p.map((u) => u.id === userId ? { ...u, access_level: level } : u));
    } catch { /* ignore */ }
    finally { setLevelChanging((p) => ({ ...p, [userId]: false })); }
  }

  async function handleSaveFlags() {
    if (!flags) return;
    setFlagsSaved(false);
    setFlagsError(null);
    try {
      const updated = await updateAdminFeatures(flags);
      setFlags(updated);
      setFlagsSaved(true);
      setTimeout(() => setFlagsSaved(false), 2000);
    } catch {
      setFlagsError("Failed to save. Please try again.");
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    open: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    read: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    resolved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };

  const TYPE_COLORS: Record<string, string> = {
    bug: "bg-red-500/10 text-red-400 border-red-500/20",
    suggestion: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#0d0d12] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1e1e2a] shrink-0">
        <div className="flex items-center gap-3">
          <img src="/memolink-icon.png" alt="" className="h-7 w-7 rounded-md bg-white object-cover" />
          <span className="text-base font-semibold text-white">Admin Panel</span>
          <span className="text-xs text-gray-600">MemoLink</span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-[#1e1e2a] rounded-lg transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <nav className="w-52 shrink-0 border-r border-[#1e1e2a] flex flex-col py-4 px-3 gap-1">
          {([
            { key: "feedback", label: "Feedback", icon: <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/> },
            { key: "features", label: "Feature Flags", icon: <path d="M3 2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v13h1.5a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1H3V2zm1 13h1.5v-2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v2H10V2H4v13z"/> },
            { key: "users", label: "Users", icon: <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"/> },
          { key: "logs", label: "System Logs", icon: <><path d="M5 0h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2zm-1 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6v2.5a.5.5 0 0 1-.5.5h-2A.5.5 0 0 1 3 4.5V1.5A.5.5 0 0 1 3.5 1H4z"/><path d="M4.5 12.5A.5.5 0 0 1 5 12h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0-2A.5.5 0 0 1 5 10h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zm0-2A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5z"/></> },
            { key: "survey", label: "Evaluation Survey", icon: <><path d="M9.5 0a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5.5.5 0 0 1 .5.5V2a.5.5 0 0 1-.5.5h-5A.5.5 0 0 1 5 2v-.5a.5.5 0 0 1 .5-.5.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5z"/><path d="M3 2.5a.5.5 0 0 1 .5-.5H4a.5.5 0 0 0 0-1h-.5A1.5 1.5 0 0 0 2 2.5v12A1.5 1.5 0 0 0 3.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 12.5 1H12a.5.5 0 0 0 0 1h.5a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5z"/></> },
            { key: "evaluation", label: "Evaluation Analytics", icon: <path d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition ${
                tab === key
                  ? "bg-indigo-600/20 text-indigo-300 font-medium"
                  : "text-gray-500 hover:text-gray-200 hover:bg-[#1e1e2a]"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                {icon}
              </svg>
              {label}
              {key === "feedback" && openCount > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {openCount > 99 ? "99+" : openCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* EVALUATION SURVEY TAB */}
          {tab === "survey" && <AdminSurveyPanel />}

          {/* EVALUATION ANALYTICS TAB */}
          {tab === "evaluation" && <AdminEvaluationPanel />}

          {/* FEEDBACK TAB */}
          {tab === "feedback" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Bug Reports &amp; Suggestions</h2>
                <select
                  value={fbTypeFilter}
                  onChange={(e) => setFbTypeFilter(e.target.value)}
                  className="bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="all">All types</option>
                  <option value="bug">Bug Reports</option>
                  <option value="suggestion">Suggestions</option>
                </select>
              </div>

              {/* Status tab strip */}
              <div className="flex gap-1 mb-4 bg-[#12121a] p-1 rounded-xl border border-[#2a2a38] w-fit">
                {([
                  { key: "open",     label: "Open" },
                  { key: "read",     label: "Read" },
                  { key: "resolved", label: "Resolved" },
                  { key: "all",      label: "All" },
                ] as { key: FbStatus; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFbStatusFilter(key)}
                    className={`relative px-4 py-1.5 rounded-lg text-xs font-medium transition ${
                      fbStatusFilter === key
                        ? key === "open"
                          ? "bg-amber-500/20 text-amber-300"
                          : key === "read"
                            ? "bg-sky-500/20 text-sky-300"
                            : key === "resolved"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-[#2a2a38] text-gray-200"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {label}
                    {key === "open" && openCount > 0 && (
                      <span className="ml-1.5 px-1 min-w-[16px] h-4 inline-flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full leading-none">
                        {openCount > 99 ? "99+" : openCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {fbLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-600 text-sm">Loading…</div>
              ) : feedback.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-700 mb-3" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
                  </svg>
                  <p className="text-gray-600">No feedback found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {feedback.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedFb(item)}
                      className="bg-[#1a1a24] border border-[#2a2a38] rounded-xl overflow-hidden cursor-pointer hover:border-indigo-500/30 hover:bg-[#1e1e2e] transition group"
                    >
                      <div className="flex items-start gap-3 px-4 py-3">
                        <div className="flex flex-col gap-1.5 shrink-0 mt-0.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${TYPE_COLORS[item.type] ?? "bg-gray-500/10 text-gray-400"}`}>
                            {item.type === "bug" ? "Bug" : "Suggestion"}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize ${STATUS_COLORS[item.status] ?? ""}`}>
                            {item.status}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs text-gray-500 truncate">{item.user_email ?? `User #${item.user_id}`}</span>
                            <span className="text-[10px] text-gray-700">·</span>
                            <span className="text-[10px] text-gray-700 shrink-0">{item.created_at.slice(0, 10)}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-200 truncate">{item.title}</p>
                          <p className="text-xs text-gray-500 leading-relaxed line-clamp-1 mt-0.5">
                            {item.message}
                          </p>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-700 group-hover:text-indigo-400 shrink-0 mt-1 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Feedback detail modal */}
              {selectedFb && (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                  onClick={() => setSelectedFb(null)}
                >
                  <div
                    className="bg-[#13131c] border border-[#2a2a38] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Modal header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a38]">
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border shrink-0 ${TYPE_COLORS[selectedFb.type] ?? "bg-gray-500/10 text-gray-400"}`}>
                            {selectedFb.type === "bug" ? "Bug Report" : "Suggestion"}
                          </span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border capitalize shrink-0 ${STATUS_COLORS[selectedFb.status] ?? ""}`}>
                            {selectedFb.status}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-white truncate">{selectedFb.title}</p>
                      </div>
                      <button
                        onClick={() => setSelectedFb(null)}
                        className="text-gray-600 hover:text-white transition p-1 rounded-lg hover:bg-[#1e1e2a]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Meta */}
                    <div className="px-5 py-3 border-b border-[#1e1e2a] flex items-center gap-3 text-xs text-gray-500">
                      <span>{selectedFb.user_email ?? `User #${selectedFb.user_id}`}</span>
                      <span className="text-gray-700">·</span>
                      <span>{new Date(selectedFb.created_at).toLocaleString()}</span>
                      <span className="text-gray-700">·</span>
                      <span className="text-gray-600">#{selectedFb.id}</span>
                    </div>

                    {/* Full description */}
                    <div className="px-5 py-4 overflow-y-auto max-h-72">
                      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Description</p>
                      <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{selectedFb.message}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#2a2a38]">
                      {selectedFb.status !== "open" && (
                        <button
                          onClick={() => handleStatusChange(selectedFb.id, "open")}
                          className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-[#252533] rounded-lg border border-[#2a2a38] transition"
                        >Reopen</button>
                      )}
                      {selectedFb.status === "open" && (
                        <button
                          onClick={() => handleStatusChange(selectedFb.id, "read")}
                          className="px-3 py-1.5 text-xs font-medium text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 transition"
                        >Mark Read</button>
                      )}
                      {selectedFb.status !== "resolved" && (
                        <button
                          onClick={() => handleStatusChange(selectedFb.id, "resolved")}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 transition"
                        >Mark Resolved</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* FEATURES TAB */}
          {tab === "features" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-white">Feature Flags</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Control which features are available to all users</p>
                </div>
                <button
                  onClick={handleSaveFlags}
                  disabled={!flags || flagsLoading}
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition"
                >
                  {flagsSaved ? "Saved ✓" : "Save Changes"}
                </button>
              </div>

              {flagsError && <p className="text-sm text-red-400 mb-4">{flagsError}</p>}

              {flagsLoading || !flags ? (
                <div className="flex items-center justify-center py-12 text-gray-600 text-sm">Loading…</div>
              ) : (
                <>
                <div className="space-y-3">
                  {([
                    { key: "web_search_enabled", label: "Web Search", desc: "Allow users to enable web search in chat" },
                    { key: "research_mode_enabled", label: "Research Mode", desc: "Allow users to run deep multi-source research analysis" },
                    { key: "model_attribution_enabled", label: "Model Attribution", desc: "Show 'replied by [model]' label on each AI message" },
                    { key: "model_selection_enabled", label: "Model Selection", desc: "Allow users to choose the AI model" },
                    { key: "image_generation_enabled", label: "Image Generation", desc: "Allow AI image generation in chat" },
                    { key: "translation_enabled", label: "Translation", desc: "Show the translate button on chat messages" },
                    { key: "file_upload_enabled", label: "File Upload", desc: "Allow users to attach files to chat" },
                    { key: "tts_enabled", label: "Text-to-Speech", desc: "Allow users to read notes and chat aloud with TTS" },
                    { key: "slash_commands_enabled", label: "Slash Commands", desc: "Show the / command autocomplete picker in chat" },
                    { key: "custom_api_keys_enabled", label: "Custom API Keys", desc: "Allow users to add their own AI provider API keys" },
                    { key: "video_import_enabled", label: "Video Import", desc: "Allow importing note content from a video URL" },
                    { key: "email_enabled", label: "Email Integration", desc: "Allow users to connect Gmail and sync emails as reminders" },
                    { key: "memograph_enabled", label: "AI Memory Graph", desc: "Show the MemoGraph button to visualize entity relationships across notes" },
                    { key: "proactive_insights_enabled", label: "Proactive Insights", desc: "Enable AI scanning of notes for missed deadlines, action items, and urgency signals" },
                    { key: "confidence_enabled", label: "Answer Confidence", desc: "Show HIGH / MEDIUM / LOW confidence badge on each AI response" },
                    { key: "autopilot_enabled", label: "AutoPilot Routing", desc: "Automatically select the best AI model based on the user's intent" },
                    { key: "study_mode_enabled", label: "Study Mode", desc: "Enable AI Study Mode - flashcards, exam review, study plans, weak topic detection, and summaries" },
                    { key: "timeline_enabled", label: "Meeting/Lecture Timeline", desc: "Show Timeline tab in note editor - chapters, action items, and important moments with timestamps" },
                    { key: "workflow_enabled", label: "Workflow Agent", desc: "Enable Workflow mode - AI proposes actions for user approval before executing" },
                    { key: "evaluation_survey_enabled", label: "Evaluation Survey", desc: "Show \"Take Evaluation Survey\" in the profile menu - research data collection, separate from feedback" },
                    { key: "evaluation_analytics_enabled", label: "Evaluation Analytics", desc: "Collect quantitative evaluation telemetry (session/task timings, AI metrics, ratings). Disabling stops all collection" },
                    { key: "evaluation_admin_export_enabled", label: "Evaluation Export", desc: "Allow admins to export evaluation analytics as CSV/JSON" },
                  ] as { key: keyof FeatureFlags; label: string; desc: string }[]).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between px-4 py-3.5 bg-[#1a1a24] border border-[#2a2a38] rounded-xl">
                      <div>
                        <p className="text-sm font-medium text-gray-200">{label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                      </div>
                      <button
                        onClick={() => setFlags((f) => f ? { ...f, [key]: !f[key as keyof FeatureFlags] } : f)}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                          flags[key] ? "bg-indigo-600" : "bg-[#252533]"
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          flags[key] ? "translate-x-5" : "translate-x-0"
                        }`} />
                      </button>
                    </div>
                  ))}

                  {/* Default model dropdown */}
                  <div className="flex items-center justify-between px-4 py-3.5 bg-[#1a1a24] border border-[#2a2a38] rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-200">Default Model</p>
                      <p className="text-xs text-gray-500 mt-0.5">The model used when model selection is disabled, or as the default</p>
                    </div>
                    <select
                      value={flags.default_model}
                      onChange={(e) => setFlags((f) => f ? { ...f, default_model: e.target.value } : f)}
                      className="bg-[#12121a] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 max-w-[200px]"
                    >
                      {MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Default language dropdown */}
                  <div className="flex items-center justify-between px-4 py-3.5 bg-[#1a1a24] border border-[#2a2a38] rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-200">Default Translation Language</p>
                      <p className="text-xs text-gray-500 mt-0.5">Pre-selected language in the translate picker</p>
                    </div>
                    <select
                      value={flags.default_language}
                      onChange={(e) => setFlags((f) => f ? { ...f, default_language: e.target.value } : f)}
                      className="bg-[#12121a] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
                    >
                      {TRANSLATE_LANGUAGES.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Access Level Requirements - tabbed */}
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">Access Level Requirements</h3>
                  <p className="text-xs text-gray-500 mb-4">Configure which features each tier can access. Pro always inherits everything enabled for Plus and Regular.</p>

                  {/* Level tab bar */}
                  <div className="flex gap-1 mb-4 bg-[#12121a] p-1 rounded-xl w-fit border border-[#2a2a38]">
                    {(["regular", "plus", "pro"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setLevelTab(lvl)}
                        className={`px-5 py-1.5 rounded-lg text-xs font-medium transition capitalize ${
                          levelTab === lvl
                            ? lvl === "pro"
                              ? "bg-purple-600 text-white"
                              : lvl === "plus"
                                ? "bg-sky-600 text-white"
                                : "bg-indigo-600 text-white"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                      </button>
                    ))}
                  </div>

                  {levelTab === "pro" ? (
                    <div className="flex items-center gap-2 px-4 py-3 bg-purple-500/5 border border-purple-500/20 rounded-xl text-xs text-purple-300">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                        <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                      </svg>
                      Pro tier always has access to all features enabled for Regular and Plus. Use the global toggles above to disable a feature for everyone.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {LEVEL_FEATURES.map(({ minKey, label }) => {
                        const minLevel = (flags[minKey] as string) ?? "regular";
                        const isOn = _LEVEL_ORDER[levelTab] >= _LEVEL_ORDER[minLevel];
                        return (
                          <div key={minKey} className="flex items-center justify-between px-4 py-3 bg-[#1a1a24] border border-[#2a2a38] rounded-xl">
                            <div>
                              <p className="text-sm text-gray-300">{label}</p>
                              {!isOn && (
                                <p className="text-[10px] text-gray-600 mt-0.5">
                                  Requires {minLevel} or higher
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                const nextMinLevel = isOn
                                  ? (levelTab === "regular" ? "plus" : "pro")
                                  : levelTab;
                                setFlags((f) => f ? { ...f, [minKey]: nextMinLevel } : f);
                              }}
                              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${isOn ? "bg-indigo-600" : "bg-[#252533]"}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOn ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                </>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {tab === "users" && (
            <div>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Users</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{users.length} registered user{users.length !== 1 ? "s" : ""}</p>
                </div>
                {onResetWalkthrough && (
                  <button
                    onClick={() => { onResetWalkthrough(); onClose(); }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border border-indigo-500/20 transition shrink-0"
                    title="Clears your walkthrough flag and replays the tour"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/>
                      <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/>
                    </svg>
                    Reset Walkthrough (Me)
                  </button>
                )}
              </div>
              {usersLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-600 text-sm">Loading…</div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => (
                    <div key={u.id} className="px-4 py-3 bg-[#1a1a24] border border-[#2a2a38] rounded-xl">
                      <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center text-indigo-300 text-xs font-bold shrink-0">
                        {u.email.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{u.email}</p>
                        <p className="text-[10px] text-gray-600">User #{u.id}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Access level badge */}
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-md border ${
                          u.access_level === "pro"
                            ? "text-purple-300 bg-purple-500/10 border-purple-500/20"
                            : u.access_level === "plus"
                              ? "text-sky-300 bg-sky-500/10 border-sky-500/20"
                              : "text-gray-400 bg-gray-500/10 border-gray-500/20"
                        }`}>
                          {u.access_level === "pro" ? "Pro" : u.access_level === "plus" ? "Plus" : "Regular"}
                        </span>

                        {u.is_admin && (
                          <span className="px-2 py-0.5 text-[10px] font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-md">
                            Admin
                          </span>
                        )}

                        {u.id !== currentUserId ? (
                          <>
                            <select
                              value={u.access_level}
                              disabled={levelChanging[u.id]}
                              onChange={(e) => handleLevelChange(u.id, e.target.value as AccessLevel)}
                              className="bg-[#12121a] border border-[#2a2a38] rounded-lg px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                            >
                              <option value="regular">Regular</option>
                              <option value="plus">Plus</option>
                              <option value="pro">Pro</option>
                            </select>
                            <button
                              onClick={() => handleRoleToggle(u.id, !u.is_admin)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition ${
                                u.is_admin
                                  ? "text-red-400 bg-red-500/10 border-red-500/20 hover:bg-red-500/20"
                                  : "text-indigo-400 bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/20"
                              }`}
                            >
                              {u.is_admin ? "Remove Admin" : "Make Admin"}
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-600">You</span>
                        )}
                      </div>
                      </div>

                      {/* Evaluation collection window (per-user) */}
                      {(() => {
                        const p = evalParts[u.id];
                        const pct = p ? Math.min(100, Math.round((p.consumed_seconds / Math.max(1, p.budget_seconds)) * 100)) : 0;
                        return (
                          <div className="mt-2.5 pt-2.5 border-t border-[#2a2a38] flex items-center gap-3 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wider text-cyan-400/70 shrink-0">Evaluation</span>
                            {p ? (
                              <>
                                <span className="text-[11px] text-gray-400">
                                  Consumed <span className="text-gray-200 font-mono">{fmtMMSS(p.consumed_seconds)}</span> / {fmtMMSS(p.budget_seconds)}
                                  {p.exhausted && <span className="ml-1.5 text-amber-400">· window ended</span>}
                                </span>
                                <div className="w-24 h-1.5 bg-[#12121a] rounded overflow-hidden">
                                  <div className={`h-full ${p.exhausted ? "bg-amber-500" : "bg-cyan-500/70"}`} style={{ width: `${pct}%` }} />
                                </div>
                              </>
                            ) : (
                              <span className="text-[11px] text-gray-600">No data yet · default {evalDefaultMins} min</span>
                            )}
                            <div className="flex items-center gap-1 ml-auto shrink-0">
                              <input
                                type="number" min={1}
                                value={budgetInput[u.id] ?? ""}
                                onChange={(e) => setBudgetInput((b) => ({ ...b, [u.id]: e.target.value }))}
                                placeholder={String(p?.budget_seconds ? Math.round(p.budget_seconds / 60) : evalDefaultMins)}
                                className="w-14 bg-[#12121a] border border-[#2a2a38] rounded-lg px-2 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-cyan-500/50"
                              />
                              <span className="text-[10px] text-gray-600">min</span>
                              <button onClick={() => applyUserBudget(u.id)} className="px-2 py-1 text-[11px] rounded-lg text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 transition">Set</button>
                              <button onClick={() => resetUserBudget(u.id)} title="Reset the timer only - keeps collected data" className="px-2 py-1 text-[11px] rounded-lg text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 transition">Reset</button>
                              <button onClick={() => clearUserData(u.id, u.email)} title="Delete all this participant's evaluation data and restart" className="px-2 py-1 text-[11px] rounded-lg text-red-400 border border-red-500/30 hover:bg-red-500/10 transition">Clear data</button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LOGS TAB */}
          {tab === "logs" && (() => {
            const LEVEL_STYLES: Record<string, string> = {
              INFO:    "bg-sky-500/10 text-sky-400 border-sky-500/20",
              WARNING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
              ERROR:   "bg-red-500/10 text-red-400 border-red-500/20",
            };

            async function handleClear() {
              if (!confirm("Delete all system logs? This cannot be undone.")) return;
              setClearingLogs(true);
              try {
                await clearSystemLogs();
                setLogs([]);
                setLogsTotal(0);
                setLogsPage(1);
                setLogsPages(1);
              } catch { /* ignore */ }
              finally { setClearingLogs(false); }
            }

            return (
              <div>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">System Logs</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{logsTotal} entr{logsTotal === 1 ? "y" : "ies"} total</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => loadLogs(logsPage)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#1e1e2a] border border-[#2a2a38] rounded-lg transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                    <button
                      onClick={handleClear}
                      disabled={clearingLogs || logsTotal === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 rounded-lg disabled:opacity-40 transition"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 mb-4">
                  <select
                    value={logsLevelFilter}
                    onChange={(e) => setLogsLevelFilter(e.target.value)}
                    className="bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
                  >
                    <option value="">All levels</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                  <input
                    type="text"
                    value={logsSourceFilter}
                    onChange={(e) => setLogsSourceFilter(e.target.value)}
                    placeholder="Filter by source…"
                    className="bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 w-44"
                  />
                </div>

                {/* Log list */}
                {logsLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-600 text-sm">Loading…</div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-700 mb-3" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M5 0h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2zm-1 1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6v2.5a.5.5 0 0 1-.5.5h-2A.5.5 0 0 1 3 4.5V1.5A.5.5 0 0 1 3.5 1H4z"/>
                    </svg>
                    <p className="text-gray-600">No logs found</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 font-mono text-xs">
                    {logs.map((entry) => (
                      <div
                        key={entry.id}
                        className="bg-[#1a1a24] border border-[#2a2a38] rounded-xl overflow-hidden"
                      >
                        <button
                          className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-[#1e1e2e] transition"
                          onClick={() => setExpandedLog(expandedLog === entry.id ? null : entry.id)}
                        >
                          <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border ${LEVEL_STYLES[entry.level] ?? "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}>
                            {entry.level}
                          </span>
                          <span className="text-gray-600 shrink-0 mt-0.5 text-[10px]">
                            {new Date(entry.created_at).toLocaleString()}
                          </span>
                          <span className="text-indigo-400/70 shrink-0 mt-0.5">[{entry.source}]</span>
                          <span className="text-gray-300 flex-1 min-w-0 truncate">{entry.message}</span>
                          {entry.details && (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className={`w-3 h-3 text-gray-600 shrink-0 mt-0.5 transition-transform ${expandedLog === entry.id ? "rotate-180" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>
                        {expandedLog === entry.id && entry.details && (
                          <div className="px-4 py-2.5 border-t border-[#252533] bg-[#12121a]">
                            <pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-all leading-relaxed">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                            {entry.user_id && (
                              <p className="text-[10px] text-gray-600 mt-1.5">User #{entry.user_id}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {logsPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <button
                      disabled={logsPage <= 1}
                      onClick={() => loadLogs(logsPage - 1)}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[#2a2a38] rounded-lg disabled:opacity-30 transition"
                    >← Prev</button>
                    <span className="text-xs text-gray-600">Page {logsPage} of {logsPages}</span>
                    <button
                      disabled={logsPage >= logsPages}
                      onClick={() => loadLogs(logsPage + 1)}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[#2a2a38] rounded-lg disabled:opacity-30 transition"
                    >Next →</button>
                  </div>
                )}
              </div>
            );
          })()}

        </main>
      </div>
    </div>
  );
}
