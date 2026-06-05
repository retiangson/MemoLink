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
  agentMode: boolean;
  onToggleAgentMode: () => void;
  workflowMode: boolean;
  onToggleWorkflowMode: () => void;
  researchMode: boolean;
  onToggleResearchMode: () => void;
  flags?: {
    web_search_enabled: boolean;
    agent_mode_enabled: boolean;
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
  webSearch, onToggleWebSearch, agentMode, onToggleAgentMode, workflowMode, onToggleWorkflowMode, researchMode, onToggleResearchMode, flags, notes = [],
}: ChatInputProps) {
  const [showLangPicker, setShowLangPicker] = useState(false);
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
  // Format hint for commands that take free text (feedback, reportbug, reminder)
  const showFormatHint = !!(cmdArgsMatch && FORMAT_HINTS[commandWord.toLowerCase()] && !afterSpace.includes(" : "));
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

  const canSend = !loading && (input.trim().length > 0 || pendingFiles.length > 0);
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
    recording.startRecording("mic", lang);
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
          <div className="fixed bottom-24 right-1/2 translate-x-1/2 z-50 bg-[#1e1e2a] border border-[#2a2a38] rounded-2xl shadow-2xl overflow-hidden w-52">
            <p className="px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-[#2a2a38]">
              Select Language
            </p>
            {LANG_OPTIONS.map((l) => (
              <button
                key={l.code}
                onClick={() => startWithLang(l.code)}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-[#2a2a38] hover:text-white transition"
              >
                {l.label}
              </button>
            ))}
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
                  className="flex items-center gap-2 bg-[#1e1e2a] border border-[#2a2a38] rounded-xl px-2.5 py-1.5 max-w-[220px]"
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
            {/* Left side - attachment */}
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
                  <button
                    onClick={() => attachmentInputRef.current?.click()}
                    title="Attach file"
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-[#252533] transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </>
              )}

              {/* Web search toggle */}
              {(!flags || flags.web_search_enabled) && (
                <button
                  onClick={onToggleWebSearch}
                  title={webSearch ? "Web search on - click to disable" : "Enable web search"}
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
              )}

              {/* Agent mode toggle */}
              {(!flags || flags.agent_mode_enabled) && (
                <button
                  onClick={onToggleAgentMode}
                  title={agentMode ? "Agent mode on - AI can create notes, add reminders, and more" : "Enable Agent mode"}
                  className={`flex items-center gap-1.5 px-2.5 h-8 rounded-xl text-xs font-medium transition ${
                    agentMode
                      ? "bg-violet-500/15 border border-violet-500/40 text-violet-400 hover:bg-violet-500/25"
                      : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.134"/>
                    <path d="M8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
                  </svg>
                  {agentMode && <span>Agent</span>}
                </button>
              )}

              {/* Research mode toggle */}
              {(!flags || flags.research_mode_enabled) && <button
                onClick={onToggleResearchMode}
                title={researchMode ? "Research mode on - deep multi-source analysis with academic papers" : "Enable Research mode"}
                className={`flex items-center gap-1.5 px-2.5 h-8 rounded-xl text-xs font-medium transition ${
                  researchMode
                    ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M14.5 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5zm-13-1A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2z"/>
                  <path d="M3 5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8m0 2.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5"/>
                </svg>
                {researchMode && <span>Research</span>}
              </button>}

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
              <button
                onClick={handleMicClick}
                title={recording.isRecording ? "Stop recording" : "Voice input"}
                disabled={recording.isTranscribing || loading}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${
                  recording.isRecording
                    ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    : "text-gray-500 hover:text-gray-200 hover:bg-[#252533]"
                } disabled:opacity-40`}
              >
                {recording.isRecording ? (
                  /* Stop square */
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M3.5 3.5h9v9h-9z" />
                  </svg>
                ) : (
                  /* Microphone */
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5" />
                    <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0z" />
                  </svg>
                )}
              </button>

              {/* Send button */}
              <button
                onClick={onSend}
                disabled={!canSend}
                title="Send message"
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${
                  canSend
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/40"
                    : "bg-[#252533] text-gray-600 cursor-not-allowed"
                }`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-700 mt-2">
          Press <kbd className="bg-[#1e1e2a] border border-[#2a2a38] rounded px-1 py-0.5 text-[10px]">Enter</kbd> to send &nbsp;·&nbsp; <kbd className="bg-[#1e1e2a] border border-[#2a2a38] rounded px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for new line
        </p>
      </div>
    </footer>
  );
}
