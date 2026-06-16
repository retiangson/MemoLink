import React, { useEffect, useState } from "react";
import { useRecording } from "../hooks/useRecording";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { SLASH_COMMANDS } from "../constants/slashCommands";
import { NotePickerForCommand } from "./NotePickerForCommand";
import { CommandFormatHint, NOTE_COMMANDS, FORMAT_HINTS } from "./CommandFormatHint";
import type { Note } from "../types";

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  pendingFiles: File[];
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: React.RefObject<HTMLInputElement | null>;
  onSend: () => void;
  autoResize: () => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  workflowMode: boolean;
  onToggleWorkflowMode: () => void;
  discussionMode: boolean;
  onToggleDiscussionMode: () => void;
  flags?: {
    web_search_enabled: boolean;
    file_upload_enabled: boolean;
    research_mode_enabled: boolean;
    slash_commands_enabled: boolean;
    workflow_enabled?: boolean;
  };
  notes?: Note[];
}

const ALL_SUPPORT = new Set(["improve","enhance","summarize","quiz","discussion"]);

export function ChatInput({
  input, setInput, loading, pendingFiles, setPendingFiles,
  textareaRef, attachmentInputRef, onSend, autoResize,
  webSearch, onToggleWebSearch, workflowMode, onToggleWorkflowMode,
  discussionMode, onToggleDiscussionMode,
  flags, notes = [],
}: ChatInputProps) {
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [autoStopOnSilence, setAutoStopOnSilence] = useState(true);
  const [slashPickerIndex, setSlashPickerIndex] = useState(0);
  const [notePickerIndex, setNotePickerIndex] = useState(0);

  // Stage 1: command picker - /something with no space
  const SLASH_PICKER_VISIBLE = (flags?.slash_commands_enabled !== false) && input.startsWith("/") && !input.slice(1).includes(" ");
  const slashFilter = SLASH_PICKER_VISIBLE ? input.slice(1).toLowerCase() : "";
  const filteredSlashCmds = SLASH_COMMANDS.filter(
    (c) => !slashFilter || c.cmd.toLowerCase().startsWith(slashFilter)
  );
  const clampedSlashIdx = Math.min(slashPickerIndex, Math.max(0, filteredSlashCmds.length - 1));

  // Stage 2: note picker - /Command <text> where note not yet fully selected
  const cmdArgsMatch = /^\/(\w+)\s+(.*)$/.exec(input);
  const commandWord = cmdArgsMatch?.[1] ?? "";
  const afterSpace  = cmdArgsMatch?.[2] ?? "";
  // Hide once note is selected: complete "..." or All
  const noteAlreadySelected = /^"[^"]+"/.test(afterSpace) || /^All(\s|$)/i.test(afterSpace);
  // Note picker only for commands that take note names
  const showNotePicker = !!(cmdArgsMatch && !noteAlreadySelected && NOTE_COMMANDS.has(commandWord.toLowerCase()));
  // Format hint for commands that take free text (feedback, reportbug, reminder, write)
  // For /write: hide once the user has typed 3+ words (they know what they're doing)
  const _freeTextTyped = commandWord.toLowerCase() === "write"
    ? afterSpace.trim().split(/\s+/).length < 3
    : !afterSpace.includes(" : ");
  const showFormatHint = !!(cmdArgsMatch && FORMAT_HINTS[commandWord.toLowerCase()] && _freeTextTyped);
  const noteQuery = afterSpace; // raw typed text = filter

  // Build ordered picker items so ChatInput and NotePickerForCommand agree on indices
  const showAllOption = ALL_SUPPORT.has(commandWord.toLowerCase()) &&
    (!noteQuery || "all".includes(noteQuery.toLowerCase()));
  const filteredNotes = notes
    .filter(n => !noteQuery || (n.title ?? "").toLowerCase().includes(noteQuery.toLowerCase()))
    .slice(0, 25);
  const pickerItems: string[] = [
    ...(showAllOption ? ["__ALL__"] : []),
    ...filteredNotes.map(n => n.title ?? "Untitled"),
  ];
  const clampedIdx = Math.min(notePickerIndex, Math.max(0, pickerItems.length - 1));

  useEffect(() => { setSlashPickerIndex(0); }, [slashFilter, SLASH_PICKER_VISIBLE]);
  useEffect(() => { setNotePickerIndex(0); }, [noteQuery, showNotePicker]);

  function handleNoteSelect(raw: string) {
    const cmdWord = /^\/\w+/.exec(input)?.[0] ?? "";
    setInput(raw === "__ALL__" ? `${cmdWord} All` : `${cmdWord} "${raw}"`);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // Voice recording for chat - appends transcribed text to the input
  const recording = useRecording((text) => {
    setInput((input ? input + " " : "") + text);
  });

  // Auto-resize whenever input changes (e.g. after voice transcription)
  useEffect(() => { autoResize(); }, [input]);

  const canSend = input.trim().length > 0 || pendingFiles.length > 0;
  const isBusy = loading;
  const isActive = recording.isRecording || recording.isTranscribing;

  function handleMicClick() {
    if (recording.isRecording) {
      recording.stopRecording();
    } else {
      setShowLangPicker(true);
    }
  }

  function startWithLang(lang: string) {
    setShowLangPicker(false);
    recording.startRecording("mic", {
      language: lang,
      autoStopOnSilence,
      silenceDurationMs: 1400,
    });
  }

  const LANG_OPTIONS = [
    { code: "", label: "Auto-detect" },
    { code: "en", label: "English" },
    { code: "mi", label: "Māori" },
    { code: "zh", label: "Chinese" },
    { code: "ja", label: "Japanese" },
    { code: "ko", label: "Korean" },
    { code: "es", label: "Spanish" },
    { code: "fr", label: "French" },
    { code: "de", label: "German" },
    { code: "tl", label: "Tagalog" },
  ];

  return (
    <footer id="tour-chat-input" className="px-4 pb-4 pt-2">
      {showLangPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowLangPicker(false)} />
          <div className="fixed bottom-24 right-1/2 translate-x-1/2 z-50 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-2xl shadow-2xl overflow-hidden w-56">
            <p className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-[var(--ml-bg-hover)]">
              Select Language
            </p>
            {LANG_OPTIONS.map((l) => (
              <button
                key={l.code}
                onClick={() => startWithLang(l.code)}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-[var(--ml-bg-hover)] hover:text-white transition"
              >
                {l.label}
              </button>
            ))}
            <div className="border-t border-[var(--ml-bg-hover)] px-4 py-3">
              <button
                onClick={() => setAutoStopOnSilence((v) => !v)}
                className="w-full flex items-center justify-between text-xs text-gray-300"
              >
                <span>Auto-stop on silence</span>
                <span className={`relative w-9 h-5 rounded-full transition-colors ${autoStopOnSilence ? "bg-indigo-600" : "bg-[#303043]"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoStopOnSilence ? "translate-x-4" : "translate-x-0"}`} />
                </span>
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                Best for short voice replies. MemoLink stops after you pause instead of waiting for a second tap.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="max-w-full sm:max-w-[740px] mx-auto relative">
        {/* Stage 1: command name picker */}
        {SLASH_PICKER_VISIBLE && (
          <SlashCommandPicker
            query={input}
            activeIndex={clampedSlashIdx}
            onSelect={(syntax) => {
              const cmdWord = /^\/\w+/.exec(syntax)?.[0] ?? syntax;
              setInput(`${cmdWord} `);
              setSlashPickerIndex(0);
              setNotePickerIndex(0);
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            onClose={() => setInput("")}
          />
        )}
        {/* Stage 2: note/All picker - only for note commands */}
        {showNotePicker && !SLASH_PICKER_VISIBLE && (
          <NotePickerForCommand
            command={commandWord}
            query={noteQuery}
            notes={notes}
            activeIndex={clampedIdx}
            onSelect={handleNoteSelect}
            onClose={() => { const w = /^\/\w+/.exec(input)?.[0] ?? ""; setInput(w); }}
          />
        )}
        {/* Stage 2: format hint - for commands that take free text */}
        {showFormatHint && !SLASH_PICKER_VISIBLE && (
          <CommandFormatHint
            command={commandWord}
            onClose={() => {}}
          />
        )}
        <div
          className="bg-[#15151e] rounded-2xl border border-[#252533] focus-within:border-indigo-600/50 shadow-xl transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); setPendingFiles((p) => [...p, ...Array.from(e.dataTransfer.files)]); }}
        >
          {/* Pending file chips - inside the box */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {pendingFiles.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl px-2.5 py-1.5 max-w-[220px]"
                >
                  {file.type.startsWith("image/") ? (
                    <img src={URL.createObjectURL(file)} alt={file.name} className="w-6 h-6 rounded object-cover" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z" />
                    </svg>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-gray-200 truncate leading-tight">{file.name}</span>
                    <span className="text-[10px] text-gray-500">{Math.round(file.size / 1024)} KB</span>
                  </div>
                  <button
                    onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                    className="shrink-0 text-gray-600 hover:text-red-400 transition ml-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={(e) => {
              // Arrow navigation - slash command picker
              if (SLASH_PICKER_VISIBLE && filteredSlashCmds.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSlashPickerIndex(i => Math.min(i + 1, filteredSlashCmds.length - 1)); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setSlashPickerIndex(i => Math.max(0, i - 1)); return; }
              }

              // Arrow navigation - note picker
              if (showNotePicker && pickerItems.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); setNotePickerIndex(i => Math.min(i + 1, pickerItems.length - 1)); return; }
                if (e.key === "ArrowUp")   { e.preventDefault(); setNotePickerIndex(i => Math.max(0, i - 1)); return; }
              }

              if (e.key === "Tab") {
                e.preventDefault();
                if (SLASH_PICKER_VISIBLE && filteredSlashCmds.length > 0) {
                  const match = filteredSlashCmds[clampedSlashIdx];
                  setInput(`/${match.cmd} `); setSlashPickerIndex(0); setNotePickerIndex(0);
                  return;
                }
                if (showNotePicker && pickerItems.length > 0) {
                  handleNoteSelect(pickerItems[clampedIdx]);
                  return;
                }
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (SLASH_PICKER_VISIBLE && filteredSlashCmds.length > 0) {
                  const match = filteredSlashCmds[clampedSlashIdx];
                  setInput(`/${match.cmd} `); setSlashPickerIndex(0); setNotePickerIndex(0);
                  return;
                }
                if (showNotePicker && pickerItems.length > 0) {
                  handleNoteSelect(pickerItems[clampedIdx]);
                  return;
                }
                onSend();
                return;
              }

              if (e.key === "Escape" && input.startsWith("/")) { setInput(""); return; }
              autoResize();
            }}
            rows={1}
            placeholder={
              recording.isRecording
                ? "Listening… speak now"
                : recording.isTranscribing
                  ? "Transcribing…"
                  : "Message MemoLink…"
            }
            className="w-full bg-transparent text-gray-100 placeholder-gray-600 resize-none outline-none text-[15px] leading-relaxed px-4 pt-3.5 pb-2"
            style={{ maxHeight: "200px", overflow: "auto" }}
          />

          {/* Toolbar row */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            {/* Left side - attachment + mode toggles */}
            <div className="flex items-center gap-1">
              {(!flags || flags.file_upload_enabled) && (
                <>
                  <input
                    type="file"
                    multiple
                    hidden
                    ref={attachmentInputRef}
                    onChange={(e) => {
                      if (e.target.files) {
                        setPendingFiles((p) => [...p, ...Array.from(e.target.files!)]);
                        e.target.value = "";
                      }
                    }}
                  />
                  <div className="relative group">
                    <button
                      onClick={() => attachmentInputRef.current?.click()}
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-[#252533] transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                      Attach file
                    </span>
                  </div>
                </>
              )}

              {/* Web search toggle */}
              {(!flags || flags.web_search_enabled) && (
                <div className="relative group">
                  <button
                    onClick={onToggleWebSearch}
                    className={`flex items-center gap-1.5 px-2.5 h-8 rounded-xl text-xs font-medium transition ${
                      webSearch
                        ? "bg-sky-500/15 border border-sky-500/40 text-sky-400 hover:bg-sky-500/25"
                        : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10" />
                      <path strokeLinecap="round" d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    {webSearch && <span>Web</span>}
                  </button>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                    {webSearch ? "Web search on" : "Web search"}
                  </span>
                </div>
              )}

              {/* Discussion mode toggle */}
              <div className="relative group">
                <button
                  onClick={onToggleDiscussionMode}
                  className={`flex items-center gap-1.5 px-2.5 h-8 rounded-xl text-xs font-medium transition ${
                    discussionMode
                      ? "bg-rose-500/15 border border-rose-500/40 text-rose-400 hover:bg-rose-500/25"
                      : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/>
                    <path d="M3 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 6m0 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5"/>
                  </svg>
                  {discussionMode && <span>Discussion</span>}
                </button>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                  {discussionMode ? "Discussion mode on" : "Discussion mode"}
                </span>
              </div>

              {/* Recording status label */}
              {isActive && (
                <span className="text-[11px] text-gray-500 ml-1 flex items-center gap-1.5">
                  {recording.isRecording ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                      Recording
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                      Transcribing…
                    </>
                  )}
                </span>
              )}
            </div>

            {/* Right side - mic + send */}
            <div className="flex items-center gap-2">
              {/* Mic button */}
              <div className="relative group">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleMicClick}
                    disabled={recording.isTranscribing || loading}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${
                      recording.isRecording
                        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                        : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                    } disabled:opacity-40`}
                  >
                    {recording.isRecording ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M3.5 3.5h9v9h-9z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5" />
                        <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0z" />
                      </svg>
                    )}
                  </button>
                  {recording.isRecording && (
                    <span className="w-8 h-1.5 rounded-full bg-[#2b2b38] overflow-hidden" aria-hidden="true">
                      <span
                        className="block h-full bg-red-400 transition-[width] duration-150"
                        style={{ width: `${Math.max(10, Math.min(100, recording.audioLevel * 100))}%` }}
                      />
                    </span>
                  )}
                </div>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                  {recording.isRecording ? (autoStopOnSilence ? "Recording - auto-stop on pause" : "Stop recording") : "Voice input"}
                </span>
              </div>

              {/* Send button */}
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => { void onSend(); }}
                  disabled={!canSend}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${
                    isBusy
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
                      : canSend
                      ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/40"
                      : "bg-[#252533] text-gray-600 cursor-not-allowed"
                  }`}
                >
                  {isBusy ? (
                    <span className="inline-block w-4 h-4 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                    </svg>
                  )}
                </button>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-[10px] text-white bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded whitespace-nowrap hidden group-hover:block pointer-events-none z-50">
                  {isBusy ? "Working..." : "Send"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-700 mt-2">
          Press <kbd className="bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded px-1 py-0.5 text-[10px]">Enter</kbd> to send &nbsp;·&nbsp; <kbd className="bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for new line
        </p>
      </div>
    </footer>
  );
}
