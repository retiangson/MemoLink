import React from "react";

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
  return (
    <footer className="border-t border-[#1e1e2a] p-4">
      <div className="max-w-[740px] mx-auto flex flex-col gap-2">
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((file, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#1e1e2a] border border-[#2a2a38] rounded-xl px-2 py-1.5 max-w-[240px]">
                {file.type.startsWith("image/") ? (
                  <img src={URL.createObjectURL(file)} alt={file.name} className="w-7 h-7 rounded object-cover" />
                ) : (
                  <span className="text-sm">📎</span>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-gray-200 truncate">{file.name}</span>
                  <span className="text-[10px] text-gray-500">{Math.round(file.size / 1024)} KB</span>
                </div>
                <button
                  onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                  className="text-gray-500 hover:text-red-400 text-xs ml-1"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        <div
          className="bg-[#1e1e2a] rounded-2xl px-4 py-2 flex items-end shadow-md relative border border-[#2a2a38] focus-within:border-indigo-600/50 transition"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); setPendingFiles((p) => [...p, ...Array.from(e.dataTransfer.files)]); }}
        >
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
            className="w-7 h-7 rounded-full bg-[#2a2a38] flex items-center justify-center absolute left-3 bottom-3 text-gray-400 hover:text-white text-sm transition"
          >
            +
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); return; }
              autoResize();
            }}
            rows={1}
            placeholder="Message MemoLink…"
            style={{
              flex: 1, width: "100%", background: "transparent", resize: "none",
              border: "none", outline: "none", color: "white", fontSize: "15px",
              lineHeight: "1.5", paddingLeft: "40px", paddingRight: "42px",
              paddingTop: "10px", paddingBottom: "10px", maxHeight: "200px", overflow: "hidden",
            }}
          />
          <button
            onClick={onSend}
            disabled={loading || (!input.trim() && pendingFiles.length === 0)}
            style={{
              position: "absolute", right: "12px", bottom: "12px",
              width: "30px", height: "30px", borderRadius: "50%",
              border: "none",
              background: (input.trim() || pendingFiles.length) ? "#6366f1" : "#2a2a38",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: input.trim() ? "pointer" : "not-allowed",
              opacity: loading ? 0.5 : 1,
            }}
          >
            <svg style={{ width: "16px", height: "16px", fill: "white" }} viewBox="0 0 24 24">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}
