import React, { useState, useRef, useEffect } from "react";
import { RichNoteEditor, ttsHighlightKey } from "./RichNoteEditor";
import { splitSentences } from "../hooks/useTTS";
import { useRecording } from "../hooks/useRecording";
import { LANGUAGES } from "../utils/languages";
import { exportNote, EXPORT_FORMATS } from "../utils/noteExport";
import type { ExportFormat } from "../utils/noteExport";
import { VideoImportModal } from "./VideoImportModal";
import { TimelinePanel } from "./TimelinePanel";
import { TTSPlayerBar } from "./TTSPlayerBar";
import { ColorModePicker } from "./ColorModePicker";
import { FontSizePicker } from "./FontSizePicker";
import { useReaderColorMode } from "../hooks/useReaderColorMode";
import { useReaderFontSize } from "../hooks/useReaderFontSize";
import { richContentFilter, readerFontScale } from "./book-readers/format";
import { SmartSourceWorkspace, type WorkspaceTab } from "./smart-source/SmartSourceWorkspace";
import { completeNoteEquation, getNote, solveNoteEquation } from "../api/client";
import { useSmartSourceWorkspace } from "../hooks/useSmartSourceWorkspace";
import { useNoteAutosave, type NoteSnapshot } from "../hooks/useNoteAutosave";
import { useLocalRecordingStorage } from "../hooks/useLocalRecordingStorage";
import { saveRecordingMetadata } from "../api/smartSourceApi";
import { SourceUploadButton } from "./smart-source/SourceUploadButton";
import type { Note } from "../types";

interface NoteEditorViewProps {
  noteKey: string | number;
  noteTitleDraft: string;
  setNoteTitleDraft: (v: string | ((prev: string) => string)) => void;
  noteContentDraft: string;
  setNoteContentDraft: (v: string | ((prev: string) => string)) => void;
  isNoteDirty: boolean;
  onAutosave: (noteKey: string, snapshot: NoteSnapshot, sourceLinked: boolean) => Promise<void>;
  onEnsurePersisted: (noteKey: string, snapshot: NoteSnapshot, sourceLinked: boolean) => Promise<number>;
  onAutosavePageExit: (noteKey: string, snapshot: NoteSnapshot) => void;
  onEquationSolved: (noteId: number, freshNote: Note) => void;
  aiModel?: string;
  onPlay?: (text: string) => void;
  ttsPlaying?: boolean;
  ttsPaused?: boolean;
  onTtsStop?: () => void;
  onTtsPauseResume?: () => void;
  onTtsBack?: () => void;
  onTtsForward?: () => void;
  ttsRate?: number;
  ttsVoices?: SpeechSynthesisVoice[];
  ttsSelectedVoice?: SpeechSynthesisVoice | null;
  onTtsRateChange?: (r: number) => void;
  onTtsVoiceChange?: (v: SpeechSynthesisVoice | null) => void;
  ttsSentenceIdx?: number;
  ttsSentences?: string[];
  ttsWord?: { start: number; end: number } | null;
  ttsEnabled?: boolean;
  videoImportEnabled?: boolean;
  timelineEnabled?: boolean;
  noteId?: number | null;
  publicAgentFeatureEnabled?: boolean;
  publicAgentEnabled?: boolean;
  onTogglePublicAgent?: () => void;
  onOpenHighlight?: (highlightId: number) => void;
}

