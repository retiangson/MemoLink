import React from "react";
import type { Book } from "../../api/booksApi";
import type { ReaderColorMode } from "./format";
import { formatBytes } from "./format";

interface Props {
  book: Book;
  label?: string;
  colorMode?: ReaderColorMode;
  /** Bytes downloaded so far; total falls back to book.file_size when the response has no Content-Length. */
  progress?: { loaded: number; total: number | null } | null;
}

function cardClass(mode: ReaderColorMode): string {
  if (mode === "light") return "border-slate-200 bg-white text-slate-900 shadow-slate-300/40";
  if (mode === "sepia") return "border-[#dac7a9] bg-[#f8efdd] text-[#332719] shadow-[#7a5a2e]/10";
  return "border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)]/80 text-gray-100 shadow-black/20";
}

function mutedClass(mode: ReaderColorMode): string {
  if (mode === "light") return "text-slate-500";
  if (mode === "sepia") return "text-[#705f4a]";
  return "text-gray-500";
}

export function ReaderLoadingState({ book, label = "Loading book, please wait", colorMode = "dark", progress }: Props) {
  const total = progress?.total ?? book.file_size ?? null;
  const percent = progress && total ? Math.min(100, Math.round((progress.loaded / total) * 100)) : null;

  return (
    <div className="w-full h-full min-h-[280px] flex items-center justify-center px-6 py-10">
      <div className={`w-full max-w-sm rounded-lg border px-6 py-7 shadow-xl ${cardClass(colorMode)}`}>
        <div className="flex flex-col items-center text-center gap-5">
          <div className="relative w-20 h-24">
            <div className="absolute inset-0 rounded-r-lg rounded-l-sm bg-indigo-500/15 border border-indigo-400/30 shadow-lg shadow-indigo-900/20" />
            <div className="absolute left-2 top-3 bottom-3 w-px bg-indigo-300/30" />
            <div className="absolute left-5 right-4 top-6 h-1 rounded-full bg-indigo-200/35" />
            <div className="absolute left-5 right-7 top-10 h-1 rounded-full bg-indigo-200/25" />
            <div className="absolute left-5 right-5 top-14 h-1 rounded-full bg-indigo-200/20" />
            <div className="absolute -right-2 top-5 h-14 w-1.5 rounded-full bg-indigo-300/40 animate-pulse" />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold">{label}</p>
            <p className={`mt-1 text-xs truncate max-w-[18rem] ${mutedClass(colorMode)}`} title={book.title}>
              {book.title}
            </p>
          </div>

          <div className="w-full">
            <div className={`h-1.5 overflow-hidden rounded-full ${colorMode === "dark" ? "bg-[var(--ml-bg-hover)]" : "bg-black/10"}`}>
              {percent !== null ? (
                <div className="h-full rounded-full bg-indigo-400/80 transition-[width] duration-200" style={{ width: `${percent}%` }} />
              ) : (
                <div className="h-full w-1/2 rounded-full bg-indigo-400/80 animate-[ml-reader-loading_1.2s_ease-in-out_infinite]" />
              )}
            </div>
            <p className={`mt-3 text-[11px] ${mutedClass(colorMode)}`}>
              {progress
                ? percent !== null
                  ? `Downloading… ${formatBytes(progress.loaded)} of ${formatBytes(total!)} (${percent}%)`
                  : `Downloading… ${formatBytes(progress.loaded)}`
                : "Preparing a local copy for faster reading next time."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
