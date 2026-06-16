import { useState } from "react";
import type { Workspace, WorkspaceType } from "../types";

const WORKSPACE_TYPES: WorkspaceType[] = ["Academic", "Professional", "Personal", "Project", "Other"];

const TYPE_ICONS: Record<WorkspaceType, string> = {
  Academic: "🎓",
  Professional: "💼",
  Personal: "🏠",
  Project: "🚀",
  Other: "📁",
};

interface WorkspaceSetupPageProps {
  onCreated: (workspace: Workspace) => void;
  onAdd: (name: string, type: string, description?: string | null) => Promise<Workspace>;
}

export function WorkspaceSetupPage({ onCreated, onAdd }: WorkspaceSetupPageProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkspaceType>("Other");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Workspace name is required."); return; }
    setLoading(true);
    setError("");
    try {
      const ws = await onAdd(name.trim(), type, description.trim() || null);
      onCreated(ws);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Failed to create workspace. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full w-full bg-[var(--ml-bg-base)] flex flex-col items-center justify-center px-4 overflow-y-auto">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <img src="/memolink-icon.png" alt="" className="h-10 w-10 rounded-xl bg-white object-cover" />
          <div>
            <h1 className="text-xl font-bold text-white">Welcome to MemoLink</h1>
            <p className="text-sm text-gray-400">Create your first workspace to get started</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-panel)] rounded-2xl p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Workspace Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Computer Science, Work Projects…"
              className="w-full bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Type</label>
            <div className="grid grid-cols-5 gap-2">
              {WORKSPACE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs transition ${
                    type === t
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                      : "border-[var(--ml-bg-hover)] text-gray-500 hover:border-[#3a3a4a] hover:text-gray-300"
                  }`}
                >
                  <span className="text-lg">{TYPE_ICONS[t]}</span>
                  <span>{t}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">
              Description <span className="normal-case font-normal text-gray-600">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this workspace for?"
              rows={2}
              className="w-full bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/40 text-white text-sm font-semibold rounded-xl transition"
          >
            {loading ? "Creating…" : "Create Workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}
