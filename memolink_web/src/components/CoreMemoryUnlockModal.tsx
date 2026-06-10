import React, { useState } from "react";
import { unlockVault } from "../api/coreMemoryApi";

interface CoreMemoryUnlockModalProps {
  onClose: () => void;
  onUnlocked: (token: string, expiresAt: Date) => void;
}

export function CoreMemoryUnlockModal({ onClose, onUnlocked }: CoreMemoryUnlockModalProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await unlockVault(password);
      onUnlocked(res.unlock_token, new Date(res.expires_at));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Incorrect password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🔐</span>
          <div>
            <h2 className="text-white font-semibold text-lg">Unlock Core Memory</h2>
            <p className="text-gray-400 text-sm">Enter your account password to access encrypted memories</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-900/40 border border-red-700 text-red-300 text-sm">
            {error}
          </div>
        )}

        <input
          type="password"
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-4"
          placeholder="Account password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
          autoFocus
        />

        <div className="flex gap-2">
          <button
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition disabled:opacity-50"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? "Unlocking…" : "Unlock"}
          </button>
          <button
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 transition"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>

        <p className="text-gray-500 text-xs mt-3 text-center">Vault auto-locks after 10 minutes</p>
      </div>
    </div>
  );
}
