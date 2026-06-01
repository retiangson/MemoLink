import React, { useState, useRef } from "react";
import { uploadNotes } from "../api/chatApi";

interface Props {
  setNotes?: React.Dispatch<React.SetStateAction<any[]>>;
  workspaceId?: number | null;
  onUploaded?: (notes: any[]) => void;
}

export function UploadNotes({ setNotes, workspaceId, onUploaded }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [failures, setFailures] = useState<{ filename: string; reason: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function processFiles(files: File[]) {
    setLoading(true);
    setStatus("Processing...");
    setFailures([]);
    try {
      const result = await uploadNotes(files, workspaceId);
      const notes = result.notes ?? [];
      const failed = result.failed ?? [];
      setStatus(`${notes.length} note(s) imported${failed.length ? `, ${failed.length} failed` : ""}.`);
      setFailures(failed);
      if (setNotes && notes.length) setNotes((prev) => [...notes, ...prev]);
      if (onUploaded && notes.length) onUploaded(notes);
    } catch {
      setStatus("Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="border border-dashed border-[#3a3a4a] bg-[#16161d] rounded-lg p-4 text-center cursor-pointer hover:bg-[#1e1e2a] transition"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); processFiles(Array.from(e.dataTransfer.files)); }}
      >
        <p className="text-gray-300 text-sm font-medium">Upload Notes</p>
        <p className="text-gray-500 text-xs mt-0.5">txt, md, pdf, docx, pptx, html, mp3, mp4, wav…</p>
      </div>
      <input type="file" multiple hidden accept=".txt,.md,.html,.htm,.pdf,.docx,.pptx,.zip,.mp3,.mp4,.m4a,.mp4a,.wav,.webm,.ogg,.flac,.avi,.mpeg" ref={fileInputRef} onChange={(e) => { if (e.target.files) processFiles(Array.from(e.target.files)); }} />
      {loading && (
        <div className="flex items-center gap-2 text-xs text-indigo-400">
          <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Importing notes…
        </div>
      )}
      {!loading && status && <p className="text-xs text-gray-400">{status}</p>}
      {!loading && failures.length > 0 && (
        <div className="mt-1 space-y-1">
          {failures.map((f, i) => (
            <p key={i} className="text-xs text-red-400 break-words" title={f.reason}>
              ✗ {f.filename}: {f.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
