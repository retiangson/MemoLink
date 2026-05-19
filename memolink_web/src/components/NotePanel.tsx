import React, { useState } from "react";
import NoteToolbar from "./NoteToolbar";
import MarkdownRenderer from "./MarkdownRenderer";

interface TabInfo {
  titleDraft: string;
}

interface NotePanelProps {
  tabs: TabInfo[];
  activeIndex: number;
  onTabClick: (i: number) => void;
  onTabClose: (i: number) => void;
  noteTitleDraft: string;
  setNoteTitleDraft: (v: string) => void;
  noteContentDraft: string;
  setNoteContentDraft: (v: string) => void;
  isNoteDirty: boolean;
  noteTab: "raw" | "formatted";
  setNoteTab: (tab: "raw" | "formatted") => void;
  onSave: () => void;
  onDiscard: () => void;
  onFormat: (type: string) => void;
  isRecording: boolean;
  isTranscribing: boolean;
  onStartRecording: (source: "mic" | "computer", language: string) => void;
  onStopRecording: () => void;
  width: number;
  onResizeStart: () => void;
}

export function NotePanel({
  tabs, activeIndex, onTabClick, onTabClose,
  noteTitleDraft, setNoteTitleDraft,
  noteContentDraft, setNoteContentDraft,
  isNoteDirty, noteTab, setNoteTab,
  onSave, onDiscard, onFormat,
  isRecording, isTranscribing, onStartRecording, onStopRecording,
  width, onResizeStart,
}: NotePanelProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [language, setLanguage] = useState("");

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

  return (
    <>
      <div
        className="w-[4px] cursor-col-resize bg-[#1e1e2a] hover:bg-indigo-600/40 rounded-full self-stretch transition"
        onMouseDown={onResizeStart}
      />
      <div
        className="flex flex-col bg-[#0f0f13] border border-[#1e1e2a] rounded-2xl overflow-hidden"
        style={{ width }}
      >
        {/* Tabs row */}
        <div className="flex overflow-x-auto border-b border-[#1e1e2a] shrink-0 bg-[#0a0a0f]">
          {tabs.map((tab, i) => (
            <div
              key={i}
              onClick={() => onTabClick(i)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer shrink-0 border-b-2 transition-all ${
                i === activeIndex
                  ? "border-indigo-500 text-white bg-[#0f0f13]"
                  : "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#0f0f13]/60"
              }`}
            >
              <span className="max-w-[110px] truncate">
                {tab.titleDraft.trim() || "Untitled"}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onTabClose(i); }}
                className="text-gray-600 hover:text-gray-300 leading-none transition w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-[#2a2a38]"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Panel content */}
        <div className="flex flex-col flex-1 p-4 overflow-hidden">
          {/* Title */}
          <input
            value={noteTitleDraft}
            onChange={(e) => setNoteTitleDraft(e.target.value)}
            placeholder="Note title…"
            className="w-full bg-transparent border-b border-[#1e1e2a] pb-1 mb-3 text-sm text-indigo-200 focus:outline-none focus:border-indigo-500"
          />

          {/* Raw / Formatted tabs */}
          <div className="flex gap-1 border-b border-[#1e1e2a] mb-3">
            {(["raw", "formatted"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setNoteTab(tab)}
                className={`px-3 py-1 text-xs rounded-t-md capitalize transition ${noteTab === tab ? "bg-[#1e1e2a] text-white" : "text-gray-500 hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Raw editor */}
          {noteTab === "raw" && (
            <>
              <NoteToolbar onFormat={onFormat} />
              <textarea
                value={noteContentDraft}
                onChange={(e) => setNoteContentDraft(e.target.value)}
                className={`flex-1 w-full bg-transparent text-sm text-gray-100 resize-none focus:outline-none rounded-md p-2 border transition ${
                  isRecording ? "border-red-500/40" : "border-[#1e1e2a] focus:border-indigo-600/50"
                }`}
                placeholder="Write your note in Markdown…"
              />
            </>
          )}

          {/* Formatted preview */}
          {noteTab === "formatted" && (
            <div className="flex-1 overflow-auto border border-[#1e1e2a] rounded-md p-3 bg-[#080809]">
              <MarkdownRenderer>{noteContentDraft}</MarkdownRenderer>
            </div>
          )}

          {/* Bottom bar */}
          <div className="mt-3 flex items-center gap-2">
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

            <span className="flex-1 text-center text-xs truncate px-1 italic">
              {isTranscribing
                ? <span className="text-indigo-400 animate-pulse">Transcribing…</span>
                : isRecording
                  ? <span className="text-red-400/80">● Recording…</span>
                  : null}
            </span>

            <span className="text-xs text-gray-600 shrink-0">{isNoteDirty ? "Unsaved" : "Saved"}</span>
            <button
              onClick={onDiscard}
              disabled={!isNoteDirty}
              className="px-3 py-1 rounded-full text-xs border border-[#2a2a38] text-gray-400 disabled:opacity-30 shrink-0"
            >
              Discard
            </button>
            <button
              onClick={onSave}
              disabled={!isNoteDirty}
              className="px-4 py-1 rounded-full text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
