import { useCallback, useEffect, useState } from "react";
import { getSmartSourceWorkspace, smartSourceErrorMessage, type SmartSourceWorkspaceData } from "../api/smartSourceApi";

const EMPTY_WORKSPACE: SmartSourceWorkspaceData = {
  source_files: [],
  annotations: [],
  timeline: [],
  recordings: [],
};

export function useSmartSourceWorkspace(noteId: number | null) {
  const [data, setData] = useState<SmartSourceWorkspaceData>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!noteId) {
      setData(EMPTY_WORKSPACE);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await getSmartSourceWorkspace(noteId));
    } catch (error: unknown) {
      setError(smartSourceErrorMessage(error, "Could not load source workspace"));
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void reload(); }, [reload]);

  return { data, setData, loading, error, reload };
}
