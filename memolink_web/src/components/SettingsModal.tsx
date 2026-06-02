import React, { useState, useEffect } from "react";
import { changePassword } from "../api/client";
import { getProviders, addProvider, updateProvider, deleteProvider } from "../api/settingsApi";
import type { CustomProvider } from "../api/settingsApi";
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
}

type Tab = "profile" | "security" | "ai" | "keys" | "tts";

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

  useEffect(() => {
    if (show) loadProviders();
  }, [show]);

  // TTS settings — local voice list + saved preferences
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
                <p className="text-sm text-gray-400">Configure the voice used when reading notes and chat messages aloud. Changes apply to the next reading. Uses your browser's built-in speech engine — <span className="text-gray-300">no API key or internet connection required</span>.</p>

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

          </div>
        </div>
      </div>
    </div>
  );
}
