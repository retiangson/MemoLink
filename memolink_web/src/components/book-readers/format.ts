import type { Book } from "../../api/booksApi";
import type { BookNoteSourceStatus } from "../../api/booksApi";

export type BookFormat =
  | "pdf"
  | "epub"
  | "pptx"
  | "audio"
  | "video"
  | "txt"
  | "srt"
  | "vtt"
  | "cbz"
  | "cbr"
  | "mobi"
  | "unsupported";
export type ReaderColorMode = "dark" | "light" | "sepia";
export type ReaderFontSize = "sm" | "md" | "lg" | "xl";

export interface HighlightAnchor {
  page: number;
  start: number;
  end: number;
}

export interface ReaderViewProps {
  book: Book;
  initialPage: number;
  colorMode: ReaderColorMode;
  fontSize: ReaderFontSize;
  onProgress?: (currentPage: number, totalPages: number) => void;
  noteStatus?: BookNoteSourceStatus | null;
  noteStatusLoaded?: boolean;
  savingNoteSource?: boolean;
  onSaveAsNoteSource?: () => void;
  jumpToHighlight?: HighlightAnchor | null;
  onJumpToHighlightHandled?: () => void;
  onHighlightAdded?: (noteId: number) => Promise<void> | void;
  isFullscreen?: boolean;
  /** True only when this reader is the currently visible tab. PdfReaderView uses this to
   *  re-render the canvas when becoming visible after a display:none hide cycle, since
   *  Chromium frees the canvas GPU texture while the element is not displayed. */
  isActive?: boolean;
}

export const READER_COLOR_MODE_LABELS: Record<ReaderColorMode, string> = {
  dark: "Dark",
  light: "Light",
  sepia: "Sepia",
};

export const READER_COLOR_MODES: ReaderColorMode[] = ["dark", "light", "sepia"];

export function isReaderColorMode(value: string | null): value is ReaderColorMode {
  return value === "dark" || value === "light" || value === "sepia";
}

export const READER_FONT_SIZES: ReaderFontSize[] = ["sm", "md", "lg", "xl"];

export const READER_FONT_SIZE_LABELS: Record<ReaderFontSize, string> = {
  sm: "Small text",
  md: "Medium text",
  lg: "Large text",
  xl: "Extra large text",
};

export function isReaderFontSize(value: string | null): value is ReaderFontSize {
  return value === "sm" || value === "md" || value === "lg" || value === "xl";
}

// Multiplier applied on top of each reader's own base font size (15-16px, or the
// PDF render scale) — kept as one shared scale so "one step bigger" feels the same
// across every format instead of each reader inventing its own step sizes.
export function readerFontScale(size: ReaderFontSize): number {
  if (size === "sm") return 0.875;
  if (size === "lg") return 1.15;
  if (size === "xl") return 1.3;
  return 1;
}

export function readerFontSizePx(size: ReaderFontSize, basePx: number): number {
  return Math.round(basePx * readerFontScale(size));
}

export function nextReaderFontSize(size: ReaderFontSize, direction: 1 | -1): ReaderFontSize {
  const idx = READER_FONT_SIZES.indexOf(size);
  const next = Math.min(READER_FONT_SIZES.length - 1, Math.max(0, idx + direction));
  return READER_FONT_SIZES[next];
}

export function readerSurfaceClass(mode: ReaderColorMode): string {
  if (mode === "light") return "bg-slate-100 text-slate-900";
  if (mode === "sepia") return "bg-[#efe4cf] text-[#332719]";
  return "bg-[var(--ml-bg-base)] text-gray-100";
}

export function pdfCanvasFilter(mode: ReaderColorMode): string {
  if (mode === "dark") return "invert(1) hue-rotate(180deg) contrast(0.92) brightness(0.86)";
  if (mode === "sepia") return "sepia(0.2) saturate(0.92) brightness(0.98)";
  return "none";
}

export function readerThemeColors(mode: ReaderColorMode): { background: string; foreground: string; muted: string; link: string } {
  if (mode === "light") {
    return { background: "#f8fafc", foreground: "#111827", muted: "#475569", link: "#4338ca" };
  }
  if (mode === "sepia") {
    return { background: "#efe4cf", foreground: "#332719", muted: "#705f4a", link: "#8b5e20" };
  }
  return { background: "#0f0f13", foreground: "#e5e7eb", muted: "#9ca3af", link: "#a5b4fc" };
}

