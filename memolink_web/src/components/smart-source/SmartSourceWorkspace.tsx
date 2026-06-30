import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SmartSourceWorkspaceState } from "../../hooks/useSmartSourceWorkspace";
import { NoteTimelineTab } from "./NoteTimelineTab";
import { SourceFileViewer } from "./SourceFileViewer";
import { SourceMetadataTab } from "./SourceMetadataTab";

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

const TabIcons: Record<WorkspaceTab, React.ReactNode> = {
  original: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  editor: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  source: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
};

const TAB_LABELS: Record<WorkspaceTab, string> = {
  original: "Original",
  editor: "Editor",
  source: "Source File",
  timeline: "Timeline",
};

const TAB_ORDER: WorkspaceTab[] = ["original", "editor", "source", "timeline"];

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
  const bookLink = source
    ? (workspace.data.book_links ?? []).find((link) => link.source_file_id === source.id) ?? null
    : null;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-1">
        {TAB_ORDER.map((id) => (
          <button
            key={id}
            title={TAB_LABELS[id]}
            onClick={() => setActiveTab(id)}
            disabled={!noteId && id !== "editor"}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition disabled:opacity-30 ${activeTab === id ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
          >
            {TabIcons[id]}
          </button>
        ))}
        {workspace.loading && (
          <svg className="ml-1 h-3 w-3 animate-spin text-gray-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-bar)]">
        {/* Keep TipTap mounted while browsing source tabs. Recreating the editor on
            every Original -> Editor switch loses transient editor state and leaves
            a blank panel while its async editor instance is initialized, which is
            especially visible as a black screen in Android WebView. */}
        <div className={activeTab === "editor" ? "h-full" : "hidden"} aria-hidden={activeTab !== "editor"}>
          {editor}
        </div>
        {activeTab === "original" && noteId && <SourceFileViewer noteId={noteId} source={source} bookId={bookLink?.book_id ?? null} annotations={workspace.data.annotations} onAnnotationsChanged={scheduleAnnotationReload} onCacheStatus={handleCacheStatus} />}
        {activeTab === "source" && (
          <SourceMetadataTab
            source={source}
            localCacheStatus={localCacheStatus}
            rawContent={rawContent}
            noteId={noteId}
            uploadDisabled={sourceUploadDisabled}
            onUploadComplete={() => { void workspace.reload(); onSourceChanged?.(); }}
          />
        )}
        {activeTab === "timeline" && <div className="h-full overflow-y-auto"><NoteTimelineTab events={workspace.data.timeline} />{timelineSupplement}</div>}
        {workspace.error && activeTab !== "editor" && <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-red-500/10 p-2 text-xs text-red-400">{workspace.error}</div>}
      </div>
    </div>
  );
}
