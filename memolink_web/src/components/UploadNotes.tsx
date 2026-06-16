import React, { useState, useRef } from "react";
import { uploadNotes, presignUpload, uploadToS3, processFromS3 } from "../api/chatApi";
import { API_BASE } from "../api/client";

// Files whose combined size fits within Lambda's effective payload limit go
// directly through the API. Lambda Function URLs base64-encode binary bodies
// (~33% overhead), so the real ceiling is ~4.5 MB. Larger batches use S3.
const DIRECT_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB

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
    setStatus("Connecting…");
    setFailures([]);

    // Pre-flight health check - distinguishes "backend unreachable" from
    // "upload rejected". API_BASE includes /api so strip it to reach /health.
    try {
      const rootBase = API_BASE.replace(/\/api\/?$/, "");
      const res = await fetch(`${rootBase}/health`, { method: "GET", signal: AbortSignal.timeout(8000) });
      if (!res.ok && res.status !== 404) throw new Error(`Health check returned ${res.status}`);
    } catch (healthErr) {
      console.error("[UploadNotes] health check failed:", healthErr);
      setStatus("Upload failed: cannot reach the server. Check your connection or try again.");
      setLoading(false);
      return;
    }

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    if (totalSize <= DIRECT_LIMIT_BYTES) {
      // ── Small files: send directly through Lambda (/notes/bulk) ──────────────
      try {
        setStatus("Uploading…");
        const result = await uploadNotes(files, workspaceId);
        const notes = result.notes ?? [];
        const failed = result.failed ?? [];
        setStatus(`${notes.length} note(s) imported${failed.length ? `, ${failed.length} failed` : ""}.`);
        setFailures(failed);
        if (setNotes && notes.length) setNotes((prev) => [...notes, ...prev]);
        if (onUploaded && notes.length) onUploaded(notes);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
        const httpStatus = e?.response?.status;
        const detail = e?.response?.data?.detail ?? e?.message ?? "Unknown error";
        console.error("[UploadNotes] direct upload error:", err);
        if (httpStatus === 413) {
          setStatus("Upload failed: file too large for the server.");
        } else if (httpStatus === 401 || httpStatus === 403) {
          setStatus("Upload failed: authentication error. Please sign in again.");
        } else if (httpStatus === 422) {
          setStatus(`Upload failed: ${detail}`);
        } else if (httpStatus) {
          setStatus(`Upload failed (HTTP ${httpStatus}): ${detail}`);
        } else {
          setStatus(`Upload failed: ${detail}`);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Large files: stage via S3 presigned URLs, then process from S3 ────────
    const keys: string[] = [];
    const uploadFailed: { filename: string; reason: string }[] = [];

    try {
      for (const file of files) {
        // 1. Get a pre-signed PUT URL from the backend
        let presign: { url: string; key: string };
        try {
          presign = await presignUpload(
            file.name,
            file.type || "application/octet-stream",
            file.size,
          );
        } catch (err: unknown) {
          const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
          const httpStatus = e?.response?.status;
          const detail = e?.response?.data?.detail ?? e?.message ?? "Unknown error";
          console.error("[UploadNotes] presign error:", err);
          if (httpStatus === 422) {
            setStatus(`Upload failed: ${detail}`);
          } else if (httpStatus === 503) {
            setStatus("Upload failed: S3 upload is not configured on this server.");
          } else if (httpStatus === 401 || httpStatus === 403) {
            setStatus("Upload failed: authentication error. Please sign in again.");
          } else if (httpStatus) {
            setStatus(`Upload failed (HTTP ${httpStatus}): ${detail}`);
          } else if (e?.message?.toLowerCase().includes("network")) {
            setStatus("Upload failed: Network Error - the connection was interrupted. Check your connection and try again.");
          } else {
            setStatus(`Upload failed: ${detail}`);
          }
          setLoading(false);
          return;
        }

        // 2. Upload file bytes directly to S3 (bypasses Lambda entirely)
        try {
          await uploadToS3(presign.url, file, (pct) => {
            setStatus(`Uploading ${file.name}… (${pct}%)`);
          });
          keys.push(presign.key);
        } catch (err: unknown) {
          const e = err as { message?: string };
          console.error("[UploadNotes] S3 upload error:", err);
          uploadFailed.push({ filename: file.name, reason: e?.message ?? "Upload to S3 failed" });
        }
      }

      // If all files failed during S3 upload, bail early
      if (keys.length === 0) {
        setStatus(`Upload failed: no files could be sent to storage.`);
        setFailures(uploadFailed);
        setLoading(false);
        return;
      }

      // 3. Tell the backend to download from S3, extract text, and create notes
      setStatus(`Processing ${keys.length} file(s)…`);
      const result = await processFromS3(keys, workspaceId);
      const notes = result.notes ?? [];
      const failed = [...uploadFailed, ...(result.failed ?? [])];
      setStatus(`${notes.length} note(s) imported${failed.length ? `, ${failed.length} failed` : ""}.`);
      setFailures(failed);
      if (setNotes && notes.length) setNotes((prev) => [...notes, ...prev]);
      if (onUploaded && notes.length) onUploaded(notes);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
      const httpStatus = e?.response?.status;
      const detail = e?.response?.data?.detail ?? e?.message ?? "Unknown error";
      console.error("[UploadNotes] process error:", err);
      if (httpStatus === 413) {
        setStatus("Upload failed: file too large for the server. Contact your admin.");
      } else if (httpStatus === 401 || httpStatus === 403) {
        setStatus("Upload failed: authentication error. Please sign in again.");
      } else if (httpStatus === 422) {
        setStatus(`Upload failed: ${detail}`);
      } else if (httpStatus) {
        setStatus(`Upload failed (HTTP ${httpStatus}): ${detail}`);
      } else if (e?.message?.toLowerCase().includes("network")) {
        setStatus("Upload failed: Network Error - the connection was interrupted mid-upload. For large files, try a faster connection. If the problem persists, contact your admin to check server logs.");
      } else {
        setStatus(`Upload failed: ${detail}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="border border-dashed border-[#3a3a4a] bg-[var(--ml-bg-surface)] rounded-lg p-4 text-center cursor-pointer hover:bg-[var(--ml-bg-panel)] transition"
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
          {status || "Importing notes…"}
        </div>
      )}
      {!loading && status && (
        <p className={`text-xs ${status.startsWith("Upload failed") ? "text-red-400" : "text-gray-400"}`}>{status}</p>
      )}
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
