import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SmartSourceWorkspaceState } from "../../hooks/useSmartSourceWorkspace";
import { NoteTimelineTab } from "./NoteTimelineTab";
import { SourceFileViewer } from "./SourceFileViewer";
import { SourceMetadataTab } from "./SourceMetadataTab";
import { SourceUploadButton } from "./SourceUploadButton";

export type WorkspaceTab = "original" | "editor" | "source" | "timeline";

interface Props {
  noteId: number | null;
  noteKey: string | number;
  editor: React.ReactNode;
  rawContent: string;
  timelineSupplement?: React.ReactNode;
  activeTab?: WorkspaceTab;
  onTabChange?: (tab: WorkspaceTab) => void;
  onSourceChanged?: () => void;
  sourceUploadDisabled?: boolean;
  workspace: SmartSourceWorkspaceState;
}

export function SmartSourceWorkspace({ noteId, noteKey, editor, rawContent, timelineSupplement, activeTab: controlledTab, onTabChange, onSourceChanged, sourceUploadDisabled, workspace }: Props) {
  const [internalTab, setInternalTab] = useState<WorkspaceTab>("editor");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = useCallback((tab: WorkspaceTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);
  const [localCacheStatus, setLocalCacheStatus] = useState("not checked");
  const annotationReloadTimerRef = useRef<number | null>(null);
  const source = workspace.data.source_files.at(-1) ?? null;
  useEffect(() => { setActiveTab("editor"); }, [noteKey, setActiveTab]);
  const handleCacheStatus = useCallback((status: string) => setLocalCacheStatus(status), []);
  const scheduleAnnotationReload = useCallback(() => {
    if (annotationReloadTimerRef.current != null) window.clearTimeout(annotationReloadTimerRef.current);
    annotationReloadTimerRef.current = window.setTimeout(() => {
      annotationReloadTimerRef.current = null;
      void workspace.reload();
    }, 1000);
  }, [workspace.reload]);
  useEffect(() => () => {
    if (annotationReloadTimerRef.current != null) window.clearTimeout(annotationReloadTimerRef.current);
  }, []);
  const tabs: { id: WorkspaceTab; label: string }[] = [
    { id: "original", label: "Original" }, { id: "editor", label: "Editor" },
    { id: "source", label: "Source File" }, { id: "timeline", label: "Timeline" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} disabled={!noteId && tab.id !== "editor"} className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition disabled:opacity-30 ${activeTab === tab.id ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}>{tab.label}</button>
        ))}
        {workspace.loading && <span className="ml-2 text-[11px] text-gray-600">Loading source workspace…</span>}
        {noteId && <SourceUploadButton noteId={noteId} disabled={sourceUploadDisabled} onComplete={() => { void workspace.reload(); onSourceChanged?.(); }} />}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-bar)]">
        {activeTab === "editor" && editor}
        {activeTab === "original" && noteId && <SourceFileViewer noteId={noteId} source={source} annotations={workspace.data.annotations} onAnnotationsChanged={scheduleAnnotationReload} onCacheStatus={handleCacheStatus} />}
        {activeTab === "source" && <SourceMetadataTab source={source} localCacheStatus={localCacheStatus} rawContent={rawContent} />}
        {activeTab === "timeline" && <div className="h-full overflow-y-auto"><NoteTimelineTab events={workspace.data.timeline} />{timelineSupplement}</div>}
        {workspace.error && activeTab !== "editor" && <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-red-500/10 p-2 text-xs text-red-400">{workspace.error}</div>}
      </div>
    </div>
  );
}
