import React, { useState } from "react";
import { RichNoteEditor } from "./RichNoteEditor";
import { exportNote, EXPORT_FORMATS } from "../utils/noteExport";
import type { ExportFormat } from "../utils/noteExport";

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
}: NoteEditorViewProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [language, setLanguage] = useState("");
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

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

      {/* Rich editor */}
      <div className="flex-1 overflow-hidden flex flex-col border border-[#1e1e2a] rounded-xl bg-[#0a0a0f]">
        <RichNoteEditor
          key={String(noteKey)}
          noteKey={noteKey}
          value={noteContentDraft}
          onChange={(html) => setNoteContentDraft(html)}
        />
      </div>

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
    </div>
  );
}
