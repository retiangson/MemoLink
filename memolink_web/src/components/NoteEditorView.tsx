import React, { useState, useRef, useEffect } from "react";
import { RichNoteEditor, ttsHighlightKey } from "./RichNoteEditor";
import { splitSentences } from "../hooks/useTTS";
import { exportNote, EXPORT_FORMATS } from "../utils/noteExport";
import type { ExportFormat } from "../utils/noteExport";
import { VideoImportModal } from "./VideoImportModal";
import { TimelinePanel } from "./TimelinePanel";

interface NoteEditorViewProps {
  noteKey: string | number;
  noteTitleDraft: string;
  setNoteTitleDraft: (v: string) => void;
  noteContentDraft: string;
  setNoteContentDraft: (v: string | ((prev: string) => string)) => void;
  isNoteDirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  isRecording: boolean;
  isTranscribing: boolean;
  onStartRecording: (source: "mic" | "computer", language: string) => void;
  onStopRecording: () => void;
  onPlay?: (text: string) => void;
  ttsPlaying?: boolean;
  ttsPaused?: boolean;
  onTtsStop?: () => void;
  onTtsPauseResume?: () => void;
  ttsSentenceIdx?: number;
  ttsSentences?: string[];
  ttsEnabled?: boolean;
  videoImportEnabled?: boolean;
  timelineEnabled?: boolean;
  noteId?: number | null;
}

