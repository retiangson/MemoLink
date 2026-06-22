import React, { useEffect, useRef, useState } from "react";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks,
  type Bookmark,
} from "../../api/booksApi";
import type { ReaderViewProps } from "./format";
import { formatTimestamp } from "./format";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export function AudioReaderView({ book, initialPage, onProgress }: ReaderViewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const seekedToInitialRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(Math.max(0, initialPage || 0));
  const [speed, setSpeed] = useState(1);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    seekedToInitialRef.current = false;
    (async () => {
      try {
        const blob = await fetchBookBlob(book.id);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        if (audioRef.current) audioRef.current.src = url;
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Could not load this book. It may no longer be available in OneDrive.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    if (loading || duration === 0) return;
    const t = setTimeout(() => {
      const rounded = Math.floor(currentTime);
      updateBookProgress(book.id, rounded, Math.floor(duration)).catch(() => {});
      onProgress?.(rounded, Math.floor(duration));
    }, 1500);
    return () => clearTimeout(t);
  }, [currentTime, duration, loading, book.id, onProgress]);

  function handleLoadedMetadata() {
    const el = audioRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
    if (!seekedToInitialRef.current && initialPage > 0) {
      el.currentTime = Math.min(initialPage, el.duration || initialPage);
      seekedToInitialRef.current = true;
    }
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function seekBy(deltaSeconds: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + deltaSeconds), duration || el.currentTime + deltaSeconds);
  }

  function seekTo(seconds: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, seconds), duration || seconds);
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  async function handleBookmark() {
    try {
      const ts = Math.floor(currentTime);
      const bm = await addBookmark(book.id, ts);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== ts)]);
    } catch {
      // ignore
    }
  }

  const isBookmarked = bookmarks.some((b) => Math.abs(b.page_number - currentTime) < 1);

  return (
    <>
      <div className="flex-1 overflow-auto flex items-center justify-center px-4">
        {loading ? (
          <div className="text-gray-500 text-sm">Loading audiobook…</div>
        ) : error ? (
          <div className="text-red-400 text-sm">{error}</div>
        ) : (
          <div className="w-full max-w-md flex flex-col items-center gap-6 py-10">
            <div className="w-40 h-40 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-2v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-2c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
              </svg>
            </div>

            <audio
              ref={audioRef}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />

            <div className="w-full flex flex-col gap-1.5">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={1}
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-[11px] text-gray-500">
                <span>{formatTimestamp(currentTime)}</span>
                <span>{formatTimestamp(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button onClick={() => seekBy(-15)} className="text-gray-400 hover:text-gray-200 transition text-xs px-2 py-1.5 border border-[var(--ml-bg-hover)] rounded-lg">
                ⟲ 15s
              </button>
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition"
              >
                {playing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
                  </svg>
                )}
              </button>
              <button onClick={() => seekBy(15)} className="text-gray-400 hover:text-gray-200 transition text-xs px-2 py-1.5 border border-[var(--ml-bg-hover)] rounded-lg">
                15s ⟳
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => changeSpeed(s)}
                  className={`px-2 py-1 text-[11px] rounded-md transition ${speed === s ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300 border border-[var(--ml-bg-hover)]"}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!loading && !error && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--ml-bg-hover)] shrink-0 gap-3">
          <span className="text-xs text-gray-600">Audiobook</span>
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
                <div className="absolute bottom-full right-0 mb-2 w-48 max-h-56 overflow-auto bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5">
                  {bookmarks.length === 0 ? (
                    <p className="text-xs text-gray-600 px-2 py-1.5">No bookmarks yet.</p>
                  ) : (
                    bookmarks.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { seekTo(b.page_number); setShowBookmarks(false); }}
                        className="text-left text-xs text-gray-300 hover:bg-[#1a1a24] rounded-md px-2 py-1.5 transition"
                      >
                        {formatTimestamp(b.page_number)}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
