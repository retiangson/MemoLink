import React, { useState, useEffect } from "react";
import { changePassword } from "../api/client";
import { getProviders, addProvider, updateProvider, deleteProvider } from "../api/settingsApi";
import type { CustomProvider } from "../api/settingsApi";
import { getEmailStatus, getEmailConnectUrl, disconnectEmail, autoProcessEmails, listEmails, deleteEmail, emailToNote, emailToReminder } from "../api/emailApi";
import type { EmailStatus, EmailRecord, AutoProcessResult } from "../api/emailApi";
import { EmailReplyPanel } from "./EmailReplyPanel";
import { MODELS } from "../constants/models";
import type { User } from "../utils/auth";

interface SettingsModalProps {
  show: boolean;
  user: User;
  onClose: () => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  modelSelectionEnabled?: boolean;
  customApiKeysEnabled?: boolean;
  ttsEnabled?: boolean;
  emailEnabled?: boolean;
  workflowEnabled?: boolean;
}

type Tab = "profile" | "security" | "ai" | "keys" | "tts" | "email" | "workflow";

const BLANK_FORM = { name: "", key: "", model: "", base_url: "" };

export function SettingsModal({
  show,
  user,
  onClose,
  selectedModel,
  onModelChange,
  modelSelectionEnabled = true,
  customApiKeysEnabled = true,
  ttsEnabled = true,
  emailEnabled = true,
  workflowEnabled = true,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("profile");

  // Security tab
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  // Custom providers
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(BLANK_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);

  // Workflow user preference (localStorage-backed, must be declared here with all other hooks)
  const [wfSuggestions, setWfSuggestions] = useState(
    () => localStorage.getItem("memolink_workflow_suggestions") !== "false"
  );
  function toggleWfSuggestions(val: boolean) {
    setWfSuggestions(val);
    localStorage.setItem("memolink_workflow_suggestions", String(val));
  }

  // Email connection state
  const [emailStatus, setEmailStatus] = useState<EmailStatus>({ connected: false, email: null });
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailConnecting, setEmailConnecting] = useState(false);
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoProcessResult | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [actionLoading, setActionLoading] = useState<"note" | "reminder" | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    if (show) { loadProviders(); loadEmailStatus(); }
  }, [show]);

  async function loadEmailStatus() {
    try {
      const status = await getEmailStatus();
      setEmailStatus(status);
      if (status.connected) runAutoProcess();
    } catch { /* silently fail */ }
  }

  async function runAutoProcess() {
    setSyncing(true); setAutoResult(null);
    try {
      const result = await autoProcessEmails();
      setAutoResult(result);
      await loadEmails();
    } catch { /* silently fail */ } finally { setSyncing(false); }
  }

  async function loadEmails() {
    setEmailsLoading(true);
    try { setEmails(await listEmails()); } catch { /* silently fail */ } finally { setEmailsLoading(false); }
  }

  async function handleDeleteEmail(id: number) {
    try {
      await deleteEmail(id);
      setEmails(prev => prev.filter(e => e.id !== id));
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch { /* silently fail */ }
  }

  async function handleEmailToNote(id: number) {
    setActionLoading("note"); setActionResult(null);
    try {
      const res = await emailToNote(id);
      setActionResult(`✓ Saved as note: "${res.title}"`);
    } catch { setActionResult("Failed to save note."); }
    finally { setActionLoading(null); }
  }

  async function handleEmailToReminder(id: number) {
    setActionLoading("reminder"); setActionResult(null);
    try {
      const res = await emailToReminder(id);
      const due = res.due_date ? ` - due ${res.due_date}${res.due_time ? " " + res.due_time : ""}` : "";
      setActionResult(`✓ Reminder added: "${res.text}"${due}`);
    } catch { setActionResult("Failed to add reminder."); }
    finally { setActionLoading(null); }
  }


  async function handleConnectEmail() {
    setEmailConnecting(true);
    try {
      const url = await getEmailConnectUrl();
      window.location.href = url;
    } catch {
      setEmailConnecting(false);
    }
  }

  async function handleDisconnectEmail() {
    setEmailLoading(true);
    try {
      await disconnectEmail();
      setEmailStatus({ connected: false, email: null });
    } catch { /* silently fail */ } finally {
      setEmailLoading(false);
    }
  }

  // TTS settings - local voice list + saved preferences
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceName, setTtsVoiceNameState] = useState<string>(() => localStorage.getItem("memolink_tts_voice") ?? "");
  const [ttsRate, setTtsRateState] = useState<number>(() => parseFloat(localStorage.getItem("memolink_tts_rate") ?? "1.0"));
  const [ttsSearch, setTtsSearch] = useState("");

  useEffect(() => {
    function loadVoices() {
      const v = window.speechSynthesis?.getVoices() ?? [];
      if (v.length > 0) setTtsVoices(v);
    }
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  function saveTtsVoice(name: string) {
    setTtsVoiceNameState(name);
    if (name) localStorage.setItem("memolink_tts_voice", name);
    else localStorage.removeItem("memolink_tts_voice");
    // Dispatch storage event so useTTS picks it up if open in another hook instance
    window.dispatchEvent(new Event("memolink_tts_changed"));
  }

  function saveTtsRate(r: number) {
    setTtsRateState(r);
    localStorage.setItem("memolink_tts_rate", String(r));
    window.dispatchEvent(new Event("memolink_tts_changed"));
  }

  async function loadProviders() {
    setProvidersLoading(true);
    try {
      setProviders(await getProviders());
    } catch {
      // silently fail
    } finally {
      setProvidersLoading(false);
    }
  }

  if (!show) return null;

  function resetPw() {
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setPwError(null); setPwSuccess(false);
  }

  function handleClose() {
    resetPw();
    setShowAddForm(false);
    setEditingId(null);
    onClose();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null); setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError("New passwords do not match."); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess(true); resetPw();
    } catch (err: any) {
      setPwError(err?.response?.data?.detail ?? "Failed to change password.");
    } finally {
      setPwLoading(false);
    }
  }

  async function handleAddProvider(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      await addProvider({
        name: addForm.name.trim(),
        key: addForm.key.trim(),
        model: addForm.model.trim(),
        base_url: addForm.base_url.trim() || undefined,
      });
      setAddForm(BLANK_FORM);
      setShowAddForm(false);
      await loadProviders();
    } catch (err: any) {
      setAddError(err?.response?.data?.detail ?? "Failed to add provider.");
    } finally {
      setAddLoading(false);
    }
  }

  function startEdit(p: CustomProvider) {
    setEditingId(p.id);
    setEditForm({ name: p.name, key: "", model: p.model, base_url: p.base_url ?? "" });
    setEditError(null);
  }

  async function handleUpdateProvider(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    setEditError(null);
    setEditLoading(true);
    try {
      await updateProvider(editingId, {
        name: editForm.name.trim() || undefined,
        key: editForm.key.trim() || undefined,
        model: editForm.model.trim() || undefined,
        base_url: editForm.base_url.trim(),
      });
      setEditingId(null);
      await loadProviders();
    } catch (err: any) {
      setEditError(err?.response?.data?.detail ?? "Failed to update provider.");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDeleteProvider(id: number) {
    setDeleteLoadingId(id);
    try {
      await deleteProvider(id);
      if (providers.find((p) => p.id === id)?.model === selectedModel) {
        onModelChange("gpt-4o-mini");
      }
      await loadProviders();
    } catch {
      // silently fail
    } finally {
      setDeleteLoadingId(null);
    }
  }

  const initials = user.email.slice(0, 2).toUpperCase();

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile",  label: "Profile" },
    { id: "security", label: "Security" },
    ...(modelSelectionEnabled ? [{ id: "ai" as Tab, label: "AI Model" }] : []),
    ...(customApiKeysEnabled ? [{ id: "keys" as Tab, label: "API Keys" }] : []),
    ...(ttsEnabled ? [{ id: "tts" as Tab, label: "Text-to-Speech" }] : []),
    ...(emailEnabled ? [{ id: "email" as Tab, label: "Email" }] : []),
    ...(workflowEnabled ? [{ id: "workflow" as Tab, label: "Workflow" }] : []),
  ];

  const inputCls = "w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition";
  const btnPrimary = "px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-medium transition whitespace-nowrap";
  const btnGhost = "px-3 py-2 text-gray-400 hover:text-gray-200 hover:bg-[#2a2a38] rounded-xl text-sm font-medium transition whitespace-nowrap";
  const btnDanger = "px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-50 rounded-xl text-sm font-medium transition whitespace-nowrap border border-red-500/20";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[700px] shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38]">
          <h2 className="font-semibold text-base">Settings</h2>
          <button onClick={handleClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#2a2a38] transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <div className="w-36 border-r border-[#2a2a38] py-3 shrink-0">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full text-left px-4 py-2 text-sm transition ${
                  tab === id ? "text-indigo-400 bg-indigo-500/10 font-medium" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a38]"
                }`}
              >
                {label}
                {id === "keys" && providers.length > 0 && (
                  <span className="ml-1.5 text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded-full">
                    {providers.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto max-h-[560px]">

            {/* ── Profile ── */}
            {tab === "profile" && (
              <div className="space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-lg font-bold">{initials}</div>
                  <div>
                    <p className="text-sm font-medium">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-0.5">MemoLink account</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Email</label>
                  <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-300">{user.email}</div>
                  <p className="text-xs text-gray-600 mt-1.5">Email cannot be changed.</p>
                </div>
              </div>
            )}

            {/* ── Security ── */}
            {tab === "security" && (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <p className="text-sm text-gray-400 mb-2">Change your account password.</p>
                {pwError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl px-3 py-2">{pwError}</div>}
                {pwSuccess && <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-xs rounded-xl px-3 py-2">Password changed successfully.</div>}
                {[
                  { label: "Current Password", value: currentPw, setter: setCurrentPw },
                  { label: "New Password", value: newPw, setter: setNewPw },
                  { label: "Confirm New Password", value: confirmPw, setter: setConfirmPw },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">{label}</label>
                    <input type="password" value={value} onChange={(e) => setter(e.target.value)} required className={inputCls} />
                  </div>
                ))}
                <button type="submit" disabled={pwLoading} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 rounded-xl text-sm font-medium transition">
                  {pwLoading ? "Saving…" : "Change Password"}
                </button>
              </form>
            )}

            {/* ── AI Model ── */}
            {tab === "ai" && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">Choose the model that powers your chat.</p>

                {/* Built-in models */}
                <div className="flex gap-3 items-start">
                  {(["openai", "gemini", "deepseek"] as const).map((provider) => (
                    <div key={provider} className="flex-1 space-y-1.5">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                        {provider === "openai" ? "OpenAI" : provider === "gemini" ? "Google Gemini" : "DeepSeek"}
                      </p>
                      {MODELS.filter((m) => m.provider === provider).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onModelChange(m.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left transition ${
                            selectedModel === m.id
                              ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                              : "border-[#2a2a38] bg-[#12121a] text-gray-300 hover:border-[#3a3a4a] hover:text-white"
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium leading-snug">{m.label}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{m.description}</p>
                          </div>
                          {selectedModel === m.id && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Custom providers */}
                {providers.length > 0 && (
                  <div>
                    <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Your Custom Providers</p>
                    <div className="space-y-1.5">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onModelChange(p.model)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-left transition ${
                            selectedModel === p.model
                              ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                              : "border-[#2a2a38] bg-[#12121a] text-gray-300 hover:border-[#3a3a4a] hover:text-white"
                          }`}
                        >
                          <div>
                            <p className="text-sm font-medium leading-snug">{p.name}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{p.model}{p.base_url ? ` · ${p.base_url}` : ""}</p>
                          </div>
                          {selectedModel === p.model && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {providers.length === 0 && (
                  <p className="text-xs text-gray-600">
                    Add your own providers (Groq, Mistral, Ollama, etc.) in the <button onClick={() => setTab("keys")} className="text-indigo-400 hover:underline">API Keys</button> tab.
                  </p>
                )}
              </div>
            )}

            {/* ── API Keys ── */}
            {tab === "keys" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-200">Custom AI Providers</p>
                    <p className="text-xs text-gray-500 mt-0.5">Any OpenAI-compatible API - Groq, Mistral, Ollama, Together, Perplexity, etc.</p>
                  </div>
                  {!showAddForm && (
                    <button onClick={() => { setShowAddForm(true); setAddForm(BLANK_FORM); setAddError(null); }} className={btnPrimary}>
                      + Add Provider
                    </button>
                  )}
                </div>

                {providersLoading && <p className="text-xs text-gray-500">Loading…</p>}

                {/* Add form */}
                {showAddForm && (
                  <form onSubmit={handleAddProvider} className="bg-[#12121a] border border-[#2a2a38] rounded-xl p-4 space-y-3">
                    <p className="text-xs font-medium text-gray-300 uppercase tracking-wider">New Provider</p>
                    {addError && <p className="text-xs text-red-400">{addError}</p>}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Provider Name *</label>
                        <input placeholder="e.g. Groq, My Ollama" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} required className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Model ID *</label>
                        <input placeholder="e.g. llama3-8b-8192" value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} required className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Base URL <span className="text-gray-600">(optional - leave blank for OpenAI default)</span></label>
                      <input placeholder="https://api.groq.com/openai/v1" value={addForm.base_url} onChange={(e) => setAddForm((f) => ({ ...f, base_url: e.target.value }))} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">API Key *</label>
                      <input type="password" placeholder="sk-…" value={addForm.key} onChange={(e) => setAddForm((f) => ({ ...f, key: e.target.value }))} required className={inputCls} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="submit" disabled={addLoading} className={btnPrimary}>{addLoading ? "Saving…" : "Save Provider"}</button>
                      <button type="button" onClick={() => { setShowAddForm(false); setAddError(null); }} className={btnGhost}>Cancel</button>
                    </div>
                  </form>
                )}

                {/* Provider list */}
                {providers.length === 0 && !showAddForm && !providersLoading && (
                  <div className="bg-[#12121a] border border-dashed border-[#2a2a38] rounded-xl px-4 py-6 text-center">
                    <p className="text-sm text-gray-500">No custom providers yet.</p>
                    <p className="text-xs text-gray-600 mt-1">Add any OpenAI-compatible API - Groq, Mistral, Ollama, Together, and more.</p>
                  </div>
                )}

                <div className="space-y-2">
                  {providers.map((p) => (
                    <div key={p.id} className="bg-[#12121a] border border-[#2a2a38] rounded-xl overflow-hidden">
                      {editingId === p.id ? (
                        <form onSubmit={handleUpdateProvider} className="p-4 space-y-3">
                          <p className="text-xs font-medium text-gray-300 uppercase tracking-wider">Edit Provider</p>
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Provider Name</label>
                              <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
                            </div>
                            <div>
                              <label className="block text-[11px] text-gray-500 mb-1">Model ID</label>
                              <input value={editForm.model} onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))} className={inputCls} />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500 mb-1">Base URL</label>
                            <input placeholder="Leave blank to clear" value={editForm.base_url} onChange={(e) => setEditForm((f) => ({ ...f, base_url: e.target.value }))} className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-500 mb-1">New API Key <span className="text-gray-600">(leave blank to keep existing)</span></label>
                            <input type="password" placeholder="sk-…" value={editForm.key} onChange={(e) => setEditForm((f) => ({ ...f, key: e.target.value }))} className={inputCls} />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button type="submit" disabled={editLoading} className={btnPrimary}>{editLoading ? "Saving…" : "Save Changes"}</button>
                            <button type="button" onClick={() => { setEditingId(null); setEditError(null); }} className={btnGhost}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-200">{p.name}</span>
                              {selectedModel === p.model && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 font-medium">Active</span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                              {p.model}
                              {p.base_url && <span className="text-gray-600"> · {p.base_url}</span>}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0 ml-3">
                            <button onClick={() => startEdit(p)} className={btnGhost}>Edit</button>
                            <button
                              onClick={() => handleDeleteProvider(p.id)}
                              disabled={deleteLoadingId === p.id}
                              className={btnDanger}
                            >
                              {deleteLoadingId === p.id ? "…" : "Remove"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Text-to-Speech ── */}
            {tab === "tts" && (
              <div className="space-y-5">
                <p className="text-sm text-gray-400">Configure the voice used when reading notes and chat messages aloud. Changes apply to the next reading. Uses your browser's built-in speech engine - <span className="text-gray-300">no API key or internet connection required</span>.</p>

                {/* Speed */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">Default Speed</label>
                  <div className="flex gap-2 flex-wrap">
                    {[0.75, 1.0, 1.25, 1.5, 2.0].map(r => (
                      <button
                        key={r}
                        onClick={() => saveTtsRate(r)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                          ttsRate === r
                            ? "bg-indigo-600 border-indigo-500 text-white"
                            : "bg-[#12121a] border-[#2a2a38] text-gray-400 hover:border-indigo-500/40 hover:text-gray-200"
                        }`}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">
                    Voice {ttsVoices.length > 0 ? `(${ttsVoices.length} available)` : "(loading…)"}
                  </label>

                  {ttsVoices.length === 0 ? (
                    <p className="text-xs text-gray-600 bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-3">
                      No voices found. Ensure your browser and OS have text-to-speech voices installed.
                    </p>
                  ) : (
                    <>
                      <input
                        value={ttsSearch}
                        onChange={e => setTtsSearch(e.target.value)}
                        placeholder="Search by voice name or language…"
                        className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-2"
                      />
                      <div className="max-h-60 overflow-y-auto rounded-xl border border-[#2a2a38] divide-y divide-[#2a2a38]">
                        {/* Default option */}
                        <button
                          onClick={() => saveTtsVoice("")}
                          className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#2a2a38] transition ${!ttsVoiceName ? "bg-indigo-500/10" : ""}`}
                        >
                          <div>
                            <p className={`text-sm ${!ttsVoiceName ? "text-indigo-300 font-medium" : "text-gray-300"}`}>Default (system)</p>
                            <p className="text-[11px] text-gray-600">Browser chooses the best voice automatically</p>
                          </div>
                          {!ttsVoiceName && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                        </button>
                        {ttsVoices
                          .filter(v => !ttsSearch || v.name.toLowerCase().includes(ttsSearch.toLowerCase()) || v.lang.toLowerCase().includes(ttsSearch.toLowerCase()))
                          .map((v, i) => (
                            <button
                              key={i}
                              onClick={() => saveTtsVoice(v.name)}
                              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#2a2a38] transition ${ttsVoiceName === v.name ? "bg-indigo-500/10" : ""}`}
                            >
                              <div className="min-w-0">
                                <p className={`text-sm truncate ${ttsVoiceName === v.name ? "text-indigo-300 font-medium" : "text-gray-300"}`}>{v.name}</p>
                                <p className="text-[11px] text-gray-600">{v.lang} · {v.localService ? "offline" : "online"}</p>
                              </div>
                              {ttsVoiceName === v.name && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl px-4 py-3">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    <span className="text-gray-400">Offline voices</span> work without internet and are faster. <span className="text-gray-400">Online voices</span> (if any) are streamed by the OS and may sound higher quality but require a connection. The voice list is provided by your operating system and cannot be extended through MemoLink.
                  </p>
                </div>
              </div>
            )}

            {/* ── Email ── */}
            {tab === "email" && (
              <div className="space-y-4">
                {emailStatus.connected ? (
                  <>
                    {/* Connected header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                        <span className="text-xs text-gray-400 truncate">{emailStatus.email}</span>
                      </div>
                      <button onClick={handleDisconnectEmail} disabled={emailLoading} className={btnDanger}>
                        {emailLoading ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>

                    {/* Sync bar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={runAutoProcess} disabled={syncing} className={btnPrimary}>
                        {syncing ? "Syncing…" : "↻ Refresh"}
                      </button>
                      {syncing && <span className="text-xs text-gray-500">Syncing emails, creating notes & reminders…</span>}
                      {!syncing && autoResult && (
                        <span className="text-xs text-gray-500">
                          {autoResult.synced > 0
                            ? `${autoResult.synced} new · ${autoResult.notes_added} added to Email Digest · ${autoResult.reminders_created} reminders`
                            : "Up to date"}
                        </span>
                      )}
                    </div>

                    {/* Email detail view */}
                    {selectedEmail ? (
                      <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2a2a38]">
                          <button onClick={() => setSelectedEmail(null)} className="text-gray-500 hover:text-gray-300 transition">
                            ← Back
                          </button>
                        </div>
                        <div className="px-4 py-3 space-y-1">
                          <p className="text-sm font-semibold text-gray-200">{selectedEmail.subject}</p>
                          <p className="text-xs text-gray-500">
                            {selectedEmail.sender_name || selectedEmail.sender_email}
                            {selectedEmail.sender_name && <span className="text-gray-600"> · {selectedEmail.sender_email}</span>}
                          </p>
                          {selectedEmail.email_date && (
                            <p className="text-xs text-gray-600">{new Date(selectedEmail.email_date).toLocaleString()}</p>
                          )}
                        </div>
                        <div className="px-4 pb-3 max-h-48 overflow-y-auto">
                          <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
                            {selectedEmail.body_text || selectedEmail.snippet || "No content"}
                          </p>
                        </div>
                        {/* Action buttons */}
                        <div className="px-4 pb-4 flex flex-col gap-2">
                          {actionResult && (
                            <p className={`text-xs px-3 py-2 rounded-lg ${actionResult.startsWith("✓") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                              {actionResult}
                            </p>
                          )}
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => handleEmailToNote(selectedEmail.id)}
                              disabled={actionLoading !== null}
                              className={btnPrimary}
                            >
                              {actionLoading === "note" ? "Saving…" : "Save as Note"}
                            </button>
                            <button
                              onClick={() => handleEmailToReminder(selectedEmail.id)}
                              disabled={actionLoading !== null}
                              className={btnGhost}
                            >
                              {actionLoading === "reminder" ? "Adding…" : "Add Reminder"}
                            </button>
                            <button
                              onClick={() => handleDeleteEmail(selectedEmail.id)}
                              className={btnDanger}
                            >
                              Delete
                            </button>
                          </div>

                          {/* In-app reply */}
                          <EmailReplyPanel
                            emailRecordId={selectedEmail.id}
                            senderName={selectedEmail.sender_name}
                            senderEmail={selectedEmail.sender_email}
                            subject={selectedEmail.subject}
                            defaultOpen
                          />
                        </div>
                      </div>
                    ) : (
                      /* Email list */
                      <div className="border border-[#2a2a38] rounded-xl overflow-hidden">
                        {emailsLoading ? (
                          <p className="text-xs text-gray-600 px-4 py-6 text-center">Loading…</p>
                        ) : emails.length === 0 ? (
                          <p className="text-xs text-gray-600 px-4 py-6 text-center">
                            No emails yet. Click <span className="text-gray-400">Sync Emails</span> to fetch important emails from Gmail.
                          </p>
                        ) : (
                          <div className="divide-y divide-[#2a2a38] max-h-80 overflow-y-auto">
                            {emails.map(email => (
                              <div
                                key={email.id}
                                className="flex items-start gap-3 px-4 py-3 hover:bg-[#2a2a38]/50 cursor-pointer transition group"
                                onClick={() => { setSelectedEmail(email); setActionResult(null); }}
                              >
                                {/* Importance badge */}
                                <span className={`mt-0.5 shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  email.importance_score >= 4.5 ? "bg-red-500/20 text-red-400" :
                                  email.importance_score >= 3.5 ? "bg-orange-500/20 text-orange-400" :
                                  "bg-indigo-500/10 text-indigo-400"
                                }`}>
                                  {email.importance_score.toFixed(0)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className={`text-xs truncate ${email.is_read ? "text-gray-400" : "text-gray-200 font-medium"}`}>
                                    {email.subject}
                                  </p>
                                  <p className="text-[11px] text-gray-600 truncate">
                                    {email.sender_name || email.sender_email}
                                  </p>
                                  {email.snippet && (
                                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{email.snippet}</p>
                                  )}
                                </div>
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteEmail(email.id); }}
                                  className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition text-xs px-1"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400">Connect Gmail to sync important emails, convert them to notes, and get AI reply suggestions.</p>
                    <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl px-4 py-4 space-y-2.5">
                      {["Sync and filter important emails automatically", "Convert emails into notes with one click", "Create reminders from email deadlines", "Get AI-powered reply suggestions"].map(f => (
                        <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1 shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                    <button onClick={handleConnectEmail} disabled={emailConnecting} className="flex items-center gap-2.5 px-4 py-2.5 bg-white hover:bg-gray-100 disabled:opacity-60 rounded-xl text-sm font-medium text-gray-800 transition">
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      {emailConnecting ? "Redirecting to Google…" : "Connect Gmail"}
                    </button>
                    <p className="text-[11px] text-gray-600">You'll be redirected to Google to authorise access. MemoLink never stores your password.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Workflow ── */}
            {tab === "workflow" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Workflow Action Suggestions</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    When enabled, MemoLink automatically analyses each AI response and shows quick action buttons - like Save as Note or Add Reminder - directly below relevant messages. Nothing executes without you clicking.
                  </p>
                </div>

                {/* Main toggle */}
                <div className="flex items-center justify-between px-4 py-3.5 bg-[#12121a] border border-[#2a2a38] rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-gray-200">Action suggestions</p>
                    <p className="text-xs text-gray-500 mt-0.5">Show action buttons below AI responses when relevant</p>
                  </div>
                  <button
                    onClick={() => toggleWfSuggestions(!wfSuggestions)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${wfSuggestions ? "bg-indigo-600" : "bg-[#252533]"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${wfSuggestions ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                {/* Action types reference */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Available actions</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: "📝", label: "Save as Note", desc: "Save the AI response as a searchable note" },
                      { icon: "⏰", label: "Add Reminder", desc: "Create a reminder from a detected deadline" },
                      { icon: "🌐", label: "Search Web", desc: "Search for additional context online" },
                      { icon: "✅", label: "Extract Tasks", desc: "Pull out action items as a checklist note" },
                      { icon: "📋", label: "Summarise Workspace", desc: "Summarise all notes into one document" },
                      { icon: "📄", label: "Report Outline", desc: "Create a structured outline from notes" },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} className="flex items-start gap-2.5 px-3 py-2.5 bg-[#12121a] border border-[#2a2a38] rounded-xl">
                        <span className="text-base shrink-0 mt-0.5">{icon}</span>
                        <div>
                          <p className="text-xs font-medium text-gray-200">{label}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-indigo-500/5 border border-indigo-500/15 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Suggestions appear only when the AI response is actionable - short replies and simple questions will not show any buttons. Actions execute only when you click them.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
