import { useState, useCallback } from "react";
import { listWorkspaces, getActiveWorkspace, setActiveWorkspace, createWorkspace } from "../api/workspaceApi";
import type { Workspace } from "../types";

// axios only attaches `response` once the server actually answered — a request
// that never reached a listening backend (still booting up, port not bound yet,
// etc.) rejects with no `response` at all. That's the case worth retrying.
function isNetworkError(err: any): boolean {
  return !err?.response;
}

export function useWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [noWorkspaces, setNoWorkspaces] = useState(false);

  const fetchWorkspaces = useCallback(async (): Promise<{ list: Workspace[]; reachable: boolean }> => {
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
      return { list, reachable: true };
    } catch (err: any) {
      setWorkspaces([]);
      return { list: [], reachable: !isNetworkError(err) };
    }
  }, []);

  const fetchActiveWorkspace = useCallback(async (): Promise<{ ws: Workspace | null; reachable: boolean; notFound: boolean }> => {
    try {
      const ws = await getActiveWorkspace();
      setActiveWorkspaceState(ws);
      setNoWorkspaces(false);
      return { ws, reachable: true, notFound: false };
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return { ws: null, reachable: true, notFound: true };
      }
      return { ws: null, reachable: !isNetworkError(err), notFound: false };
    }
  }, []);

  // Retries on connectivity failure (backend still starting up) instead of giving
  // up after one attempt — otherwise launching the desktop app before the backend
  // is ready leaves the UI permanently stuck on an empty workspace.
  const initWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        const [activeResult, wsResult] = await Promise.all([fetchActiveWorkspace(), fetchWorkspaces()]);
        if (activeResult.reachable && wsResult.reachable) {
          if (!activeResult.notFound) return activeResult.ws;
          // "/workspaces/active" reported no active workspace - only trust that
          // if the plain workspace list agrees. A stray 404 there must never
          // force a user who already has workspaces back into onboarding.
          if (wsResult.list.length > 0) {
            const fallback = wsResult.list[0];
            setActiveWorkspaceState(fallback);
            setNoWorkspaces(false);
            return fallback;
          }
          setNoWorkspaces(true);
          return null;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchActiveWorkspace, fetchWorkspaces]);

  const switchWorkspace = useCallback(async (ws: Workspace) => {
    await setActiveWorkspace(ws.id);
    setActiveWorkspaceState(ws);
  }, []);

  const addWorkspace = useCallback(async (name: string, type: string, description?: string | null): Promise<Workspace> => {
    const ws = await createWorkspace(name, type, description);
    setWorkspaces((prev) => [...prev, ws]);
    setNoWorkspaces(false);
    return ws;
  }, []);

  return {
    workspaces, setWorkspaces,
    activeWorkspace, setActiveWorkspaceState,
    loading, noWorkspaces,
    initWorkspace, fetchWorkspaces, fetchActiveWorkspace,
    switchWorkspace, addWorkspace,
  };
}
