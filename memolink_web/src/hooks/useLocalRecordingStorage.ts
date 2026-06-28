import { useState } from "react";

const DB_NAME = "memolink-recording-storage";
const STORE_NAME = "handles";
const HANDLE_KEY = "recordings-directory";

interface RecordingWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface RecordingFileHandle {
  createWritable(): Promise<RecordingWritable>;
}

interface RecordingDirectoryHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, options: { create: true }): Promise<RecordingFileHandle>;
}

type RecordingPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<RecordingDirectoryHandle>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSavedDirectoryHandle(): Promise<RecordingDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as RecordingDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function saveDirectoryHandle(handle: RecordingDirectoryHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

async function hasWritePermission(handle: RecordingDirectoryHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export function useLocalRecordingStorage() {
  const [saving, setSaving] = useState(false);

  async function prepareDirectory(): Promise<boolean> {
    const picker = (window as RecordingPickerWindow).showDirectoryPicker;
    if (!picker) return true;
    let handle = await getSavedDirectoryHandle().catch(() => null);
    if (handle && await hasWritePermission(handle).catch(() => false)) return true;
    try {
      handle = await picker();
      await saveDirectoryHandle(handle);
      return true;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      throw error;
    }
  }

  async function saveRecording(blob: Blob, fileName: string): Promise<"folder" | "share" | "download"> {
    setSaving(true);
    try {
      const picker = (window as RecordingPickerWindow).showDirectoryPicker;
      if (picker) {
        const handle = await getSavedDirectoryHandle().catch(() => null);
        if (handle && await hasWritePermission(handle).catch(() => false)) {
          const fileHandle = await handle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          return "folder";
        }
      }

      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "MemoLink recording" });
          return "share";
        } catch (caught) {
          if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
          // Android WebViews may expose Web Share but reject calls made after
          // MediaRecorder's asynchronous stop event. Fall through to download.
        }
      }

      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      return "download";
    } finally {
      setSaving(false);
    }
  }

  return { prepareDirectory, saveRecording, saving };
}
