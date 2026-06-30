import { useCallback, useEffect, useRef, useState } from "react";
import { getSmartSourceWorkspace, smartSourceErrorMessage, type SmartSourceWorkspaceData } from "../api/smartSourceApi";

const EMPTY_WORKSPACE: SmartSourceWorkspaceData = {
  source_files: [],
  book_links: [],
  annotations: [],
  timeline: [],
  recordings: [],
};

export function useSmartSourceWorkspace(noteId: number | null) {
  const [data, setData] = useState<SmartSourceWorkspaceData>(EMPTY_WORKSPACE);
  const [loadedNoteId, setLoadedNoteId] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(noteId));
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!noteId) {
      setData(EMPTY_WORKSPACE);
      setLoadedNoteId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getSmartSourceWorkspace(noteId);
      if (requestId !== requestIdRef.current) return;
      setData(result);
      setLoadedNoteId(noteId);
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(smartSourceErrorMessage(error, "Could not load source workspace"));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void reload(); }, [reload]);

  const noteMatchesLoadedWorkspace = loadedNoteId === noteId;
  return {
    data: noteMatchesLoadedWorkspace ? data : EMPTY_WORKSPACE,
    loading: loading || (noteId != null && !noteMatchesLoadedWorkspace),
    error,
    reload,
  };
}

export type SmartSourceWorkspaceState = ReturnType<typeof useSmartSourceWorkspace>;
