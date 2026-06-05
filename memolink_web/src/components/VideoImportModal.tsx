import React, { useState, useRef, useEffect } from "react";
import { importVideo, uploadVideo } from "../api/videoApi";

interface VideoImportModalProps {
  onClose: () => void;
  onImport: (title: string, content: string) => void;
}

type Tab = "url" | "upload";

const ACCEPTED = ".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mov";

export function VideoImportModal({ onClose, onImport }: VideoImportModalProps) {
  const [tab, setTab] = useState<Tab>("url");

  // URL tab state
  const [url, setUrl] = useState("");

  // Upload tab state
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab === "url") urlInputRef.current?.focus();
    setError(null);
  }, [tab]);

  function pickError(err: unknown): string {
    return (
      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
      "Something went wrong. Please try again."
    );
  }

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      if (tab === "url") {
        const trimmed = url.trim();
        if (!trimmed) return;
        const result = await importVideo(trimmed);
        onImport(result.title, result.content);
        onClose();
      } else {
        if (!file) return;
        const result = await uploadVideo(file);
        onImport(result.title, result.content);
        onClose();
      }
    } catch (err) {
      setError(pickError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setError(null); }
  }

  const canSubmit = !loading && (tab === "url" ? url.trim().length > 0 : file !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#0f0f13] border border-[#2a2a38] rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2a]">
          <div className="flex items-center gap-2.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-red-400" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/>
              <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z"/>
            </svg>
            <h2 className="text-sm font-semibold text-gray-200">Video Import</h2>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1e1e2a]">
          {(["url", "upload"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium transition ${
                tab === t
                  ? "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "url" ? "YouTube URL" : "Upload File"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-4">

          {/* ── URL tab ── */}
          {tab === "url" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">YouTube URL</label>
                <input
                  ref={urlInputRef}
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) handleImport(); if (e.key === "Escape") onClose(); }}
                  placeholder="https://www.youtube.com/watch?v=…"
                  disabled={loading}
                  className="w-full bg-[#0a0a0f] border border-[#2a2a38] focus:border-indigo-500 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 outline-none transition disabled:opacity-50"
                />
              </div>

              {/* Caption disclaimer */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-amber-400/80 text-xs leading-relaxed">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>
                </svg>
                <span>
                  This only works for YouTube videos that have captions (auto-generated or manual).
                  If no captions are available, the import will fail.
                </span>
              </div>
            </>
          )}

          {/* ── Upload tab ── */}
          {tab === "upload" && (
            <>
              <p className="text-xs text-gray-500 leading-relaxed">
                Download your Zoom, Teams, or Google Meet recording and upload it here.
                The audio will be transcribed automatically.
              </p>

              {/* Drop zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`relative flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed cursor-pointer transition ${
                  dragging
                    ? "border-indigo-500 bg-indigo-500/10"
                    : file
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-[#2a2a38] hover:border-indigo-500/40 hover:bg-indigo-500/5"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setError(null); } }}
                />
                {file ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-emerald-400" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/>
                    </svg>
                    <p className="text-xs text-emerald-400 font-medium text-center break-all px-2">{file.name}</p>
                    <p className="text-[10px] text-gray-600">Click to change</p>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
                      <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/>
                    </svg>
                    <p className="text-xs text-gray-500">Drag & drop or <span className="text-indigo-400">browse</span></p>
                    <p className="text-[10px] text-gray-600">MP4 · M4A · WebM · MP3 · WAV · MOV - max 200 MB</p>
                  </>
                )}
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs leading-relaxed">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>
              </svg>
              {error}
            </div>
          )}

          {/* Loading hint */}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-indigo-400/70">
              <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {tab === "url" ? "Fetching captions…" : "Transcribing audio… this may take a moment."}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#1e1e2a] flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-1.5 rounded-full text-xs border border-[#2a2a38] text-gray-400 hover:text-gray-200 hover:border-[#3a3a4a] disabled:opacity-40 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!canSubmit}
            className="px-4 py-1.5 rounded-full text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {tab === "url" ? "Importing…" : "Transcribing…"}
              </>
            ) : tab === "url" ? "Import Captions" : "Transcribe & Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
