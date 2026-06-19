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

interface NoteEditorViewProps {
  noteKey: string | number;
  noteTitleDraft: string;
  setNoteTitleDraft: (v: string | ((prev: string) => string)) => void;
  noteContentDraft: string;
  setNoteContentDraft: (v: string | ((prev: string) => string)) => void;
  isNoteDirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
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
}

export function NoteEditorView({
  noteKey,
  noteTitleDraft, setNoteTitleDraft,
  noteContentDraft, setNoteContentDraft,
  isNoteDirty, onSave, onDiscard,
  onPlay, ttsPlaying, ttsPaused, onTtsStop, onTtsPauseResume,
  onTtsBack, onTtsForward, ttsRate = 1.0, ttsVoices = [], ttsSelectedVoice = null,
  onTtsRateChange, onTtsVoiceChange,
  ttsSentenceIdx, ttsSentences, ttsWord = null,
  ttsEnabled = true, videoImportEnabled = true,
  timelineEnabled = true, noteId = null,
}: NoteEditorViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showVideoImport, setShowVideoImport] = useState(false);
  const [language, setLanguage] = useState("en");
  const [recordMode, setRecordMode] = useState<"default" | "lecture">("lecture");
  const [recordBackend, setRecordBackend] = useState<"auto" | "whisper" | "deepgram">("auto");
  const [autoStopOnSilence, setAutoStopOnSilence] = useState(false);
  const editorRef = useRef<any>(null);
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

  function stopRecording() {
    recording.stopRecording();
  }

  function startRecording(source: "mic" | "computer") {
    setShowPicker(false);
    recording.startRecording(source, {
      language,
      mode: recordMode,
      backend: recordBackend,
      autoStopOnSilence: recordMode === "lecture" ? false : autoStopOnSilence,
      silenceDurationMs: recordMode === "lecture" ? 2600 : 1500,
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
        const before = doc.textBetween(paraStart, from, " ");
        const m = before.match(/[\s\S]*[.!?\n]\s*/);
        fromPos = paraStart + (m ? m[0].length : 0);
      }
      rawDocText = doc.textBetween(fromPos, doc.content.size, " ");
      if (!rawDocText.trim()) { fromPos = 0; rawDocText = doc.textBetween(0, doc.content.size, " "); }
    } else {
      rawDocText = noteContentDraft.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
    const trimmedDocText = rawDocText.trim();
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
      <div className={`flex-1 overflow-hidden flex flex-col border border-[var(--ml-bg-panel)] rounded-xl bg-[var(--ml-bg-bar)] ${activeTab !== "editor" ? "hidden" : ""}`}>
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
        <div className="flex-1 overflow-hidden border border-[var(--ml-bg-panel)] rounded-xl bg-[var(--ml-bg-bar)]">
          <textarea
            readOnly
            value={rawContent}
            className="w-full h-full bg-transparent text-gray-400 text-xs font-mono p-4 resize-none focus:outline-none"
          />
        </div>
      )}

      {/* Timeline tab */}
      {activeTab === "timeline" && noteId && (
        <div className="flex-1 min-h-0 overflow-y-auto border border-[var(--ml-bg-panel)] rounded-xl bg-[var(--ml-bg-bar)] p-4">
          <TimelinePanel noteId={noteId} onJump={jumpToText} />
        </div>
      )}

      {/* Bottom bar */}
      <div className="mt-3 flex items-center gap-2 shrink-0">

        {/* Record */}
        {recording.isRecording ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-red-400 bg-red-400/10 border border-red-400/30 animate-pulse"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              Stop
            </button>
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
                    onClick={() => startRecording("mic")}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] flex items-center gap-2 transition"
                  >
                    🎤 Microphone
                  </button>
                  <button
                    onClick={() => startRecording("computer")}
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
              title="Record and transcribe"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-6 10a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.93V21h2v2H9v-2h2v-2.07A8 8 0 0 1 4 11h2z" />
              </svg>
              Record
              {recordMode === "lecture" && (
                <span className="ml-0.5 px-1 py-0.5 rounded bg-emerald-600/30 text-emerald-300 text-[10px] uppercase">
                  Lecture
                </span>
              )}
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
          {recording.isTranscribing
            ? <span className="text-indigo-400 animate-pulse">Transcribing…</span>
            : recording.isRecording
              ? <span className="text-red-400/80">● Recording…</span>
              : null}
        </span>

        <span className="text-xs text-gray-600 shrink-0">{isNoteDirty ? "Unsaved" : "Saved"}</span>
        <button onClick={onDiscard} disabled={!isNoteDirty} className="px-3 py-1 rounded-full text-xs border border-[var(--ml-bg-hover)] text-gray-400 disabled:opacity-30 shrink-0">
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
