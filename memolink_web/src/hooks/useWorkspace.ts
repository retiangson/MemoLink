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

  const fetchWorkspaces = useCallback(async (): Promise<boolean> => {
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
      return true;
    } catch (err: any) {
      setWorkspaces([]);
      return !isNetworkError(err);
    }
  }, []);

  const fetchActiveWorkspace = useCallback(async (): Promise<{ ws: Workspace | null; reachable: boolean }> => {
    try {
      const ws = await getActiveWorkspace();
      setActiveWorkspaceState(ws);
      setNoWorkspaces(false);
      return { ws, reachable: true };
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setNoWorkspaces(true);
        return { ws: null, reachable: true };
      }
      return { ws: null, reachable: !isNetworkError(err) };
    }
  }, []);

  // Retries on connectivity failure (backend still starting up) instead of giving
  // up after one attempt — otherwise launching the desktop app before the backend
  // is ready leaves the UI permanently stuck on an empty workspace.
  const initWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        const [activeResult, wsReachable] = await Promise.all([fetchActiveWorkspace(), fetchWorkspaces()]);
        if (activeResult.reachable && wsReachable) return activeResult.ws;
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