export function NoteEditorView({
  noteKey,
  noteTitleDraft, setNoteTitleDraft,
  noteContentDraft, setNoteContentDraft,
  isNoteDirty, onAutosave, onEnsurePersisted, onAutosavePageExit, onEquationSolved, aiModel,
  onPlay, ttsPlaying, ttsPaused, onTtsStop, onTtsPauseResume,
  onTtsBack, onTtsForward, ttsRate = 1.0, ttsVoices = [], ttsSelectedVoice = null,
  onTtsRateChange, onTtsVoiceChange,
  ttsSentenceIdx, ttsSentences, ttsWord = null,
  ttsEnabled = true, videoImportEnabled = true,
  timelineEnabled = true, noteId = null,
  publicAgentFeatureEnabled = false, publicAgentEnabled = false, onTogglePublicAgent,
  onOpenHighlight,
}: NoteEditorViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [colorMode, setColorMode] = useReaderColorMode();
  const [fontSize, setFontSize] = useReaderFontSize();
  const noteFontSizeVar = { "--ml-note-font-size": `${Math.round(16 * readerFontScale(fontSize))}px` } as React.CSSProperties;
  const [showExport, setShowExport] = useState(false);
  const [showVideoImport, setShowVideoImport] = useState(false);
  const [language, setLanguage] = useState("en");
  const [recordMode, setRecordMode] = useState<"default" | "lecture">("lecture");
  const [recordBackend, setRecordBackend] = useState<"auto" | "whisper" | "deepgram">("auto");
  const [autoStopOnSilence, setAutoStopOnSilence] = useState(false);
  const recordingStorage = useLocalRecordingStorage();
  const [recordingFileStatus, setRecordingFileStatus] = useState<string | null>(null);
  const [equationAction, setEquationAction] = useState<"solve" | "complete" | null>(null);
  const [equationError, setEquationError] = useState<string | null>(null);
  const [persistedNoteId, setPersistedNoteId] = useState<number | null>(noteId);
  const editorRef = useRef<any>(null);
  const inkSnapshotRef = useRef<(() => { dataUrl: string; spacingLines: number } | null) | null>(null);
  const speakStartDocPos = useRef(0);
  const speakDocText = useRef("");
  const speakDocTrimOffset = useRef(0);
  const speakDocSentenceOffset = useRef(0);

  function escapeHtml(text: string) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function appendCapturedParagraph(source: string, chunk: string) {
    const paragraph = `<p>${escapeHtml(chunk)}</p>`;
    return source ? `${source}${source.endsWith("\n") ? "" : "\n"}${paragraph}` : paragraph;
  }

  const recording = useRecording((text) => {
    setNoteContentDraft((prev) => {
      return appendCapturedParagraph(prev, text);
    });
  });

  function recordingFileName(blob: Blob): string {
    const cleanedTitle = noteTitleDraft.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80) || "Untitled";
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const extension = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
    return `MemoLink_Recording_${cleanedTitle}_${stamp}.${extension}`;
  }

  async function saveCompletedRecording(recordingResult: { blob: Blob; durationSeconds: number }) {
    const fileName = recordingFileName(recordingResult.blob);
    setRecordingFileStatus("Saving recording…");
    try {
      await recordingStorage.saveRecording(recordingResult.blob, fileName);
      if (noteId) {
        try {
          await saveRecordingMetadata(noteId, {
            file_name: fileName,
            duration_seconds: recordingResult.durationSeconds,
            local_only: true,
          });
        } catch {
          setRecordingFileStatus("Saved locally; timeline sync pending");
          return;
        }
      }
      setRecordingFileStatus("Recording saved locally");
    } catch (caught) {
      setRecordingFileStatus(caught instanceof Error ? caught.message : "Recording save failed");
    }
  }

  function readableTextBetween(doc: any, from: number, to: number): string {
    return doc.textBetween(from, to, " ", (node: any) => {
      if (node.type?.name !== "bookHighlightBlock") return "";
      const snippet = String(node.attrs?.snippet ?? "").trim();
      const citation = String(node.attrs?.citation ?? "").trim();
      return [snippet, citation].filter(Boolean).join(" ");
    });
  }

  function stopRecording() {
    recording.stopRecording();
  }

  async function startRecording(source: "mic" | "computer") {
    setShowPicker(false);
    setRecordingFileStatus(null);
    if (!await recordingStorage.prepareDirectory()) return;
    await recording.startRecording(source, {
      language,
      mode: recordMode,
      backend: recordBackend,
      autoStopOnSilence: recordMode === "lecture" ? false : autoStopOnSilence,
      silenceDurationMs: recordMode === "lecture" ? 2600 : 1500,
      onRecordingComplete: saveCompletedRecording,
    });
  }

  function handlePlay() {
    if (!onPlay) return;
    const editor = editorRef.current;
    let fromPos = 0;
    let rawDocText = "";
    if (editor) {
      const { from } = editor.state.selection;
      const doc = editor.state.doc;
      // Snap to the start of the sentence the cursor sits in, so reading
      // begins at that sentence — never mid-sentence, and not the whole paragraph.
      if (from <= 1) {
        fromPos = 0;
      } else {
        const $from = doc.resolve(from);
        const paraStart = $from.depth > 0 ? $from.start($from.depth) : 0;
        // Text from the paragraph start up to the cursor; the last sentence
        // terminator (. ! ? or newline) before the cursor marks the sentence start.
        const before = readableTextBetween(doc, paraStart, from);
        const m = before.match(/[\s\S]*[.!?\n]\s*/);
        fromPos = paraStart + (m ? m[0].length : 0);
      }
      rawDocText = readableTextBetween(doc, fromPos, doc.content.size);
      if (!rawDocText.trim()) { fromPos = 0; rawDocText = readableTextBetween(doc, 0, doc.content.size); }
    } else {
      rawDocText = noteContentDraft.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
    const trimmedDocText = rawDocText.trim();
    if (!trimmedDocText) return;
    speakStartDocPos.current = fromPos;
    speakDocTrimOffset.current = rawDocText.length - rawDocText.trimStart().length;
    speakDocText.current = trimmedDocText;
    // Read only the body, starting from the cursor — never the title.
    speakDocSentenceOffset.current = 0;
    onPlay(trimmedDocText);
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (ttsSentenceIdx == null || ttsSentenceIdx < 0 || !ttsSentences?.length) {
      editor.view.dispatch(editor.view.state.tr.setMeta(ttsHighlightKey, null));
      return;
    }
    const docSentenceIdx = ttsSentenceIdx - speakDocSentenceOffset.current;
    if (docSentenceIdx < 0) return;
    const docSentences = splitSentences(speakDocText.current);
    if (docSentenceIdx >= docSentences.length) return;

    let searchFrom = 0;
    let sentenceStart = -1;
    for (let i = 0; i <= docSentenceIdx; i++) {
      const idx = speakDocText.current.indexOf(docSentences[i], searchFrom);
      if (idx === -1) return;
      if (i === docSentenceIdx) sentenceStart = idx;
      searchFrom = idx + docSentences[i].length;
    }
    if (sentenceStart < 0) return;
    const sentLen = docSentences[docSentenceIdx].length;
    // Narrow to the current word if the browser reported a boundary;
    // otherwise highlight the whole sentence.
    let hlStart = sentenceStart;
    let hlEnd = sentenceStart + sentLen;
    if (ttsWord && ttsWord.end > ttsWord.start) {
      const ws = Math.min(Math.max(0, ttsWord.start), sentLen);
      const we = Math.min(Math.max(ws, ttsWord.end), sentLen);
      hlStart = sentenceStart + ws;
      hlEnd = sentenceStart + we;
    }
    const trimOffset = speakDocTrimOffset.current;

    const charToDoc: number[] = [];
    let separated = true;
    const startDocPos = speakStartDocPos.current;
    editor.state.doc.nodesBetween(startDocPos, editor.state.doc.content.size, (node: any, pos: number) => {
      if (node.isText) {
        const text: string = node.text;
        const textStart = Math.max(startDocPos, pos) - pos;
        for (let i = textStart; i < text.length; i++) charToDoc.push(pos + i);
        separated = false;
      } else if (!node.isLeaf) {
        if (!separated) { charToDoc.push(pos); separated = true; }
      }
    });

    const from = charToDoc[hlStart + trimOffset];
    const toChar = charToDoc[hlEnd - 1 + trimOffset];
    if (from == null) return;
    const to = (toChar ?? from) + 1;
    editor.view.dispatch(editor.view.state.tr.setMeta(ttsHighlightKey, { from, to }));
  }, [ttsSentenceIdx, ttsSentences, ttsWord]);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [rawContent, setRawContent] = useState(noteContentDraft);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("editor");
  const effectiveNoteId = noteId ?? persistedNoteId;
  const workspace = useSmartSourceWorkspace(effectiveNoteId);
  const hasSourceWorkspace = workspace.data.source_files.length > 0;
  const hasNoteInk = workspace.data.annotations.some((annotation) => annotation.source_file_id == null && annotation.book_id == null && annotation.strokes_json?.points.length);
  const isLegacyNote = !workspace.loading && !hasSourceWorkspace;
  const autosave = useNoteAutosave({
    noteKey: String(noteKey),
    title: noteTitleDraft,
    content: noteContentDraft,
    dirty: isNoteDirty,
    save: (key, snapshot) => onAutosave(key, snapshot, hasSourceWorkspace),
    saveOnPageExit: onAutosavePageExit,
    restore: (title, content) => {
      setNoteTitleDraft(title);
      setNoteContentDraft(content);
    },
  });

  useEffect(() => {
    setPersistedNoteId(noteId);
  }, [noteId, noteKey]);

  async function ensureNotePersisted(): Promise<number> {
    await autosave.flush();
    if (effectiveNoteId != null) return effectiveNoteId;
    const id = await onEnsurePersisted(String(noteKey), {
      title: noteTitleDraft,
      content: noteContentDraft,
      updatedAt: Date.now(),
    }, hasSourceWorkspace);
    setPersistedNoteId(id);
    return id;
  }

  async function handleEquation(action: "solve" | "complete") {
    if ((!noteContentDraft.trim() && !hasNoteInk) || equationAction) return;
    setEquationAction(action);
    setEquationError(null);
    try {
      const id = await ensureNotePersisted();
      const drawingSnapshot = inkSnapshotRef.current?.() ?? null;
      const fresh = action === "solve"
        ? await solveNoteEquation(id, aiModel, drawingSnapshot?.dataUrl, drawingSnapshot?.spacingLines)
        : await completeNoteEquation(id, aiModel, drawingSnapshot?.dataUrl, drawingSnapshot?.spacingLines);
      onEquationSolved(id, fresh);
    } catch (caught: unknown) {
      const error = caught as { response?: { data?: { detail?: unknown } }; message?: unknown };
      const detail = error.response?.data?.detail;
      setEquationError(
        typeof detail === "string"
          ? detail
          : typeof error.message === "string"
            ? error.message
            : `Could not ${action} the equation`,
      );
    } finally {
      setEquationAction(null);
    }
  }

  // Capture the raw DB content (Markdown) when the note changes,
  // before TipTap converts it to HTML via onChange
  React.useEffect(() => {
    setRawContent(noteContentDraft);
    setWorkspaceTab("editor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  function jumpToText(phrase: string) {
    if (!phrase) return;
    const editor = editorRef.current;
    if (!editor) return;
    setWorkspaceTab("editor");
    const search = phrase.slice(0, 40).toLowerCase();
    const doc = editor.state.doc;
    let found = false;
    doc.descendants((node: any, pos: number) => {
      if (found || !node.isText) return;
      const idx = (node.text as string).toLowerCase().indexOf(search);
      if (idx >= 0) {
        found = true;
        const from = pos + idx;
        const to = from + search.length;
        editor.commands.setTextSelection({ from, to });
        editor.commands.scrollIntoView();
      }
    });
  }

  async function handleExport(format: ExportFormat) {
    setShowExport(false);
    setExporting(format);
    try {
      await exportNote(noteTitleDraft || "Untitled", noteContentDraft, format);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden w-full max-w-full sm:max-w-[740px] mx-auto">

      {/* Floating TTS player — identical to the /read command player */}
      {ttsEnabled && ttsPlaying && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <TTSPlayerBar
            paused={!!ttsPaused}
            rate={ttsRate}
            voices={ttsVoices}
            selectedVoice={ttsSelectedVoice}
            onPauseResume={onTtsPauseResume ?? (() => {})}
            onStop={onTtsStop ?? (() => {})}
            onBack={onTtsBack ?? (() => {})}
            onForward={onTtsForward ?? (() => {})}
            onRateChange={onTtsRateChange ?? (() => {})}
            onVoiceChange={onTtsVoiceChange ?? (() => {})}
          />
        </div>
      )}

      {isLegacyNote && (
        <div className="mb-2 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {(["editor", "source", "timeline"] as const).map((tab) => (
              (tab !== "timeline" || (timelineEnabled && noteId)) && (
                <button
                  key={tab}
                  onClick={() => setWorkspaceTab(tab)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition ${workspaceTab === tab ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
                >
                  {tab}
                </button>
              )
            ))}
          </div>
          <div className="flex items-center gap-2">
            {effectiveNoteId && (
              <SourceUploadButton
                noteId={effectiveNoteId}
                disabled={isNoteDirty}
                onComplete={() => {
                  void workspace.reload();
                  void getNote(effectiveNoteId).then((fresh) => {
                    setNoteContentDraft(fresh.content || "");
                    setRawContent(fresh.content || "");
                  });
                }}
              />
            )}
            <FontSizePicker value={fontSize} onChange={setFontSize} />
            <ColorModePicker value={colorMode} onChange={setColorMode} />
          </div>
        </div>
      )}

      {hasSourceWorkspace ? (
        <SmartSourceWorkspace
          workspace={workspace}
          noteId={effectiveNoteId}
          noteKey={noteKey}
          rawContent={rawContent}
          activeTab={workspaceTab}
          onTabChange={setWorkspaceTab}
          onSourceChanged={() => {
            if (!effectiveNoteId) return;
            void getNote(effectiveNoteId).then((fresh) => {
              setNoteContentDraft(fresh.content || "");
              setRawContent(fresh.content || "");
            });
          }}
          sourceUploadDisabled={isNoteDirty}
          controls={<><FontSizePicker value={fontSize} onChange={setFontSize} /><ColorModePicker value={colorMode} onChange={setColorMode} /></>}
          timelineSupplement={timelineEnabled && effectiveNoteId ? <div className="border-t border-[var(--ml-bg-hover)] p-4"><TimelinePanel noteId={effectiveNoteId} onJump={jumpToText} /></div> : null}
          editor={(
            <div data-rc-mode={colorMode} style={{ filter: richContentFilter(colorMode), ...noteFontSizeVar }} className="flex h-full flex-col overflow-hidden bg-[var(--ml-bg-bar)] transition-[filter]">
              <RichNoteEditor
                key={String(noteKey)}
                noteKey={noteKey}
                value={noteContentDraft}
                onChange={(html) => setNoteContentDraft(html)}
                editorRef={editorRef}
                onOpenHighlight={onOpenHighlight}
                drawing={{
                  noteId: effectiveNoteId,
                  annotations: workspace.data.annotations,
                  onAnnotationsChanged: () => void workspace.reload(),
                  onEnsurePersisted: ensureNotePersisted,
                  inkSnapshotRef,
                }}
              />
            </div>
          )}
        />
      ) : workspaceTab === "editor" ? (
        <div
          data-rc-mode={colorMode}
          style={{ filter: richContentFilter(colorMode), ...noteFontSizeVar }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-bar)] transition-[filter]"
        >
          <RichNoteEditor
            key={String(noteKey)}
            noteKey={noteKey}
            value={noteContentDraft}
            onChange={(html) => setNoteContentDraft(html)}
            editorRef={editorRef}
            onOpenHighlight={onOpenHighlight}
            drawing={{
              noteId: effectiveNoteId,
              annotations: workspace.data.annotations,
              onAnnotationsChanged: () => void workspace.reload(),
              onEnsurePersisted: ensureNotePersisted,
              inkSnapshotRef,
            }}
          />
        </div>
      ) : workspaceTab === "source" ? (
        <div data-rc-mode={colorMode} style={{ filter: richContentFilter(colorMode) }} className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-bar)]">
          <textarea readOnly value={rawContent} style={{ fontSize: `${Math.round(12 * readerFontScale(fontSize))}px` }} className="h-full w-full resize-none bg-transparent p-4 font-mono text-gray-400 focus:outline-none" />
        </div>
      ) : (
        <div data-rc-mode={colorMode} style={{ filter: richContentFilter(colorMode) }} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--ml-bg-panel)] bg-[var(--ml-bg-bar)] p-4">
          {effectiveNoteId && <TimelinePanel noteId={effectiveNoteId} onJump={jumpToText} />}
        </div>
      )}

      {/* Bottom bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 shrink-0">

        {/* Record */}
        {recording.isRecording ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-red-400 bg-red-400/10 border border-red-400/30 animate-pulse"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              Stop &amp; Save
            </button>
            <button
              onClick={recording.pauseResumeRecording}
              className="px-2 py-1 rounded-lg text-xs text-gray-300 border border-[var(--ml-bg-hover)]"
            >
              {recording.isPaused ? "Resume" : "Pause"}
            </button>
            <span className="text-[11px] tabular-nums text-gray-500">
              {Math.floor(recording.recordingDurationSeconds / 60)}:{String(recording.recordingDurationSeconds % 60).padStart(2, "0")}
            </span>
            <span className="w-10 h-1.5 rounded-full bg-[#2b2b38] overflow-hidden" aria-hidden="true">
              <span
                className="block h-full bg-red-400 transition-[width] duration-150"
                style={{ width: `${Math.max(8, Math.min(100, recording.audioLevel * 100))}%` }}
              />
            </span>
          </div>
        ) : (
          <div className="relative shrink-0">
            {showPicker && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setShowPicker(false)} />
                <div className="absolute bottom-full left-0 mb-1 z-10 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                  <button
                    onClick={() => void startRecording("mic")}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] flex items-center gap-2 transition"
                  >
                    🎤 Microphone
                  </button>
                  <button
                    onClick={() => void startRecording("computer")}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] flex items-center gap-2 transition"
                  >
                    🖥️ Computer Audio
                  </button>
                  <div className="border-t border-[var(--ml-bg-hover)] px-3 py-2 space-y-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Capture Mode</label>
                      <select
                        value={recordMode}
                        onChange={(e) => setRecordMode(e.target.value as "default" | "lecture")}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="default">Quick Voice Note</option>
                        <option value="lecture">Lecture Capture</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Backend</label>
                      <select
                        value={recordBackend}
                        onChange={(e) => setRecordBackend(e.target.value as "auto" | "whisper" | "deepgram")}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="auto">Auto</option>
                        <option value="whisper">OpenAI Whisper</option>
                        <option value="deepgram">Deepgram</option>
                      </select>
                    </div>
                    <div>
                      <button
                        onClick={(e) => { e.stopPropagation(); if (recordMode !== "lecture") setAutoStopOnSilence((v) => !v); }}
                        className={`w-full flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition ${
                          recordMode === "lecture"
                            ? "border-[var(--ml-bg-hover)] text-gray-600 cursor-not-allowed"
                            : "border-[var(--ml-bg-hover)] text-gray-300 hover:border-indigo-500/40"
                        }`}
                      >
                        <span>Auto-stop on silence</span>
                        <span className={`relative w-9 h-5 rounded-full transition-colors ${autoStopOnSilence && recordMode !== "lecture" ? "bg-indigo-600" : "bg-[#303043]"}`}>
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoStopOnSilence && recordMode !== "lecture" ? "translate-x-4" : "translate-x-0"}`} />
                        </span>
                      </button>
                      <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                        {recordMode === "lecture"
                          ? "Disabled for lecture capture so short pauses do not end the recording."
                          : "Stops the recording after you pause, which is useful for short voice notes."}
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-[var(--ml-bg-hover)] px-3 py-2">
                    <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
            <button
              onClick={() => setShowPicker((v) => !v)}
              title={`Record and transcribe${recordMode === "lecture" ? " — Lecture mode" : ""}${language ? ` (${language})` : ""}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition shrink-0"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-6 10a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.93V21h2v2H9v-2h2v-2.07A8 8 0 0 1 4 11h2z" />
              </svg>
            </button>
          </div>
        )}

        {/* Export */}
        <div className="relative shrink-0">
          {showExport && (
            <>
              <div className="fixed inset-0 z-[9]" onClick={() => setShowExport(false)} />
              <div className="absolute bottom-full left-0 mb-1 z-10 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                <div className="px-3 py-2 border-b border-[var(--ml-bg-hover)]">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Export as…</span>
                </div>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => handleExport(f.value)}
                    className="w-full text-left px-4 py-2 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] flex items-center justify-between gap-3 transition"
                  >
                    <span>{f.label}</span>
                    <span className="text-gray-600 font-mono text-[10px]">{f.ext}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            onClick={() => setShowExport((v) => !v)}
            disabled={!noteContentDraft.trim()}
            title="Export note"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:text-emerald-400 hover:bg-emerald-400/10 border border-transparent hover:border-emerald-400/20 disabled:opacity-30 transition shrink-0"
          >
            {exporting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
                <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/>
              </svg>
            )}
          </button>
        </div>

        {/* Video Import */}
        {videoImportEnabled && <button
          onClick={() => setShowVideoImport(true)}
          title="Import from video URL"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/>
            <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/>
          </svg>
        </button>}

        <button
          onClick={() => void handleEquation("complete")}
          disabled={(!noteContentDraft.trim() && !hasNoteInk) || equationAction != null}
          title="Ask AI to complete the unfinished equation and write the result into this note"
          aria-label="Complete equation with AI"
          className="flex h-7 w-8 items-center justify-center rounded-lg text-gray-500 hover:text-violet-400 hover:bg-violet-400/10 border border-transparent hover:border-violet-400/20 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          {equationAction === "complete" ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7"/></svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h9l-5 8 5 8H5"/><path d="M17 8h4M19 6v4"/></svg>
          )}
        </button>

        <button
          onClick={() => void handleEquation("solve")}
          disabled={(!noteContentDraft.trim() && !hasNoteInk) || equationAction != null}
          title="Ask AI to solve the equation in this note step by step"
          aria-label="Solve equation with AI"
          className="flex h-7 w-8 items-center justify-center rounded-lg text-gray-500 hover:text-violet-400 hover:bg-violet-400/10 border border-transparent hover:border-violet-400/20 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          {equationAction === "solve" ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7"/></svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h2m4 0h2M8 16h2m4 0h2"/></svg>
          )}
        </button>

        {/* Public Portfolio Agent toggle */}
        {publicAgentFeatureEnabled && noteId && (
          <button
            onClick={onTogglePublicAgent}
            title={publicAgentEnabled
              ? "Public — visible to portfolio agent. Click to make private."
              : "Private — hidden from portfolio agent. Click to make public."}
            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition shrink-0 ${
              publicAgentEnabled
                ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20 hover:bg-emerald-400/20"
                : "text-gray-500 border-transparent hover:text-emerald-400 hover:bg-emerald-400/10 hover:border-emerald-400/20"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 1a2 2 0 0 1 2 2v1h2.5A1.5 1.5 0 0 1 14 5.5V13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.5A1.5 1.5 0 0 1 3.5 4H6V3a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v1h2V3a1 1 0 0 0-1-1zM3.5 5a.5.5 0 0 0-.5.5V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5a.5.5 0 0 0-.5-.5zM6 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0m4 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0"/>
            </svg>
          </button>
        )}

        {/* TTS play — the floating player bar (same as /read) handles controls while playing */}
        {ttsEnabled && onPlay && (
          ttsPlaying ? (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 shrink-0">
              <span className="flex gap-[2px] items-end h-3">
                {[0,1,2].map(i => (
                  <span key={i} className={`w-[2px] bg-indigo-400 rounded-full ${ttsPaused ? "opacity-30" : "animate-pulse"}`}
                    style={{ height: `${5 + i * 2}px`, animationDelay: `${i * 0.12}s` }} />
                ))}
              </span>
              Reading…
            </span>
          ) : (
            <button
              onClick={handlePlay}
              disabled={!noteContentDraft.trim()}
              title="Read note aloud from cursor position"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-indigo-400/10 border border-transparent hover:border-indigo-400/20 disabled:opacity-30 transition shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          )
        )}

        <span className="flex-1 text-center text-xs truncate px-1 italic">
          {recording.isTranscribing
            ? <span className="text-indigo-400 animate-pulse">Transcribing…</span>
            : recording.isRecording
              ? <span className="text-red-400/80">● Recording…</span>
              : null}
          {!recording.isRecording && !recording.isTranscribing && recordingFileStatus
            ? <span className="text-gray-500">{recordingFileStatus}</span>
            : null}
          {recording.recordingCaptureError
            ? <span className="text-amber-400">{recording.recordingCaptureError}</span>
            : null}
          {!recording.isRecording && equationError
            ? <span className="text-amber-400" title={equationError}>{equationError}</span>
            : null}
        </span>

        <span
          className={`text-xs shrink-0 ${autosave.status === "error" || autosave.status === "offline" ? "text-amber-400" : autosave.status === "saving" ? "text-indigo-400" : "text-gray-500"}`}
          title={autosave.error ?? undefined}
        >
          {autosave.status === "saving" ? "Saving…" : autosave.status === "offline" ? "Offline / pending sync" : autosave.status === "error" ? "Error saving — retrying" : "Saved"}
        </span>
      </div>

      {showVideoImport && (
        <VideoImportModal
          onClose={() => setShowVideoImport(false)}
          onImport={(title, content) => {
            if (!noteTitleDraft.trim()) setNoteTitleDraft(title);
            setNoteContentDraft(content);
          }}
        />
      )}
    </div>
  );
}
