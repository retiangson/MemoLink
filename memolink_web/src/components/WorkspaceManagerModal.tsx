import { useState } from "react";
import type { Workspace, WorkspaceType } from "../types";
import { createWorkspace, deleteWorkspace } from "../api/workspaceApi";

const WORKSPACE_TYPES: WorkspaceType[] = ["Academic", "Professional", "Personal", "Project", "Other"];
const TYPE_ICONS: Record<WorkspaceType, string> = {
  Academic: "🎓",
  Professional: "💼",
  Personal: "🏠",
  Project: "🚀",
  Other: "📁",
};

interface WorkspaceManagerModalProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onClose: () => void;
  onCreated: (ws: Workspace) => void;
  onDeleted: (id: number) => void;
}

export function WorkspaceManagerModal({ workspaces, activeWorkspace, onClose, onCreated, onDeleted }: WorkspaceManagerModalProps) {
  const [tab, setTab] = useState<"list" | "create">("list");
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkspaceType>("Other");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setCreating(true); setError("");
    try {
      const ws = await createWorkspace(name.trim(), type, description.trim() || null);
      onCreated(ws);
      setName(""); setDescription(""); setType("Other");
      setTab("list");
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(ws: Workspace) {
    if (workspaces.length <= 1) { alert("You must keep at least one workspace."); return; }
    if (!confirm(`Delete workspace "${ws.name}"? Notes and chats inside will be unassigned.`)) return;
    try {
      await deleteWorkspace(ws.id);
      onDeleted(ws.id);
    } catch (err: any) {
      alert(err?.response?.data?.detail ?? "Failed to delete workspace.");
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-[#16161d] border border-[#2a2a38] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a38]">
          <h2 className="text-sm font-semibold text-white">Workspaces</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
        </div>

        <div className="flex border-b border-[#2a2a38]">
          {(["list", "create"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-semibold transition ${tab === t ? "text-indigo-400 border-b-2 border-indigo-500" : "text-gray-500 hover:text-gray-300"}`}
            >
              {t === "list" ? "My Workspaces" : "+ New Workspace"}
            </button>
          ))}
        </div>

        {tab === "list" && (
          <div className="max-h-80 overflow-y-auto">
            {workspaces.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-8">No workspaces yet.</p>
            )}
            {workspaces.map((ws) => (
              <div key={ws.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#1e1e2a] last:border-0">
                <span className="text-lg shrink-0">{TYPE_ICONS[ws.type as WorkspaceType] ?? "📁"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">
                    {ws.name}
                    {activeWorkspace?.id === ws.id && <span className="ml-2 text-[10px] text-indigo-400 font-normal">active</span>}
                  </p>
                  <p className="text-xs text-gray-500">{ws.type}{ws.description ? ` · ${ws.description}` : ""}</p>
                </div>
                {ws.alert_count > 0 && (
                  <span className="text-[10px] text-amber-400">{ws.alert_count} due</span>
                )}
                <button
                  onClick={() => handleDelete(ws)}
                  className="text-gray-600 hover:text-red-400 text-xs transition"
                  title="Delete workspace"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {tab === "create" && (
          <form onSubmit={handleCreate} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
                autoFocus
                className="w-full bg-[#0f0f13] border border-[#2a2a38] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Type</label>
              <div className="grid grid-cols-5 gap-1.5">
                {WORKSPACE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex flex-col items-center gap-0.5 py-2 rounded-xl border text-[10px] transition ${type === t ? "border-indigo-500 bg-indigo-500/10 text-indigo-300" : "border-[#2a2a38] text-gray-500 hover:border-[#3a3a4a]"}`}
                  >
                    <span className="text-base">{TYPE_ICONS[t]}</span>
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Description <span className="normal-case font-normal text-gray-600">(optional)</span></label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this workspace for?"
                rows={2}
                className="w-full bg-[#0f0f13] border border-[#2a2a38] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={creating}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 text-white text-sm font-semibold rounded-xl transition"
            >
              {creating ? "Creating…" : "Create Workspace"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
