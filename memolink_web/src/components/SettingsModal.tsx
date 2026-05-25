import React, { useState } from "react";
import { changePassword } from "../api/client";
import { MODELS } from "../constants/models";
import type { User } from "../utils/auth";

interface SettingsModalProps {
  show: boolean;
  user: User;
  onClose: () => void;
  selectedModel: string;
  onModelChange: (id: string) => void;
  modelSelectionEnabled?: boolean;
}

export function SettingsModal({ show, user, onClose, selectedModel, onModelChange, modelSelectionEnabled = true }: SettingsModalProps) {
  const [tab, setTab] = useState<"profile" | "security" | "ai">("profile");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!show) return null;

  function reset() {
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setError(null); setSuccess(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPw !== confirmPw) { setError("New passwords do not match."); return; }
    if (newPw.length < 8) { setError("New password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
      reset();
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to change password.");
    } finally {
      setLoading(false);
    }
  }

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-[#1a1a24] border border-[#2a2a38] rounded-2xl w-[660px] shadow-2xl text-white overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a38]">
          <h2 className="font-semibold text-base">Settings</h2>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[#2a2a38] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex">
          {/* Sidebar tabs */}
          <div className="w-36 border-r border-[#2a2a38] py-3 shrink-0">
            {(["profile", "security", ...(modelSelectionEnabled ? ["ai"] : [])] as ("profile" | "security" | "ai")[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`w-full text-left px-4 py-2 text-sm transition capitalize ${
                  tab === t ? "text-indigo-400 bg-indigo-500/10 font-medium" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2a38]"
                }`}
              >
                {t === "profile" ? "Profile" : t === "security" ? "Security" : "AI Model"}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6">
            {tab === "profile" && (
              <div className="space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-indigo-600 flex items-center justify-center text-lg font-bold">
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-0.5">MemoLink account</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">Email</label>
                  <div className="bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-300">
                    {user.email}
                  </div>
                  <p className="text-xs text-gray-600 mt-1.5">Email cannot be changed.</p>
                </div>
              </div>
            )}

            {tab === "ai" && (
              <div className="space-y-3">
                <p className="text-sm text-gray-400">Choose which AI model powers your chat. This applies to all new messages.</p>
                <div className="flex gap-3 items-start">
                  {(["openai", "gemini", "deepseek"] as const).map((provider) => (
                    <div key={provider} className="flex-1 space-y-1.5">
                      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                        {provider === "openai" ? "OpenAI" : provider === "gemini" ? "Google Gemini (Free)" : "DeepSeek"}
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
              </div>
            )}

            {tab === "security" && (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <p className="text-sm text-gray-400 mb-2">Change your account password.</p>
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl px-3 py-2">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-xs rounded-xl px-3 py-2">
                    Password changed successfully.
                  </div>
                )}
                {[
                  { label: "Current Password", value: currentPw, setter: setCurrentPw },
                  { label: "New Password", value: newPw, setter: setNewPw },
                  { label: "Confirm New Password", value: confirmPw, setter: setConfirmPw },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider">{label}</label>
                    <input
                      type="password"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      required
                      className="w-full bg-[#12121a] border border-[#2a2a38] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition"
                    />
                  </div>
                ))}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 rounded-xl text-sm font-medium transition"
                >
                  {loading ? "Saving…" : "Change Password"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
