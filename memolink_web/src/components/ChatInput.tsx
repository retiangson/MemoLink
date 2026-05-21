import React, { useEffect, useState } from "react";
import { useRecording } from "../hooks/useRecording";

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
}

export function ChatInput({
  input, setInput, loading, pendingFiles, setPendingFiles,
  textareaRef, attachmentInputRef, onSend, autoResize,
}: ChatInputProps) {
  const [showLangPicker, setShowLangPicker] = useState(false);

  // Voice recording for chat — appends transcribed text to the input
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
    <footer className="px-4 pb-4 pt-2">
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

      <div className="max-w-[740px] mx-auto">
        <div
          className="bg-[#15151e] rounded-2xl border border-[#252533] focus-within:border-indigo-600/50 shadow-xl transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); setPendingFiles((p) => [...p, ...Array.from(e.dataTransfer.files)]); }}
        >
          {/* Pending file chips — inside the box */}
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
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); return; }
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
            {/* Left side — attachment */}
            <div className="flex items-center gap-1">
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

            {/* Right side — mic + send */}
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
