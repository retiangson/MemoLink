import { useState } from "react";
import { presignUpload, uploadToS3 } from "../api/chatApi";
import type { EmailAttachmentRef } from "../api/emailApi";

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  key?: string;
}

// Gmail hard-caps a sent message at ~25 MB once MIME-encoded; base64 inflates
// raw bytes by ~37%, so keep the raw attachment total comfortably under that.
export const MAX_ATTACHMENTS_TOTAL_BYTES = 18 * 1024 * 1024;

let attachmentIdCounter = 0;

export function useEmailAttachments() {
  const [items, setItems] = useState<PendingAttachment[]>([]);

  function uploadOne(id: string, file: File) {
    presignUpload(file.name, file.type || "application/octet-stream", file.size)
      .then((presign) =>
        uploadToS3(presign.url, file, (pct) => {
          setItems((prev) => prev.map((it) => (it.id === id ? { ...it, progress: pct } : it)));
        }).then(() => presign)
      )
      .then((presign) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "done", key: presign.key, progress: 100 } : it)));
      })
      .catch((err: any) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "error", error: err?.message || "Upload failed" } : it)));
      });
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    let runningTotal = items.reduce((sum, it) => (it.status === "error" ? sum : sum + it.file.size), 0);
    const additions: PendingAttachment[] = [];
    for (const file of files) {
      const id = `att-${Date.now()}-${attachmentIdCounter++}`;
      // Local-only preview - URL.createObjectURL never touches the network,
      // so showing a thumbnail before upload costs no server traffic.
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (runningTotal + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
        additions.push({ id, file, previewUrl, status: "error", progress: 0, error: "Exceeds 18 MB total limit per email" });
        continue;
      }
      runningTotal += file.size;
      additions.push({ id, file, previewUrl, status: "uploading", progress: 0 });
    }
    setItems((prev) => [...prev, ...additions]);
    additions.filter((a) => a.status === "uploading").forEach((a) => uploadOne(a.id, a.file));
  }

  function removeAttachment(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  }

  function reset() {
    items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    setItems([]);
  }

  const isUploading = items.some((it) => it.status === "uploading");
  const readyAttachments: EmailAttachmentRef[] = items
    .filter((it) => it.status === "done" && it.key)
    .map((it) => ({ key: it.key!, filename: it.file.name, contentType: it.file.type || "application/octet-stream" }));

  return { items, addFiles, removeAttachment, reset, isUploading, readyAttachments };
}
