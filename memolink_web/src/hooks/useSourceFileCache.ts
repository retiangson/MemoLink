import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { smartSourceErrorMessage, type SourceFileMetadata } from "../api/smartSourceApi";

const DB_NAME = "memolink-source-cache";
const STORE_NAME = "source-files";
const DB_VERSION = 1;

interface CachedSource {
  id: number;
  etag: string | null;
  mimeType: string;
  blob: Blob;
  cachedAt: string;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCachedSource(id: number): Promise<CachedSource | null> {
  const db = await openCacheDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as CachedSource | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeCachedSource(value: CachedSource): Promise<void> {
  const db = await openCacheDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function useSourceFileCache(source: SourceFileMetadata | null) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "cached" | "stale" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const setBlobUrl = useCallback((blob: Blob) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const next = URL.createObjectURL(blob);
    objectUrlRef.current = next;
    setObjectUrl(next);
  }, []);

  const load = useCallback(async (force = false) => {
    if (!source) return;
    setStatus("loading");
    setError(null);
    try {
      const cached = await readCachedSource(source.id);
      const cacheMatches = cached && cached.etag === source.onedrive_etag;
      if (cached && cacheMatches && !force) {
        setBlobUrl(cached.blob);
        setStatus("cached");
        return;
      }
      if (cached && !cacheMatches && !force) {
        setBlobUrl(cached.blob);
        setStatus("stale");
        return;
      }
      const response = await api.get(`/source-files/${source.id}/content`, { responseType: "blob", timeout: 300_000 });
      const blob = response.data as Blob;
      await writeCachedSource({
        id: source.id,
        etag: source.onedrive_etag,
        mimeType: source.mime_type || blob.type || "application/octet-stream",
        blob,
        cachedAt: new Date().toISOString(),
      });
      setBlobUrl(blob);
      setStatus("cached");
    } catch (caught: unknown) {
      setError(smartSourceErrorMessage(caught, "Could not cache this source file"));
      setStatus("error");
    }
  }, [setBlobUrl, source]);

  useEffect(() => {
    void load();
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [load]);

  return { objectUrl, status, error, refresh: () => load(true) };
}
