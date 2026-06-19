import React from "react";
import type { PendingAttachment } from "../hooks/useEmailAttachments";

interface EmailAttachmentListProps {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailAttachmentList({ items, onRemove }: EmailAttachmentListProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          title={it.error || it.file.name}
          className={`flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg border text-xs ${
            it.status === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] text-gray-300"
          }`}
        >
          {it.previewUrl ? (
            <img src={it.previewUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0z" />
            </svg>
          )}
          <span className="max-w-[140px] truncate">{it.file.name}</span>
          {it.status === "uploading" && <span className="text-gray-500 shrink-0">{it.progress}%</span>}
          {it.status === "error" && <span className="text-red-400 shrink-0">Failed</span>}
          {it.status === "done" && <span className="text-gray-600 shrink-0">{formatSize(it.file.size)}</span>}
          <button onClick={() => onRemove(it.id)} title="Remove" className="text-gray-500 hover:text-gray-200 shrink-0">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