export function readerTextColor(mode: ReaderColorMode): string {
  return readerThemeColors(mode).foreground;
}

// Flips a panel that's only ever been styled for the dark theme (e.g. the rich-text
// note editor, with dozens of hardcoded heading/link/etc. colors) into a light or sepia
// look without re-deriving every nested color — same trick as pdfCanvasFilter above.
// Pair with the [data-rc-mode] img/video correction rule in index.css so embedded
// images don't get inverted along with the surrounding chrome.
export function richContentFilter(mode: ReaderColorMode): string {
  if (mode === "light") return "invert(1) hue-rotate(180deg)";
  if (mode === "sepia") return "invert(1) hue-rotate(180deg) sepia(0.45) saturate(1.15) brightness(0.97)";
  return "none";
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".m4b", ".aac", ".wav", ".ogg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

export function getBookFormat(book: Pick<Book, "file_extension" | "mime_type">): BookFormat {
  const ext = (book.file_extension || "").toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".pptx") return "pptx";
  if (ext === ".txt") return "txt";
  if (ext === ".srt") return "srt";
  if (ext === ".vtt") return "vtt";
  if (ext === ".cbz") return "cbz";
  if (ext === ".cbr") return "cbr";
  if (ext === ".mobi") return "mobi";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  const mime = (book.mime_type || "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/epub+zip") return "epub";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (mime === "text/plain") return "txt";
  if (mime === "application/x-subrip") return "srt";
  if (mime === "text/vtt") return "vtt";
  if (mime === "application/vnd.comicbook+zip") return "cbz";
  if (mime === "application/vnd.comicbook-rar") return "cbr";
  if (mime === "application/x-mobipocket-ebook") return "mobi";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";

  return "unsupported";
}

/** Coarse, user-facing groupings of BookFormat for library filtering (see BooksLibraryModal). */
export type BookCategory = "ebook" | "pdf" | "audiobook" | "video" | "comic" | "presentation" | "text";

export const BOOK_CATEGORY_LABELS: Record<BookCategory, string> = {
  ebook: "eBooks",
  pdf: "PDF",
  audiobook: "Audiobooks",
  video: "Videos",
  comic: "Comics",
  presentation: "Presentations",
  text: "Text & Captions",
};

export function getBookCategory(format: BookFormat): BookCategory | null {
  switch (format) {
    case "epub":
    case "mobi":
      return "ebook";
    case "pdf":
      return "pdf";
    case "audio":
      return "audiobook";
    case "video":
      return "video";
    case "cbz":
    case "cbr":
      return "comic";
    case "pptx":
      return "presentation";
    case "txt":
    case "srt":
    case "vtt":
      return "text";
    default:
      return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Maps each sentence (as produced by splitSentences) to its start offset within fullText. */
export function computeSentenceOffsets(fullText: string, sentences: string[]): number[] {
  const offsets: number[] = [];
  let searchFrom = 0;
  for (const s of sentences) {
    const idx = fullText.indexOf(s, searchFrom);
    const start = idx === -1 ? searchFrom : idx;
    offsets.push(start);
    searchFrom = start + s.length;
  }
  return offsets;
}

/** Index of the sentence (from splitSentences) that contains charOffset within fullText. */
export function findSentenceIndexForOffset(fullText: string, sentences: string[], charOffset: number): number {
  const offsets = computeSentenceOffsets(fullText, sentences);
  let idx = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] <= charOffset) idx = i;
    else break;
  }
  return idx;
}

/** Absolute [start, end) char range within fullText currently being spoken by useTTS. */
export function currentHighlightRange(
  fullText: string,
  sentences: string[],
  sentenceIdx: number,
  word: { start: number; end: number } | null,
): { start: number; end: number } | null {
  if (sentenceIdx < 0 || sentenceIdx >= sentences.length) return null;
  const sentStart = computeSentenceOffsets(fullText, sentences)[sentenceIdx];
  const sentence = sentences[sentenceIdx];
  if (word) return { start: sentStart + word.start, end: sentStart + word.end };
  return { start: sentStart, end: sentStart + sentence.length };
}
