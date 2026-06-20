import React, { useEffect, useState } from "react";
import {
  createPublicAgent, listPublicAgents, updatePublicAgent, enablePublicAgent, disablePublicAgent,
  regeneratePublicAgentToken, deletePublicAgent, type PublicAgent,
} from "../api/publicAgentApi";
import { listWorkspaces } from "../api/workspaceApi";
import type { Workspace } from "../types";

function embedSnippet(agent: PublicAgent): string {
  const webOrigin = window.location.origin;
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string) ?? "";
  return `<script src="${webOrigin}/widget.js" data-agent-token="${agent.token}" data-api-base="${apiBase}" async></script>`;
}

interface EditState {
  name: string;
  description: string;
  system_prompt: string;
  allowed_domains: string;
  workspace_id: number;
}

function toEditState(agent: PublicAgent): EditState {
  return {
    name: agent.name,
    description: agent.description ?? "",
    system_prompt: agent.system_prompt ?? "",
    allowed_domains: agent.allowed_domains ?? "",
    workspace_id: agent.workspace_id,
  };
}

export function PublicAgentsPanel() {
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWorkspaceId, setNewWorkspaceId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [agentList, wsList] = await Promise.all([listPublicAgents(), listWorkspaces()]);
      setAgents(agentList);
      setWorkspaces(wsList);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setError("The Public Portfolio Agent feature is disabled. Enable it under Feature Flags first.");
      } else {
        setError("Failed to load public agents.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName.trim() || newWorkspaceId == null) return;
    setSaving(true);
    try {
      const agent = await createPublicAgent({ name: newName.trim(), workspace_id: newWorkspaceId });
      setAgents((p) => [...p, agent]);
      setNewName("");
      setNewWorkspaceId(null);
      setCreating(false);
    } catch {
      alert("Could not create agent.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(agent: PublicAgent) {
    setEdits((p) => ({ ...p, [agent.id]: toEditState(agent) }));
    setExpandedId(agent.id);
  }

  async function handleSaveEdit(agent: PublicAgent) {
    const edit = edits[agent.id];
    if (!edit) return;
    setSaving(true);
    try {
      const updated = await updatePublicAgent(agent.id, {
        name: edit.name.trim(),
        description: edit.description.trim() || null,
        system_prompt: edit.system_prompt.trim() || null,
        allowed_domains: edit.allowed_domains.trim() || null,
        workspace_id: edit.workspace_id,
      });
      setAgents((p) => p.map((a) => (a.id === agent.id ? updated : a)));
      setExpandedId(null);
    } catch {
      alert("Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEnabled(agent: PublicAgent) {
    try {
      const updated = agent.public_enabled ? await disablePublicAgent(agent.id) : await enablePublicAgent(agent.id);
      setAgents((p) => p.map((a) => (a.id === agent.id ? updated : a)));
    } catch {
      alert("Could not change agent status.");
    }
  }

  async function handleRegenerateToken(agent: PublicAgent) {
    if (!confirm("Regenerate this agent's public token? Any embedded widgets using the old token will stop working.")) return;
    try {
      const updated = await regeneratePublicAgentToken(agent.id);
      setAgents((p) => p.map((a) => (a.id === agent.id ? updated : a)));
    } catch {
      alert("Could not regenerate token.");
    }
  }

  async function handleDelete(agent: PublicAgent) {
    if (!confirm(`Delete public agent "${agent.name}"? This cannot be undone.`)) return;
    try {
      await deletePublicAgent(agent.id);
      setAgents((p) => p.filter((a) => a.id !== agent.id));
    } catch {
      alert("Could not delete agent.");
    }
  }

  function handleCopyEmbed(agent: PublicAgent) {
    navigator.clipboard.writeText(embedSnippet(agent)).then(() => {
      setCopiedId(agent.id);
      setTimeout(() => setCopiedId((id) => (id === agent.id ? null : id)), 2000);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Public Portfolio Agents</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage embeddable chat agents that answer visitor questions using only notes explicitly marked public.
          </p>
        </div>
        <button
          onClick={() => setCreating((c) => !c)}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition shrink-0"
        >
          New Agent
        </button>
      </div>

      {creating && (
        <div className="mb-6 bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Portfolio Bot"
              className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Public Workspace</label>
            <select
              value={newWorkspaceId ?? ""}
              onChange={(e) => setNewWorkspaceId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50"
            >
              <option value="">Select a workspace…</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-600 mt-1">
              Only notes in this workspace with "Public Agent" enabled will ever be retrievable by this agent.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg transition"
            >Cancel</button>
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim() || newWorkspaceId == null}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
            >Create</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-600 text-sm">Loading…</div>
      ) : error ? (
        <p className="text-sm text-amber-400">{error}</p>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-gray-600">No public agents yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => {
            const ws = workspaces.find((w) => w.id === agent.workspace_id);
            const edit = edits[agent.id];
            const isExpanded = expandedId === agent.id;
            return (
              <div key={agent.id} className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-200 truncate">{agent.name}</p>
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md border shrink-0 ${
                        agent.public_enabled
                          ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                          : "text-gray-500 bg-gray-500/10 border-gray-500/20"
                      }`}>
                        {agent.public_enabled ? "Live" : "Off"}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 truncate mt-0.5">
                      Workspace: {ws?.name ?? `#${agent.workspace_id}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggleEnabled(agent)}
                    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                      agent.public_enabled ? "bg-indigo-600" : "bg-[#252533]"
                    }`}
                    title={agent.public_enabled ? "Disable public access" : "Enable public access"}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      agent.public_enabled ? "translate-x-5" : "translate-x-0"
                    }`} />
                  </button>
                  <button
                    onClick={() => (isExpanded ? setExpandedId(null) : startEdit(agent))}
                    className="px-2.5 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-[#252533] rounded-lg border border-[var(--ml-bg-hover)] transition shrink-0"
                  >
                    {isExpanded ? "Close" : "Edit"}
                  </button>
                  <button
                    onClick={() => handleDelete(agent)}
                    className="px-2.5 py-1.5 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg border border-red-500/20 transition shrink-0"
                  >
                    Delete
                  </button>
                </div>

                {/* Embed code */}
                <div className="px-4 pb-3.5 flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate text-[10px] text-gray-500 bg-[var(--ml-bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--ml-bg-hover)]">
                    {embedSnippet(agent)}
                  </code>
                  <button
                    onClick={() => handleCopyEmbed(agent)}
                    className="px-2.5 py-1.5 text-[11px] text-indigo-400 hover:bg-indigo-500/10 rounded-lg border border-indigo-500/20 transition shrink-0"
                  >
                    {copiedId === agent.id ? "Copied ✓" : "Copy embed code"}
                  </button>
                </div>

                {isExpanded && edit && (
                  <div className="px-4 pb-4 pt-1 border-t border-[var(--ml-bg-hover)] space-y-3">
                    <div>
                      <label className="text-xs text-gray-500">Name</label>
                      <input
                        type="text"
                        value={edit.name}
                        onChange={(e) => setEdits((p) => ({ ...p, [agent.id]: { ...edit, name: e.target.value } }))}
                        className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Public Workspace</label>
                      <select
                        value={edit.workspace_id}
                        onChange={(e) => setEdits((p) => ({ ...p, [agent.id]: { ...edit, workspace_id: Number(e.target.value) } }))}
                        className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50"
                      >
                        {workspaces.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Description (internal)</label>
                      <input
                        type="text"
                        value={edit.description}
                        onChange={(e) => setEdits((p) => ({ ...p, [agent.id]: { ...edit, description: e.target.value } }))}
                        className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Custom system prompt (optional)</label>
                      <textarea
                        value={edit.system_prompt}
                        onChange={(e) => setEdits((p) => ({ ...p, [agent.id]: { ...edit, system_prompt: e.target.value } }))}
                        rows={3}
                        className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Allowed domains (comma-separated, blank = any)</label>
                      <input
                        type="text"
                        value={edit.allowed_domains}
                        onChange={(e) => setEdits((p) => ({ ...p, [agent.id]: { ...edit, allowed_domains: e.target.value } }))}
                        placeholder="https://ronald.dev, https://portfolio.example.com"
                        className="mt-1 w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <button
                        onClick={() => handleRegenerateToken(agent)}
                        className="px-2.5 py-1.5 text-[11px] text-amber-400 hover:bg-amber-500/10 rounded-lg border border-amber-500/20 transition"
                      >
                        Regenerate token
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setExpandedId(null)}
                          className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg transition"
                        >Cancel</button>
                        <button
                          onClick={() => handleSaveEdit(agent)}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition"
                        >Save</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
