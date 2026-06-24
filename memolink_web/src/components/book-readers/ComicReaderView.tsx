import React, { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { createExtractorFromData } from "node-unrar-js";
import unrarWasmUrl from "node-unrar-js/esm/js/unrar.wasm?url";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks,
  type Bookmark,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { readerSurfaceClass } from "./format";
import { usePageSwipe } from "../../hooks/usePageSwipe";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";

interface ComicSource {
  names: string[];
  loadPageBytes(index: number): Promise<Uint8Array>;
}

const IMAGE_NAME_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;

function isImageName(name: string): boolean {
  return IMAGE_NAME_RE.test(name);
}

function mimeForImageName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/jpeg";
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function buildCbzSource(buf: ArrayBuffer): Promise<ComicSource> {
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && isImageName(f.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  return {
    names: entries.map((e) => e.name),
    loadPageBytes(index) {
      return entries[index].async("uint8array");
    },
  };
}

// Only the file list is read upfront (gives the page count immediately); each page's
// bytes are decoded on demand via the same extractor instance, which is stateful and
// designed to serve repeated sequential extract() calls against the open archive.
async function buildCbrSource(buf: ArrayBuffer): Promise<ComicSource> {
  const wasmBinary = await fetch(unrarWasmUrl).then((r) => r.arrayBuffer());
  const extractor = await createExtractorFromData({ data: buf, wasmBinary });
  const { fileHeaders } = extractor.getFileList();
  const headers = [...fileHeaders]
    .filter((h) => !h.flags.directory && isImageName(h.name))
    .sort((a, b) => naturalCompare(a.name, b.name));
  return {
    names: headers.map((h) => h.name),
    async loadPageBytes(index) {
      const { files } = extractor.extract({ files: [headers[index].name] });
      const bytes = [...files][0]?.extraction;
      if (!bytes) throw new Error("Failed to extract page");
      return bytes;
    },
  };
}

// Comics (.cbz/.cbr) are page-image archives with no extractable text, so this reader
// has no TTS, highlight, or note-source UI — same reduced toolbar as AudioReaderView.
export function ComicReaderView({ book, initialPage, colorMode, onProgress }: ReaderViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);

  const sourceRef = useRef<ComicSource | null>(null);
  const urlCacheRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProgress(null);
    (async () => {
      try {
        const blob = await fetchBookBlob(book, (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); });
        const buf = await blob.arrayBuffer();
        const ext = (book.file_extension || "").toLowerCase();
        const source = ext === ".cbr" ? await buildCbrSource(buf) : await buildCbzSource(buf);
        if (cancelled) return;
        sourceRef.current = source;
        setPageCount(source.names.length);
        setCurrentPage((p) => Math.min(Math.max(1, p), Math.max(1, source.names.length)));
      } catch {
        if (!cancelled) setError("Could not load this comic. It may no longer be available in the library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    return () => {
      urlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (loading || !sourceRef.current) return;
    const source = sourceRef.current;
    const cached = urlCacheRef.current.get(currentPage);
    if (cached) {
      setImgUrl(cached);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    source
      .loadPageBytes(currentPage - 1)
      .then((bytes) => {
        if (cancelled) return;
        const name = source.names[currentPage - 1];
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeForImageName(name) });
        const url = URL.createObjectURL(blob);
        urlCacheRef.current.set(currentPage, url);
        setImgUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this page.");
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentPage, loading]);

  useEffect(() => {
    if (loading || pageCount === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, pageCount).catch(() => {});
      onProgress?.(currentPage, pageCount);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, pageCount, loading, book.id, onProgress]);

  function goToPage(p: number) {
    if (p < 1 || p > pageCount || p === currentPage) return;
    setPageAnim(p > currentPage ? "next" : "prev");
    setCurrentPage(p);
  }

  const swipeHandlers = usePageSwipe(() => goToPage(currentPage - 1), () => goToPage(currentPage + 1));

  async function handleBookmark() {
    try {
      const bm = await addBookmark(book.id, currentPage);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== currentPage)]);
    } catch {
      // ignore
    }
  }

  const isBookmarked = bookmarks.some((b) => b.page_number === currentPage);

  return (
    <>
      <div
        className={`flex-1 overflow-auto flex justify-center py-6 px-4 relative transition-colors ${readerSurfaceClass(colorMode)}`}
        {...swipeHandlers}
      >
        {loading ? (
          <ReaderLoadingState book={book} colorMode={colorMode} label="Loading comic, please wait" progress={progress} />
        ) : error ? (
          <div className="flex items-center justify-center text-red-400 text-sm">{error}</div>
        ) : (
          <>
            <div
              onAnimationEnd={() => setPageAnim(null)}
              className={`relative shadow-lg rounded bg-black/20 max-w-full h-fit overflow-hidden flex items-center justify-center ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            >
              {imgUrl && (
                <img src={imgUrl} alt={`Page ${currentPage}`} className="max-w-full max-h-[80vh] object-contain" />
              )}
              {pageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-xs text-gray-300">
                  Loading page…
                </div>
              )}
            </div>
            <PageNavArrows
              onPrev={() => goToPage(currentPage - 1)}
              onNext={() => goToPage(currentPage + 1)}
              canPrev={currentPage > 1}
              canNext={currentPage < pageCount}
            />
          </>
        )}
      </div>

      {!loading && !error && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--ml-bg-hover)] shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBookmark}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition ${isBookmarked ? "border-indigo-500/40 text-indigo-400 bg-indigo-500/10" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
            >
              {isBookmarked ? "★ Bookmarked" : "☆ Bookmark"}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowBookmarks((v) => !v)}
                className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition"
              >
                Bookmarks ({bookmarks.length})
              </button>
              {showBookmarks && (
                <div className="absolute bottom-full left-0 mb-2 w-48 max-h-56 overflow-auto bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5">
                  {bookmarks.length === 0 ? (
                    <p className="text-xs text-gray-600 px-2 py-1.5">No bookmarks yet.</p>
                  ) : (
                    bookmarks.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { goToPage(b.page_number); setShowBookmarks(false); }}
                        className="text-left text-xs text-gray-300 hover:bg-[#1a1a24] rounded-md px-2 py-1.5 transition"
                      >
                        Page {b.page_number}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500 w-20 text-center shrink-0">
              Page {currentPage} / {pageCount}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
