import { useState, useCallback } from "react";
import { listWorkspaces, getActiveWorkspace, setActiveWorkspace, createWorkspace } from "../api/workspaceApi";
import type { Workspace } from "../types";

export function useWorkspace() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [noWorkspaces, setNoWorkspaces] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  const fetchActiveWorkspace = useCallback(async (): Promise<Workspace | null> => {
    try {
      const ws = await getActiveWorkspace();
      setActiveWorkspaceState(ws);
      setNoWorkspaces(false);
      return ws;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setNoWorkspaces(true);
      }
      return null;
    }
  }, []);

  const initWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [ws] = await Promise.all([fetchActiveWorkspace(), fetchWorkspaces()]);
      return ws;
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