const LANGUAGES = [
  { code: "",   label: "Auto Detect" },
  { code: "en", label: "English" },
  { code: "mi", label: "Māori" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" },
  { code: "tl", label: "Tagalog" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
];

export function NoteEditorView({
  noteKey,
  noteTitleDraft, setNoteTitleDraft,
  noteContentDraft, setNoteContentDraft,
  isNoteDirty, onSave, onDiscard,
  isRecording, isTranscribing, onStartRecording, onStopRecording,
  onPlay, ttsPlaying, ttsPaused, onTtsStop, onTtsPauseResume,
  ttsSentenceIdx, ttsSentences,
  ttsEnabled = true, videoImportEnabled = true,
  timelineEnabled = true, noteId = null,
}: NoteEditorViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showVideoImport, setShowVideoImport] = useState(false);
  const editorRef = useRef<any>(null);
  const speakStartDocPos = useRef(0);
  const speakDocText = useRef("");
  const speakDocTrimOffset = useRef(0);
  const speakDocSentenceOffset = useRef(0);

  function handlePlay() {
    if (!onPlay) return;
    const editor = editorRef.current;
    let fromPos = 0;
    let rawDocText = "";
    if (editor) {
      const { from } = editor.state.selection;
      const doc = editor.state.doc;
      fromPos = from <= 1 ? 0 : from;
      rawDocText = doc.textBetween(fromPos, doc.content.size, " ");
      if (!rawDocText.trim()) { fromPos = 0; rawDocText = doc.textBetween(0, doc.content.size, " "); }
    } else {
      rawDocText = noteContentDraft.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
    const trimmedDocText = rawDocText.trim();
    speakStartDocPos.current = fromPos;
    speakDocTrimOffset.current = rawDocText.length - rawDocText.trimStart().length;
    speakDocText.current = trimmedDocText;
    const titlePrefix = noteTitleDraft ? `${noteTitleDraft}. ` : "";
    if (titlePrefix && trimmedDocText) {
      const allSents = splitSentences(titlePrefix + trimmedDocText);
      const docSents = splitSentences(trimmedDocText);
      speakDocSentenceOffset.current = allSents.length - docSents.length;
    } else {
      speakDocSentenceOffset.current = 0;
    }
    onPlay(titlePrefix + trimmedDocText);
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
    const sentenceEnd = sentenceStart + docSentences[docSentenceIdx].length;
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

    const from = charToDoc[sentenceStart + trimOffset];
    const toChar = charToDoc[sentenceEnd - 1 + trimOffset];
    if (from == null) return;
    const to = (toChar ?? from) + 1;
    editor.view.dispatch(editor.view.state.tr.setMeta(ttsHighlightKey, { from, to }));
  }, [ttsSentenceIdx, ttsSentences]);
  const [language, setLanguage] = useState("");
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [activeTab, setActiveTab] = useState<"editor" | "source" | "timeline">("editor");
  const [rawContent, setRawContent] = useState(noteContentDraft);

  // Capture the raw DB content (Markdown) when the note changes,
  // before TipTap converts it to HTML via onChange
  React.useEffect(() => {
    setRawContent(noteContentDraft);
    setActiveTab("editor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  function jumpToText(phrase: string) {
    if (!phrase) return;
    const editor = editorRef.current;
    if (!editor) return;
    // Switch to editor tab first so the ProseMirror view is visible
    setActiveTab("editor");
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
    <div className="flex-1 flex flex-col overflow-hidden w-full max-w-[740px] mx-auto">

      {/* Title */}
      <input
        value={noteTitleDraft}
        onChange={(e) => setNoteTitleDraft(e.target.value)}
        placeholder="Note title…"
        className="w-full bg-transparent border-b border-[#1e1e2a] pb-2 mb-3 text-lg text-indigo-200 focus:outline-none focus:border-indigo-500 shrink-0"
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-2 shrink-0">
        <button
          onClick={() => setActiveTab("editor")}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition ${activeTab === "editor" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
        >
          Editor
        </button>
        <button
          onClick={() => setActiveTab("source")}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition ${activeTab === "source" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
        >
          Source
        </button>
        {timelineEnabled && noteId && (
          <button
            onClick={() => setActiveTab("timeline")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition ${activeTab === "timeline" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/>
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>
            </svg>
            Timeline
          </button>
        )}
      </div>

      {/* Rich editor */}
      <div className={`flex-1 overflow-hidden flex flex-col border border-[#1e1e2a] rounded-xl bg-[#0a0a0f] ${activeTab !== "editor" ? "hidden" : ""}`}>
        <RichNoteEditor
          key={String(noteKey)}
          noteKey={noteKey}
          value={noteContentDraft}
          onChange={(html) => setNoteContentDraft(html)}
          editorRef={editorRef}
        />
      </div>

      {/* Source view */}
      {activeTab === "source" && (
        <div className="flex-1 overflow-hidden border border-[#1e1e2a] rounded-xl bg-[#0a0a0f]">
          <textarea
            readOnly
            value={rawContent}
            className="w-full h-full bg-transparent text-gray-400 text-xs font-mono p-4 resize-none focus:outline-none"
          />
        </div>
      )}

      {/* Timeline tab */}
      {activeTab === "timeline" && noteId && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col border border-[#1e1e2a] rounded-xl bg-[#0a0a0f] p-4">
          <TimelinePanel noteId={noteId} onJump={jumpToText} />
        </div>
      )}

      {/* Bottom bar */}
      <div className="mt-3 flex items-center gap-2 shrink-0">

        {/* Record */}
        {isRecording ? (
          <button
            onClick={onStopRecording}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-red-400 bg-red-400/10 border border-red-400/30 animate-pulse shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            Stop
          </button>
        ) : (
          <div className="relative shrink-0">
            {showPicker && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setShowPicker(false)} />
                <div className="absolute bottom-full left-0 mb-1 z-10 bg-[#1e1e2a] border border-[#2a2a38] rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                  <button
                    onClick={() => { setShowPicker(false); onStartRecording("mic", language); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-[#2a2a38] flex items-center gap-2 transition"
                  >
                    🎤 Microphone
                  </button>
                  <button
                    onClick={() => { setShowPicker(false); onStartRecording("computer", language); }}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-[#2a2a38] flex items-center gap-2 transition"
                  >
                    🖥️ Computer Audio
                  </button>
                  <div className="border-t border-[#2a2a38] px-3 py-2">
                    <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-[#0f0f13] border border-[#2a2a38] text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500"
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
              title="Record and transcribe"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-6 10a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.93V21h2v2H9v-2h2v-2.07A8 8 0 0 1 4 11h2z" />
              </svg>
              Record
              {language && (
                <span className="ml-0.5 px-1 py-0.5 rounded bg-indigo-600/30 text-indigo-300 text-[10px] uppercase">
                  {language}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Export */}
        <div className="relative shrink-0">
          {showExport && (
            <>
              <div className="fixed inset-0 z-[9]" onClick={() => setShowExport(false)} />
              <div className="absolute bottom-full left-0 mb-1 z-10 bg-[#1e1e2a] border border-[#2a2a38] rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                <div className="px-3 py-2 border-b border-[#2a2a38]">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Export as…</span>
                </div>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => handleExport(f.value)}
                    className="w-full text-left px-4 py-2 text-xs text-gray-300 hover:bg-[#2a2a38] flex items-center justify-between gap-3 transition"
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
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-emerald-400 hover:bg-emerald-400/10 border border-transparent hover:border-emerald-400/20 disabled:opacity-30 transition"
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
            Export
          </button>
        </div>

        {/* Video Import */}
        {videoImportEnabled && <button
          onClick={() => setShowVideoImport(true)}
          title="Import from video URL"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/>
            <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/>
          </svg>
          Video
        </button>}

        {/* TTS play / stop */}
        {ttsEnabled && onPlay && (
          ttsPlaying ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onTtsPauseResume}
                title={ttsPaused ? "Resume" : "Pause"}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 hover:bg-indigo-400/20 transition"
              >
                {ttsPaused ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                )}
                {ttsPaused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={onTtsStop}
                title="Stop reading"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
              >
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                Stop
              </button>
            </div>
          ) : (
            <button
              onClick={handlePlay}
              disabled={!noteContentDraft.trim()}
              title="Read note aloud from cursor position"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-indigo-400 hover:bg-indigo-400/10 border border-transparent hover:border-indigo-400/20 disabled:opacity-30 transition shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Read
            </button>
          )
        )}

        <span className="flex-1 text-center text-xs truncate px-1 italic">
          {isTranscribing
            ? <span className="text-indigo-400 animate-pulse">Transcribing…</span>
            : isRecording
              ? <span className="text-red-400/80">● Recording…</span>
              : null}
        </span>

        <span className="text-xs text-gray-600 shrink-0">{isNoteDirty ? "Unsaved" : "Saved"}</span>
        <button onClick={onDiscard} disabled={!isNoteDirty} className="px-3 py-1 rounded-full text-xs border border-[#2a2a38] text-gray-400 disabled:opacity-30 shrink-0">
          Discard
        </button>
        <button onClick={onSave} disabled={!isNoteDirty} className="px-4 py-1 rounded-full text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
          Save
        </button>
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
