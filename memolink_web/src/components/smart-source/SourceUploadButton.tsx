import React, { useRef, useState } from "react";
import { api } from "../../api/client";
import { smartSourceErrorMessage, type SourceFileMetadata } from "../../api/smartSourceApi";

export function SourceUploadButton({ noteId, onComplete, disabled = false }: { noteId: number; onComplete: () => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "extracting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setStatus("uploading");
    const form = new FormData();
    form.append("note_id", String(noteId));
    form.append("file", file);
    try {
      const source = (await api.post<SourceFileMetadata>("/source-files/upload-to-onedrive", form)).data;
      setStatus("extracting");
      try { await api.post(`/source-files/${source.id}/extract`); } catch (extractError: unknown) {
        setError(smartSourceErrorMessage(extractError, "Original uploaded; text extraction was not available for this file."));
      }
      setStatus("idle");
      onComplete();
    } catch (uploadError: unknown) {
      setError(smartSourceErrorMessage(uploadError, "Could not upload this source"));
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.txt,.md,.csv,.epub,.mobi,image/*,audio/*,video/mp4" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      {error && <span className="max-w-48 truncate text-[11px] text-amber-400" title={error}>{error}</span>}
      <button title={disabled ? "Save note edits before uploading a source" : "Upload original source to OneDrive"} onClick={() => inputRef.current?.click()} disabled={disabled || status === "uploading" || status === "extracting"} className="whitespace-nowrap rounded-lg border border-indigo-500/30 px-2 py-1 text-[11px] text-indigo-400 disabled:opacity-50">
        {status === "uploading" ? "Uploading to OneDrive…" : status === "extracting" ? "Extracting…" : "Upload source"}
      </button>
    </div>
  );
}
