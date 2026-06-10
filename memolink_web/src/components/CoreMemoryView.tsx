import React, { useCallback, useEffect, useState } from "react";
import {
  listCoreMemories,
  createCoreMemory,
  updateCoreMemory,
  deleteCoreMemory,
  revealCoreMemory,
  getVaultSession,
  saveVaultSession,
  clearVaultSession,
  type CoreMemory,
} from "../api/coreMemoryApi";
import { CoreMemoryUnlockModal } from "./CoreMemoryUnlockModal";

const MEMORY_TYPE_LABELS: Record<string, string> = {
  person: "Person",
  contact: "Contact",
  project: "Project",
  card: "Card",
  credential: "Credential",
  preference: "Preference",
  general: "General",
};

const SENSITIVITY_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-900/30",
  medium: "text-yellow-400 bg-yellow-900/30",
  high: "text-red-400 bg-red-900/30",
};

interface CoreMemoryViewProps {
  workspaceId?: number | null;
  onClose: () => void;
}

export function CoreMemoryView({ workspaceId, onClose }: CoreMemoryViewProps) {
  const [memories, setMemories] = useState<CoreMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [unlockExpiry, setUnlockExpiry] = useState<Date | null>(null);
  const [showUnlock, setShowUnlock] = useState(false);
  const [revealedValues, setRevealedValues] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "", memory_type: "general", sensitivity_level: "low",
    plaintext_value: "", masked_display: "", searchable_metadata: "",
  });
  const [savingCreate, setSavingCreate] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CoreMemory> & { masked_display?: string; searchable_metadata?: string }>({});

  const isVaultOpen = unlockToken !== null && unlockExpiry !== null && new Date() < unlockExpiry;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCoreMemories(workspaceId);
      setMemories(data);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const session = getVaultSession();
    if (!session) return;
    setUnlockToken(session.token);
    setUnlockExpiry(new Date(session.expiresAt));
  }, []);

  function handleUnlocked(token: string, expiry: Date) {
    setUnlockToken(token);
    setUnlockExpiry(expiry);
    saveVaultSession(token, expiry.toISOString());
    setShowUnlock(false);
    setTimeout(() => {
      setUnlockToken(null);
      setUnlockExpiry(null);
      setRevealedValues({});
      clearVaultSession();
    }, 10 * 60 * 1000);
  }

  async function handleReveal(id: number) {
    if (!isVaultOpen) { setShowUnlock(true); return; }
    try {
      const value = await revealCoreMemory(id, unlockToken!);
      setRevealedValues((p) => ({ ...p, [id]: value }));
    } catch {
      setRevealedValues((p) => ({ ...p, [id]: "⚠ Decryption failed" }));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    await deleteCoreMemory(id);
    setMemories((p) => p.filter((m) => m.id !== id));
    setRevealedValues((p) => { const c = { ...p }; delete c[id]; return c; });
  }

  async function handleCreate() {
    if (!createForm.title.trim()) return;
    setSavingCreate(true);
    try {
      const mem = await createCoreMemory({
        title: createForm.title.trim(),
        memory_type: createForm.memory_type,
        sensitivity_level: createForm.sensitivity_level,
        plaintext_value: createForm.plaintext_value || null,
        masked_display: createForm.masked_display || null,
        searchable_metadata: createForm.searchable_metadata || null,
        workspace_id: workspaceId,
      });
      setMemories((p) => [mem, ...p]);
      setShowCreateForm(false);
      setCreateForm({ title: "", memory_type: "general", sensitivity_level: "low", plaintext_value: "", masked_display: "", searchable_metadata: "" });
    } finally {
      setSavingCreate(false);
    }
  }

  async function handleSaveEdit(id: number) {
    const updated = await updateCoreMemory(id, {
      title: editForm.title ?? undefined,
      memory_type: editForm.memory_type ?? undefined,
      sensitivity_level: editForm.sensitivity_level ?? undefined,
      masked_display: (editForm as any).masked_display ?? undefined,
      searchable_metadata: (editForm as any).searchable_metadata ?? undefined,
    });
    setMemories((p) => p.map((m) => (m.id === id ? updated : m)));
    setEditingId(null);
  }

  const vaultStatusEl = isVaultOpen ? (
    <span className="flex items-center gap-1 text-green-400 text-xs">
      <span>🔓</span> Vault open
    </span>
  ) : (
    <button
      className="flex items-center gap-1 text-yellow-400 text-xs hover:text-yellow-300"
      onClick={() => setShowUnlock(true)}
    >
      <span>🔒</span> Unlock vault
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-40" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <h2 className="text-white font-semibold text-lg">Core Memory</h2>
            <span className="text-gray-500 text-xs">({memories.length})</span>
          </div>
          <div className="flex items-center gap-4">
            {vaultStatusEl}
            <button
              className="text-indigo-400 hover:text-indigo-300 text-sm"
              onClick={() => setShowCreateForm((v) => !v)}
            >
              + Add
            </button>
            <button className="text-gray-400 hover:text-white text-lg leading-none" onClick={onClose}>×</button>
          </div>
        </div>

        {/* Create form */}
        {showCreateForm && (
          <div className="px-5 py-4 border-b border-gray-700 bg-gray-800/50">
            <div className="grid grid-cols-2 gap-3">
              <input
                className="col-span-2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                placeholder="Title *"
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
              />
              <select
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                value={createForm.memory_type}
                onChange={(e) => setCreateForm((f) => ({ ...f, memory_type: e.target.value }))}
              >
                {Object.entries(MEMORY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                value={createForm.sensitivity_level}
                onChange={(e) => setCreateForm((f) => ({ ...f, sensitivity_level: e.target.value }))}
              >
                <option value="low">Low sensitivity</option>
                <option value="medium">Medium sensitivity</option>
                <option value="high">High sensitivity</option>
              </select>
              <input
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                placeholder="Secret value (encrypted)"
                value={createForm.plaintext_value}
                onChange={(e) => setCreateForm((f) => ({ ...f, plaintext_value: e.target.value }))}
              />
              <input
                className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none"
                placeholder="Display label (shown masked)"
                value={createForm.masked_display}
                onChange={(e) => setCreateForm((f) => ({ ...f, masked_display: e.target.value }))}
              />
              <input
                className="col-span-2 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none"
                placeholder="Searchable keywords (safe, used for AI retrieval)"
                value={createForm.searchable_metadata}
                onChange={(e) => setCreateForm((f) => ({ ...f, searchable_metadata: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50"
                onClick={handleCreate}
                disabled={savingCreate || !createForm.title.trim()}
              >
                {savingCreate ? "Saving…" : "Save"}
              </button>
              <button
                className="px-4 py-1.5 rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-800 text-sm"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <p className="text-gray-500 text-sm text-center py-8">Loading…</p>
          ) : memories.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🧠</div>
              <p className="text-gray-400 text-sm">No core memories yet.</p>
              <p className="text-gray-500 text-xs mt-1">AI will detect facts automatically from your chat, or add them manually.</p>
            </div>
          ) : memories.map((mem) => (
            <div key={mem.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              {editingId === mem.id ? (
                <div className="space-y-2">
                  <input
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none"
                    value={editForm.title ?? mem.title ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <select
                      className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none"
                      value={editForm.memory_type ?? mem.memory_type ?? "general"}
                      onChange={(e) => setEditForm((f) => ({ ...f, memory_type: e.target.value }))}
                    >
                      {Object.entries(MEMORY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select
                      className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none"
                      value={editForm.sensitivity_level ?? mem.sensitivity_level ?? "low"}
                      onChange={(e) => setEditForm((f) => ({ ...f, sensitivity_level: e.target.value }))}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <input
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none"
                    placeholder="Display label"
                    value={(editForm as any).masked_display ?? mem.masked_content ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, masked_display: e.target.value }))}
                  />
                  <input
                    className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none"
                    placeholder="Searchable keywords"
                    value={(editForm as any).searchable_metadata ?? mem.searchable_content ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, searchable_metadata: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs" onClick={() => handleSaveEdit(mem.id)}>Save</button>
                    <button className="px-3 py-1 rounded border border-gray-600 text-gray-300 text-xs hover:bg-gray-700" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-white text-sm font-medium truncate">{mem.title}</span>
                      {mem.is_encrypted && <span className="text-yellow-400 text-xs">🔒</span>}
                      {mem.memory_source === "ai_detected" && (
                        <span className="text-purple-400 text-xs px-1.5 py-0.5 bg-purple-900/30 rounded-full">AI</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {mem.memory_type && (
                        <span className="text-gray-400 text-xs px-1.5 py-0.5 bg-gray-700 rounded">
                          {MEMORY_TYPE_LABELS[mem.memory_type] ?? mem.memory_type}
                        </span>
                      )}
                      {mem.sensitivity_level && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${SENSITIVITY_COLORS[mem.sensitivity_level] ?? "text-gray-400"}`}>
                          {mem.sensitivity_level}
                        </span>
                      )}
                    </div>
                    {revealedValues[mem.id] ? (
                      <div className="mt-1 text-green-300 text-sm font-mono bg-gray-700 rounded px-2 py-1">
                        {revealedValues[mem.id]}
                      </div>
                    ) : (
                      <p className="mt-1 text-gray-400 text-sm">{mem.masked_content ?? "—"}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {mem.is_encrypted && !revealedValues[mem.id] && (
                      <button
                        className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 rounded hover:bg-gray-700"
                        title="Reveal encrypted value"
                        onClick={() => handleReveal(mem.id)}
                      >
                        Reveal
                      </button>
                    )}
                    <button
                      className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700"
                      onClick={() => { setEditingId(mem.id); setEditForm({}); }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-gray-700"
                      onClick={() => handleDelete(mem.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {showUnlock && (
        <CoreMemoryUnlockModal
          onClose={() => setShowUnlock(false)}
          onUnlocked={handleUnlocked}
        />
      )}
    </div>
  );
}
