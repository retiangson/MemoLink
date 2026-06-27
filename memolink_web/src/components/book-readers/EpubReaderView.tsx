import React, { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import {
  fetchBookBlob, updateBookProgress, addBookmark, listBookmarks, addBookHighlight, listBookHighlights,
  bookCacheSignature, clearCachedBookBlob, clearCachedEpubLocations, getCachedEpubLocations, putCachedEpubLocations,
  reportBookReaderError, BookDownloadError,
  type Bookmark, type BookHighlight,
} from "../../api/booksApi";
import type { ReaderViewProps, HighlightAnchor } from "./format";
import { currentHighlightRange, readerThemeColors, readerFontScale, findSentenceIndexForOffset, readerSurfaceClass } from "./format";
import { useTTS, splitSentences, type TTSQueueOutcome } from "../../hooks/useTTS";
import { usePageSwipe, computeSwipeDirection } from "../../hooks/usePageSwipe";
import { useHighlightColor } from "../../hooks/useHighlightColor";
import { TTSPlayerBar } from "../TTSPlayerBar";
import { NoteSourceButton } from "./NoteSourceButton";
import { HighlightColorPicker } from "./HighlightColorPicker";
import { PageNavArrows } from "./PageNavArrows";
import { ReaderLoadingState } from "./ReaderLoadingState";
import { ZoomPanWrapper } from "./ZoomPanWrapper";
import { HIGHLIGHT_COLORS, highlightColorMark } from "./highlightColors";
import { disposeReaderAfterPaint, isNativeReaderPlatform } from "./nativeReaderLifecycle";
import { captureSettledTouchSelection } from "./domTextHighlight";

const HIGHLIGHT_NAME = "ml-tts";
const JUMP_HIGHLIGHT_NAME = "ml-jump";

function persistHighlightName(colorId: string): string {
  return `ml-persist-${colorId}`;
}

interface PendingSelection { start: number; end: number; }

const EPUB_LOCATION_STEP = 150;
const EPUB_TOUCH_FALLBACK_LOCATION_STEP = 600;

function isLikelyTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches || navigator.maxTouchPoints > 0;
}

async function generateEpubLocations(epubBook: Book): Promise<"normal" | "fallback"> {
  try {
    await epubBook.locations.generate(EPUB_LOCATION_STEP);
    return "normal";
  } catch (error) {
    if (!isLikelyTouchDevice()) throw error;
    // Last-resort fallback for memory-constrained mobile browsers. It is less
    // granular, but opening the book is better than failing after cache refresh.
    await epubBook.locations.generate(EPUB_TOUCH_FALLBACK_LOCATION_STEP);
    return "fallback";
  }
}

const BOOK_LOAD_MAX_ATTEMPTS = 3;
const BOOK_LOAD_RETRY_DELAYS_MS = [1200, 3000];

// 403/404/410 mean the book isn't accessible or no longer exists on OneDrive — retrying
// just repeats the same failure. Everything else (network blips, timeouts, 5xx, a
// corrupt/short partial download) is worth another attempt on a flaky mobile connection.
function isRetryableBookError(error: unknown): boolean {
  if (error instanceof BookDownloadError) {
    return error.status !== 403 && error.status !== 404 && error.status !== 410;
  }
  return true;
}

function describeEpubLoadError(error: unknown): string {
  if (error instanceof BookDownloadError) {
    if (error.status === 403) return "Add this book to My Books before opening it.";
    if (error.status === 404 || error.status === 410) {
      return "Could not download this book from OneDrive. It may no longer be available in the library.";
    }
    if (error.code === "ECONNABORTED") return "The book download timed out. Please try again on a stronger connection.";
    if (!error.status) return "Network error while downloading this book. Please check your connection and try again.";
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  if (/403|add this book|my books/i.test(message)) {
    return "Add this book to My Books before opening it.";
  }
  if (/404|410|not found|failed to download/i.test(message)) {
    return "Could not download this book from OneDrive. It may no longer be available in the library.";
  }
  return "Could not open this EPUB on this device. I refreshed the local cache, but the reader still could not parse or render it.";
}

function flattenDetail(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function technicalEpubLoadDetail(error: unknown): string | null {
  if (error instanceof BookDownloadError) {
    const parts = [
      error.status ? `HTTP ${error.status}` : null,
      error.code ? `code=${error.code}` : null,
      flattenDetail(error.detail),
    ].filter(Boolean);
    return parts.length ? parts.join(" | ") : null;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return error ? String(error) : null;
}

function browserConnectionDetail(): Record<string, unknown> | null {
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  };
  if (!nav.connection) return null;
  return {
    effectiveType: nav.connection.effectiveType,
    downlink: nav.connection.downlink,
    rtt: nav.connection.rtt,
    saveData: nav.connection.saveData,
  };
}

interface TextNodeEntry {
  node: Text;
  nodeStart: number;
  nodeEnd: number;
  start: number;
  end: number;
  doc: Document;
  win: any;
}

function buildCombinedTextMap(list: Contents[]): { text: string; nodes: TextNodeEntry[] } {
  let text = "";
  const nodes: TextNodeEntry[] = [];
  list.forEach((c: any, ci: number) => {
    const root: Element | undefined = c?.content;
    const doc: Document | undefined = c?.document;
    if (!root || !doc) return;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tn = n as Text;
      const value = tn.nodeValue || "";
      if (!value) continue;
      nodes.push({ node: tn, nodeStart: 0, nodeEnd: value.length, start: text.length, end: text.length + value.length, doc, win: c.window });
      text += value;
    }
    if (ci < list.length - 1) text += " ";
  });
  return { text, nodes };
}

function buildVisibleTextMap(list: Contents[]): { text: string; nodes: TextNodeEntry[] } {
  let text = "";
  const nodes: TextNodeEntry[] = [];
  list.forEach((c: any, ci: number) => {
    const root: Element | undefined = c?.content;
    const doc: Document | undefined = c?.document;
    const win: Window | undefined = c?.window;
    if (!root || !doc || !win) return;
    const viewportWidth = doc.documentElement.clientWidth || win.innerWidth;
    const viewportHeight = doc.documentElement.clientHeight || win.innerHeight;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tn = n as Text;
      const value = tn.nodeValue || "";
      if (!value.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(tn);
      const visible = Array.from(range.getClientRects()).some((rect) => (
        rect.right > 0 && rect.left < viewportWidth && rect.bottom > 0 && rect.top < viewportHeight
      ));
      if (!visible) continue;
      if (text && !/\s$/.test(text) && !/^\s/.test(value)) text += " ";
      nodes.push({ node: tn, nodeStart: 0, nodeEnd: value.length, start: text.length, end: text.length + value.length, doc, win });
      text += value;
    }
    if (ci < list.length - 1 && text) text += " ";
  });
  return text.trim() ? { text, nodes } : buildCombinedTextMap(list);
}

function buildCurrentLocationTextMap(rendition: Rendition, list: Contents[]): { text: string; nodes: TextNodeEntry[] } {
  const location: any = (rendition as any).currentLocation?.();
  const startRange: Range | undefined = location?.start?.cfi ? rendition.getRange(location.start.cfi) : undefined;
  const endRange: Range | undefined = location?.end?.cfi ? rendition.getRange(location.end.cfi) : undefined;
  const doc = startRange?.startContainer?.ownerDocument;
  if (!startRange || !endRange || !doc || endRange.startContainer.ownerDocument !== doc) {
    return buildVisibleTextMap(list);
  }
  const root = doc.body || doc.documentElement;
  const nodeStarts = new WeakMap<Node, number>();
  const nodeLengths = new WeakMap<Node, number>();
  let indexedLength = 0;
  const indexNode = (node: Node): void => {
    const start = indexedLength;
    nodeStarts.set(node, start);
    if (node.nodeType === Node.TEXT_NODE) {
      indexedLength += node.nodeValue?.length ?? 0;
    } else {
      node.childNodes.forEach(indexNode);
    }
    nodeLengths.set(node, indexedLength - start);
  };
  indexNode(root);
  const offsetTo = (container: Node, offset: number): number | null => {
    const start = nodeStarts.get(container);
    const length = nodeLengths.get(container);
    if (start == null || length == null) return null;
    if (container.nodeType === Node.TEXT_NODE) {
      return start + Math.min(Math.max(0, offset), length);
    }
    const childCount = container.childNodes.length;
    if (offset <= 0) return start;
    if (offset >= childCount) return start + length;
    return nodeStarts.get(container.childNodes[offset]) ?? null;
  };
  const startOffset = offsetTo(startRange.startContainer, startRange.startOffset);
  const endOffset = offsetTo(endRange.startContainer, endRange.startOffset);
  if (startOffset == null || endOffset == null || endOffset <= startOffset) return buildVisibleTextMap(list);
  const content = list.find((item: any) => item?.document === doc) as any;
  let absoluteOffset = 0;
  let text = "";
  const nodes: TextNodeEntry[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const value = textNode.nodeValue || "";
    const absoluteEnd = absoluteOffset + value.length;
    if (absoluteEnd > startOffset && absoluteOffset < endOffset) {
      const nodeStart = Math.max(0, startOffset - absoluteOffset);
      const nodeEnd = Math.min(value.length, endOffset - absoluteOffset);
      const slice = value.slice(nodeStart, nodeEnd);
      if (slice) {
        if (text && !/\s$/.test(text) && !/^\s/.test(slice)) text += " ";
        nodes.push({
          node: textNode,
          nodeStart,
          nodeEnd,
          start: text.length,
          end: text.length + slice.length,
          doc,
          win: content?.window ?? doc.defaultView,
        });
        text += slice;
      }
    }
    absoluteOffset = absoluteEnd;
    if (absoluteOffset >= endOffset) break;
  }
  return text.trim() ? { text, nodes } : buildVisibleTextMap(list);
}

function ensureHighlightStyle(doc: Document) {
  if (doc.getElementById("ml-tts-highlight-style")) return;
  const style = doc.createElement("style");
  style.id = "ml-tts-highlight-style";
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(99,102,241,0.45); }`;
  doc.head?.appendChild(style);
}

function ensureJumpHighlightStyle(doc: Document) {
  if (doc.getElementById("ml-jump-highlight-style")) return;
  const style = doc.createElement("style");
  style.id = "ml-jump-highlight-style";
  style.textContent = `::highlight(${JUMP_HIGHLIGHT_NAME}) { background-color: rgba(250,204,21,0.6); }`;
  doc.head?.appendChild(style);
}

function ensurePersistHighlightStyle(doc: Document, colorId: string) {
  const styleId = `ml-persist-highlight-style-${colorId}`;
  if (doc.getElementById(styleId)) return;
  const style = doc.createElement("style");
  style.id = styleId;
  style.textContent = `::highlight(${persistHighlightName(colorId)}) { background-color: ${highlightColorMark(colorId)}; }`;
  doc.head?.appendChild(style);
}

function applyEpubContentsTheme(list: Contents[], mode: ReaderViewProps["colorMode"], fontSize: ReaderViewProps["fontSize"]) {
  const colors = readerThemeColors(mode);
  const fontSizePct = Math.round(readerFontScale(fontSize) * 100);
  list.forEach((c: any) => {
    const doc: Document | undefined = c?.document;
    if (!doc) return;
    doc.documentElement.style.backgroundColor = colors.background;
    if (doc.body) {
      doc.body.style.backgroundColor = colors.background;
      doc.body.style.color = colors.foreground;
    }

    let style = doc.getElementById("ml-reader-color-mode") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "ml-reader-color-mode";
      doc.head?.appendChild(style);
    }
    style.textContent = `
      html {
        font-size: ${fontSizePct}% !important;
      }
      html, body {
        background: ${colors.background} !important;
        color: ${colors.foreground} !important;
      }
      p, li, blockquote, div, section, article, span, td, th, h1, h2, h3, h4, h5, h6 {
        color: ${colors.foreground} !important;
      }
      small, figcaption, caption {
        color: ${colors.muted} !important;
      }
      a {
        color: ${colors.link} !important;
      }
      ::selection {
        background: rgba(99, 102, 241, 0.35) !important;
      }
    `;
  });
}

export function EpubReaderView({
  book, initialPage, colorMode, fontSize, onProgress,
  noteStatus, noteStatusLoaded, savingNoteSource, onSaveAsNoteSource,
  jumpToHighlight, onJumpToHighlightHandled, onHighlightAdded, isFullscreen,
}: ReaderViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const pageTextRef = useRef<string>("");
  const textNodesRef = useRef<TextNodeEntry[]>([]);
  const activeHighlightWinsRef = useRef<Set<any>>(new Set());
  const activeJumpWinsRef = useRef<Set<any>>(new Set());
  const persistentWinsRef = useRef<Set<any>>(new Set());
  const clickListenersRef = useRef<{ doc: Document; fn: (e: MouseEvent) => void }[]>([]);
  const selectionListenersRef = useRef<{ doc: Document; selection: () => void; touchEnd: () => void }[]>([]);
  const swipeListenersRef = useRef<{ doc: Document; start: (e: TouchEvent) => void; end: (e: TouchEvent) => void }[]>([]);
  // epub.js callbacks (rendition.on("relocated", ...), iframe doc listeners) are registered
  // once outside React's render cycle, so they'd otherwise close over stale currentPage/numPages
  // state from whenever they were attached. These refs are updated synchronously alongside the
  // state setters so imperative code always sees the latest values.
  const currentPageRef = useRef(Math.max(1, initialPage || 1));
  const numPagesRef = useRef(0);
  const canMovePrevRef = useRef(false);
  const canMoveNextRef = useRef(true);
  const colorModeRef = useRef(colorMode);
  const fontSizeRef = useRef(fontSize);
  // rendition.display() is async; without this guard, a second navigateTo() fired before the
  // first resolves (e.g. two quick swipes, or a double-tap on Prev/Next) can race it — whichever
  // display() resolves last wins and fires "relocated" last, snapping the page back even though
  // the user already saw it flip forward.
  const navigatingRef = useRef(false);
  // Same stale-closure problem as above: the highlights fetch and the epub.js "relocated"
  // listener (registered once at mount) race independently, so applyPersistentHighlights
  // must always read the latest fetched highlights rather than whatever was bound when its
  // caller's closure was created.
  const highlightsRef = useRef<BookHighlight[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState("Loading book, please wait");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage || 1));
  const [canMovePrev, setCanMovePrev] = useState(false);
  const [canMoveNext, setCanMoveNext] = useState(true);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pageAnim, setPageAnim] = useState<"next" | "prev" | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);

  const tts = useTTS();
  const [highlightColor, setHighlightColor] = useHighlightColor();

  useEffect(() => {
    colorModeRef.current = colorMode;
    fontSizeRef.current = fontSize;
    const rendition = renditionRef.current;
    if (!rendition) return;
    const contents = rendition.getContents();
    const list = (Array.isArray(contents) ? contents : [contents]) as Contents[];
    applyEpubContentsTheme(list, colorMode, fontSize);
  }, [colorMode, fontSize]);

  function setCurrentPageValue(page: number) {
    currentPageRef.current = page;
    setCurrentPage(page);
    if (page > numPagesRef.current) setNumPagesValue(page);
  }

  function setNumPagesValue(total: number) {
    const safeTotal = Math.max(1, total);
    numPagesRef.current = safeTotal;
    setNumPages(safeTotal);
  }

  function setMoveBounds(location: any) {
    if (!location) return;
    canMovePrevRef.current = !location.atStart;
    canMoveNextRef.current = !location.atEnd;
    setCanMovePrev(!location.atStart);
    setCanMoveNext(!location.atEnd);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingLabel("Loading book, please wait");
    setError(null);
    setErrorDetail(null);
    setProgress(null);

    (async () => {
      try {
        const signature = bookCacheSignature(book);

        async function openBook(forceRefresh: boolean, attempt: number): Promise<Book> {
          setLoadingLabel(
            attempt === 0
              ? "Loading book, please wait"
              : `Retrying download (attempt ${attempt + 1} of ${BOOK_LOAD_MAX_ATTEMPTS})`,
          );
          const blob = await fetchBookBlob(
            book,
            (loaded, total) => { if (!cancelled) setProgress({ loaded, total }); },
            { forceRefresh },
          );
          if (!blob.size) throw new Error("Downloaded EPUB is empty.");
          if (book.file_size && blob.size !== book.file_size) {
            throw new Error(`Downloaded EPUB size mismatch: expected ${book.file_size}, got ${blob.size}.`);
          }
          const buf = await blob.arrayBuffer();
          const loadedBook = ePub(buf);
          await loadedBook.ready;
          return loadedBook;
        }

        let epubBook: Book | undefined;
        let openError: unknown;
        for (let attempt = 0; attempt < BOOK_LOAD_MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await Promise.all([
              clearCachedBookBlob(book.id),
              clearCachedEpubLocations(book.id),
            ]);
            epubBookRef.current?.destroy();
            epubBookRef.current = null;
            await new Promise((resolve) => setTimeout(resolve, BOOK_LOAD_RETRY_DELAYS_MS[attempt - 1]));
            if (cancelled) return;
          }
          try {
            epubBook = await openBook(attempt > 0, attempt);
            openError = undefined;
            break;
          } catch (err) {
            openError = err;
            if (!isRetryableBookError(err) || attempt === BOOK_LOAD_MAX_ATTEMPTS - 1) break;
          }
        }
        if (openError || !epubBook) throw openError;

        if (cancelled || !containerRef.current) {
          const destroyCancelledBook = () => {
            try { epubBook.destroy(); } catch { /* best-effort teardown */ }
          };
          if (cancelled && isNativeReaderPlatform()) disposeReaderAfterPaint(destroyCancelledBook);
          else destroyCancelledBook();
          return;
        }
        epubBookRef.current = epubBook;

        setLoadingLabel("Preparing EPUB reader");
        const rendition = epubBook.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "none",
        });
        renditionRef.current = rendition;

        setLoadingLabel("Preparing book pages");
        let locationsLoaded = false;
        const cachedLocations = await getCachedEpubLocations(book.id, signature);
        if (cachedLocations && cachedLocations.trim()) {
          try {
            epubBook.locations.load(cachedLocations);
            locationsLoaded = epubBook.locations.length() > 0;
          } catch {
            await clearCachedEpubLocations(book.id);
          }
        }
        if (!locationsLoaded) {
          const locationQuality = await generateEpubLocations(epubBook);
          const savedLocations = epubBook.locations.save();
          if (savedLocations && locationQuality === "normal") {
            putCachedEpubLocations(book.id, signature, savedLocations).catch(() => {});
          }
        }
        if (cancelled) return;
        const total = epubBook.locations.length();
        setNumPagesValue(total);

        const startLoc = Math.min(Math.max(0, (initialPage || 1) - 1), Math.max(0, total - 1));
        setCurrentPageValue(startLoc + 1);
        canMovePrevRef.current = startLoc > 0;
        setCanMovePrev(startLoc > 0);
        const startCfi = total > 0 ? epubBook.locations.cfiFromLocation(startLoc) : undefined;
        setLoadingLabel("Opening book");
        await rendition.display(startCfi);
        if (cancelled) return;
        refreshTextMap();
        setMoveBounds((rendition as any).currentLocation?.());

        rendition.on("relocated", (location: any) => {
          // Every controlled navigation path (initial load, next/prev, CFI jump in
          // navigateTo) already sets currentPage explicitly right after it runs. epub.js
          // can fire a *second*, delayed "relocated" for the same navigation once the
          // iframe's content reflows (fonts/images loading async) — by then navigatingRef
          // has already been reset to false, so deriving the page from this event's own
          // CFI->location lookup would silently snap the page number to a drifted value
          // (location-index granularity is content-dependent, so the drift isn't constant).
          // Only use this event for move-bounds/text-map bookkeeping, never for the page #.
          setMoveBounds(location);
          refreshTextMap();
        });

        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          console.error("EPUB reader failed", loadError);
          const message = describeEpubLoadError(loadError);
          const detail = technicalEpubLoadDetail(loadError);
          setError(message);
          setErrorDetail(detail);
          reportBookReaderError({
            book_id: book.id,
            format: "epub",
            stage: "epub-load",
            message,
            technical_detail: detail,
            user_agent: navigator.userAgent,
            url: window.location.pathname,
            online: navigator.onLine,
            connection: browserConnectionDetail(),
          }).catch(() => {});
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearHighlight();
      clearJumpHighlight();
      clearPersistentHighlights();
      clearClickListeners();
      clearSelectionListeners();
      clearSwipeListeners();
      const rendition = renditionRef.current;
      const epubBook = epubBookRef.current;
      renditionRef.current = null;
      epubBookRef.current = null;
      const destroyReader = () => {
        try { rendition?.destroy(); } catch { /* best-effort teardown */ }
        try { epubBook?.destroy(); } catch { /* best-effort teardown */ }
      };
      // Android WebView can blank its GPU surface when epub.js iframe teardown
      // races the React paint that reveals the library. Browser teardown remains
      // synchronous; only the native shell waits until the next screen is stable.
      disposeReaderAfterPaint(destroyReader);
    };
  }, [book.id]);

  useEffect(() => {
    listBookmarks(book.id).then(setBookmarks).catch(() => {});
  }, [book.id]);

  useEffect(() => {
    listBookHighlights(book.id).then(setHighlights).catch(() => {});
  }, [book.id]);

  // Re-paints whenever the highlights list changes (initial fetch resolving, or a highlight
  // just added) — the page-change case is covered by refreshTextMap calling this directly,
  // since textNodesRef is only fresh once that rebuild runs.
  useEffect(() => {
    highlightsRef.current = highlights;
    applyPersistentHighlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  useEffect(() => {
    if (loading || numPages === 0) return;
    const t = setTimeout(() => {
      updateBookProgress(book.id, currentPage, numPages).catch(() => {});
      onProgress?.(currentPage, numPages);
    }, 600);
    return () => clearTimeout(t);
  }, [currentPage, numPages, loading, book.id, onProgress]);

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  function clearHighlight() {
    activeHighlightWinsRef.current.forEach((win) => {
      try { win?.CSS?.highlights?.delete(HIGHLIGHT_NAME); } catch { /* ignore */ }
    });
    activeHighlightWinsRef.current.clear();
  }

  function applyHighlight(range: { start: number; end: number } | null) {
    clearHighlight();
    if (!range) return;
    const byWin = new Map<any, Range[]>();
    for (const n of textNodesRef.current) {
      if (n.end <= range.start || n.start >= range.end) continue;
      if (!n.win?.CSS?.highlights || !n.win?.Highlight) continue;
      const s = n.nodeStart + Math.max(0, range.start - n.start);
      const e = n.nodeStart + Math.min(n.nodeEnd - n.nodeStart, range.end - n.start);
      if (e <= s) continue;
      const r = n.doc.createRange();
      r.setStart(n.node, s);
      r.setEnd(n.node, e);
      ensureHighlightStyle(n.doc);
      const arr = byWin.get(n.win) ?? [];
      arr.push(r);
      byWin.set(n.win, arr);
    }
    byWin.forEach((ranges, win) => {
      const hl = new win.Highlight(...ranges);
      win.CSS.highlights.set(HIGHLIGHT_NAME, hl);
      activeHighlightWinsRef.current.add(win);
    });
  }

  // Highlight the text currently being read aloud, synced to TTS playback position.
  useEffect(() => {
    if (!tts.playing) { clearHighlight(); return; }
    const range = currentHighlightRange(pageTextRef.current, tts.sentencesList, tts.currentSentenceIdx, tts.currentWord);
    applyHighlight(range);
  }, [tts.playing, tts.currentSentenceIdx, tts.currentWord, tts.sentencesList]);

  function clearJumpHighlight() {
    activeJumpWinsRef.current.forEach((win) => {
      try { win?.CSS?.highlights?.delete(JUMP_HIGHLIGHT_NAME); } catch { /* ignore */ }
    });
    activeJumpWinsRef.current.clear();
  }

  function applyJumpHighlight(range: { start: number; end: number }) {
    clearJumpHighlight();
    const byWin = new Map<any, Range[]>();
    for (const n of textNodesRef.current) {
      if (n.end <= range.start || n.start >= range.end) continue;
      if (!n.win?.CSS?.highlights || !n.win?.Highlight) continue;
      const s = n.nodeStart + Math.max(0, range.start - n.start);
      const e = n.nodeStart + Math.min(n.nodeEnd - n.nodeStart, range.end - n.start);
      if (e <= s) continue;
      const r = n.doc.createRange();
      r.setStart(n.node, s);
      r.setEnd(n.node, e);
      ensureJumpHighlightStyle(n.doc);
      const arr = byWin.get(n.win) ?? [];
      arr.push(r);
      byWin.set(n.win, arr);
    }
    byWin.forEach((ranges, win) => {
      const hl = new win.Highlight(...ranges);
      win.CSS.highlights.set(JUMP_HIGHLIGHT_NAME, hl);
      activeJumpWinsRef.current.add(win);
    });
  }

  function flashJumpHighlight(anchor: HighlightAnchor) {
    applyJumpHighlight({ start: anchor.start, end: anchor.end });
    const entry = textNodesRef.current.find((n) => n.end > anchor.start && n.start < anchor.end);
    entry?.node.parentElement?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    // The jump overlay paints on top of (without erasing) any persistent highlight already
    // drawn for this range — clearing it after the flash reveals the persistent color underneath.
    setTimeout(() => clearJumpHighlight(), 2500);
  }

  function clearPersistentHighlights() {
    persistentWinsRef.current.forEach((win) => {
      HIGHLIGHT_COLORS.forEach((c) => {
        try { win?.CSS?.highlights?.delete(persistHighlightName(c.id)); } catch { /* ignore */ }
      });
    });
    persistentWinsRef.current.clear();
  }

  // Paints every saved highlight on the currently displayed page as a permanent
  // CSS Custom Highlight, one named highlight per distinct color present — this is what
  // makes highlights visible again on revisit, not just flash briefly.
  function applyPersistentHighlights() {
    clearPersistentHighlights();
    const onThisPage = highlightsRef.current.filter((h) => h.page_number === currentPageRef.current);
    if (onThisPage.length === 0) return;
    const byColorWin = new Map<string, Map<any, Range[]>>();
    for (const h of onThisPage) {
      for (const n of textNodesRef.current) {
        if (n.end <= h.start_offset || n.start >= h.end_offset) continue;
        if (!n.win?.CSS?.highlights || !n.win?.Highlight) continue;
        const s = n.nodeStart + Math.max(0, h.start_offset - n.start);
        const e = n.nodeStart + Math.min(n.nodeEnd - n.nodeStart, h.end_offset - n.start);
        if (e <= s) continue;
        const r = n.doc.createRange();
        r.setStart(n.node, s);
        r.setEnd(n.node, e);
        ensurePersistHighlightStyle(n.doc, h.color);
        const winMap = byColorWin.get(h.color) ?? new Map<any, Range[]>();
        const arr = winMap.get(n.win) ?? [];
        arr.push(r);
        winMap.set(n.win, arr);
        byColorWin.set(h.color, winMap);
      }
    }
    byColorWin.forEach((winMap, colorId) => {
      const name = persistHighlightName(colorId);
      winMap.forEach((ranges, win) => {
        const hl = new win.Highlight(...ranges);
        win.CSS.highlights.set(name, hl);
        persistentWinsRef.current.add(win);
      });
    });
  }

  // Arrival from a Note double-click: jump to the highlight's page if we're not already
  // there; once textNodesRef is rebuilt for that page (refreshTextMap, called from
  // navigateTo/relocated), flash the matching range.
  useEffect(() => {
    if (loading || !jumpToHighlight) return;
    if (jumpToHighlight.page !== currentPage) {
      void goToPage(jumpToHighlight.page);
      return;
    }
    const raf = requestAnimationFrame(() => {
      flashJumpHighlight(jumpToHighlight);
      onJumpToHighlightHandled?.();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToHighlight, currentPage, loading]);

  function clearClickListeners() {
    clickListenersRef.current.forEach(({ doc, fn }) => doc.removeEventListener("dblclick", fn));
    clickListenersRef.current = [];
  }

  function clearSelectionListeners() {
    selectionListenersRef.current.forEach(({ doc, selection, touchEnd }) => {
      doc.removeEventListener("selectionchange", selection);
      doc.removeEventListener("touchend", touchEnd);
    });
    selectionListenersRef.current = [];
  }

  function clearSwipeListeners() {
    swipeListenersRef.current.forEach(({ doc, start, end }) => {
      doc.removeEventListener("touchstart", start);
      doc.removeEventListener("touchend", end);
    });
    swipeListenersRef.current = [];
  }

  function refreshTextMap() {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const contents = rendition.getContents();
    const list = (Array.isArray(contents) ? contents : [contents]) as Contents[];
    applyEpubContentsTheme(list, colorModeRef.current, fontSizeRef.current);
    // epub.js keeps an entire spine item in the iframe and reveals one CSS column.
    // Reading the whole iframe makes speech run ahead while the visual page remains
    // unchanged, so TTS and page-relative highlights use only visible text nodes.
    const { text, nodes } = buildCurrentLocationTextMap(rendition, list);
    pageTextRef.current = text;
    textNodesRef.current = nodes;
    attachClickListeners(list);
    attachSelectionListeners(list);
    attachSwipeListeners(list);
    applyPersistentHighlights();
  }

  function attachClickListeners(list: Contents[]) {
    clearClickListeners();
    list.forEach((c: any) => {
      const doc: Document | undefined = c?.document;
      if (!doc) return;
      const fn = (e: MouseEvent) => {
        const d: any = doc;
        let range: Range | null = null;
        if (d.caretRangeFromPoint) {
          range = d.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (d.caretPositionFromPoint) {
          const pos = d.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos) { range = doc.createRange(); range.setStart(pos.offsetNode, pos.offset); }
        }
        if (!range) return;
        const entry = textNodesRef.current.find((n) => n.node === range!.startContainer);
        if (!entry) return;
        handleSentenceClick(entry.start + range!.startOffset - entry.nodeStart);
      };
      doc.addEventListener("dblclick", fn);
      clickListenersRef.current.push({ doc, fn });
    });
  }

  function attachSelectionListeners(list: Contents[]) {
    clearSelectionListeners();
    list.forEach((c: any) => {
      const doc: Document | undefined = c?.document;
      const win: any = c?.window;
      if (!doc || !win) return;
      const selection = () => {
        const sel = doc.getSelection?.() ?? win.getSelection?.();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          return;
        }
        const range = sel.getRangeAt(0);
        const startEntry = textNodesRef.current.find((n) => n.node === range.startContainer);
        const endEntry = textNodesRef.current.find((n) => n.node === range.endContainer);
        if (!startEntry || !endEntry) {
          return;
        }
        const firstOffset = startEntry.start + range.startOffset - startEntry.nodeStart;
        const secondOffset = endEntry.start + range.endOffset - endEntry.nodeStart;
        const start = Math.min(firstOffset, secondOffset);
        const end = Math.max(firstOffset, secondOffset);
        if (end <= start) {
          return;
        }
        setPendingSelection({ start, end });
      };
      const touchEnd = () => captureSettledTouchSelection(selection);
      doc.addEventListener("selectionchange", selection);
      doc.addEventListener("touchend", touchEnd);
      selectionListenersRef.current.push({ doc, selection, touchEnd });
    });
  }

  async function handleAddHighlight(colorId: string) {
    if (!pendingSelection) return;
    const snippet = pageTextRef.current.slice(pendingSelection.start, pendingSelection.end);
    const created = await addBookHighlight(book.id, {
      format: "epub",
      // currentPageRef, not the currentPage state — pendingSelection is set from a native
      // selectionchange listener on the iframe document (outside React's render cycle), so
      // if a page navigation just landed, the state value can still lag one render behind.
      page_number: currentPageRef.current,
      start_offset: pendingSelection.start,
      end_offset: pendingSelection.end,
      snippet,
      color: colorId,
    });
    setHighlights((prev) => [...prev, created]);
    onHighlightAdded?.();
    const contents = renditionRef.current?.getContents();
    const list = (Array.isArray(contents) ? contents : contents ? [contents] : []) as Contents[];
    list.forEach((c: any) => c?.window?.getSelection?.()?.removeAllRanges());
    setPendingSelection(null);
  }

  // The rendered page content lives inside epub.js's own iframe per chapter, which is a
  // separate DOM tree — touch events inside it never bubble out to the outer container's
  // usePageSwipe handlers. Attaching listeners directly to each iframe document is the only
  // way to detect a swipe gesture made over the actual book content.
  function attachSwipeListeners(list: Contents[]) {
    clearSwipeListeners();
    list.forEach((c: any) => {
      const doc: Document | undefined = c?.document;
      if (!doc) return;
      let startPoint: { x: number; y: number } | null = null;
      const start = (e: TouchEvent) => {
        const t = e.touches[0];
        if (t) startPoint = { x: t.clientX, y: t.clientY };
      };
      const end = (e: TouchEvent) => {
        const s = startPoint;
        startPoint = null;
        if (!s) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dir = computeSwipeDirection(t.clientX - s.x, t.clientY - s.y, 50);
        if (dir === "next") void goToPage(currentPageRef.current + 1);
        else if (dir === "prev") void goToPage(currentPageRef.current - 1);
      };
      doc.addEventListener("touchstart", start, { passive: true });
      doc.addEventListener("touchend", end, { passive: true });
      swipeListenersRef.current.push({ doc, start, end });
    });
  }

  async function navigateTo(p: number, continueReading = false) {
    const epubBook = epubBookRef.current;
    const rendition = renditionRef.current;
    const numPagesNow = numPagesRef.current;
    const curPage = currentPageRef.current;
    if (!epubBook || !rendition || p < 1 || p === curPage) return;
    if (p < curPage && !canMovePrevRef.current) return;
    if (!continueReading && p > curPage && p === curPage + 1 && !canMoveNextRef.current) return;
    if (p > curPage + 1 && p > numPagesNow) return;
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    try {
      tts.stop();
      clearHighlight();
      setPendingSelection(null);
      setPageAnim(p > curPage ? "next" : "prev");
      if (p === curPage + 1) {
        const beforeCfi = ((rendition as any).currentLocation?.() as any)?.start?.cfi;
        await rendition.next();
        const afterLocation: any = (rendition as any).currentLocation?.();
        if (continueReading && beforeCfi && afterLocation?.start?.cfi === beforeCfi) return;
      } else if (p === curPage - 1) {
        await rendition.prev();
      } else {
        await rendition.display(epubBook.locations.cfiFromLocation(p - 1));
      }
      const location: any = (rendition as any).currentLocation?.();
      const resolvedPage = Number.isFinite(location?.start?.location) ? location.start.location + 1 : p;
      setCurrentPageValue(resolvedPage);
      setMoveBounds(location);
      refreshTextMap();
      if (continueReading) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        refreshTextMap();
        speakPage(0);
      }
    } finally {
      navigatingRef.current = false;
    }
  }

  async function goToPage(p: number) {
    await navigateTo(p);
  }

  const swipeHandlers = usePageSwipe(
    () => goToPage(currentPageRef.current - 1),
    () => goToPage(currentPageRef.current + 1),
  );

  async function handleBookmark() {
    try {
      const bm = await addBookmark(book.id, currentPage);
      setBookmarks((prev) => [bm, ...prev.filter((b) => b.page_number !== currentPage)]);
    } catch {
      // ignore
    }
  }

  function handleAutoAdvanceRead(outcome: TTSQueueOutcome) {
    if (outcome !== "completed") return;
    const location: any = (renditionRef.current as any)?.currentLocation?.();
    if (location?.atEnd) return;
    void navigateTo(currentPageRef.current + 1, true);
  }

  function speakPage(startIdx: number) {
    const text = pageTextRef.current;
    if (!text.trim()) return;
    tts.speak(text, startIdx, handleAutoAdvanceRead);
  }

  function handleReadAloud() {
    if (tts.playing) {
      if (tts.paused) tts.resume(); else tts.pause();
      return;
    }
    speakPage(0);
  }

  function handleSentenceClick(charOffset: number) {
    const text = pageTextRef.current;
    if (!text.trim()) return;
    if (tts.playing) tts.stop();
    const idx = findSentenceIndexForOffset(text, splitSentences(text), charOffset);
    speakPage(idx);
  }

  const isBookmarked = bookmarks.some((b) => b.page_number === currentPage);

  return (
    <>
      <ZoomPanWrapper active={!!isFullscreen} surfaceClass={readerSurfaceClass(colorMode)}>
      <div className={`flex-1 overflow-hidden relative transition-colors ${readerSurfaceClass(colorMode)}`} {...(!isFullscreen ? swipeHandlers : {})}>
        {loading && (
          <div className={`absolute inset-0 z-10 ${readerSurfaceClass(colorMode)}`}>
            <ReaderLoadingState book={book} colorMode={colorMode} label={loadingLabel} progress={progress} />
          </div>
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center px-5 py-8">
            <div className="max-w-md rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200 shadow-lg">
              <p className="font-semibold text-red-100">EPUB could not open</p>
              <p className="mt-2 leading-relaxed">{error}</p>
              {errorDetail && (
                <details className="mt-3 rounded-md border border-red-500/20 bg-black/20 p-3 text-xs text-red-100/80">
                  <summary className="cursor-pointer font-medium text-red-100">Technical detail</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words">{errorDetail}</p>
                </details>
              )}
            </div>
          </div>
        ) : (
          <>
            <div
              onAnimationEnd={() => setPageAnim(null)}
              className={`w-full h-full ${pageAnim === "next" ? "ml-page-anim-next" : pageAnim === "prev" ? "ml-page-anim-prev" : ""}`}
            >
              <div ref={containerRef} className="w-full h-full" style={{ backgroundColor: readerThemeColors(colorMode).background }} />
            </div>
            <PageNavArrows
              onPrev={() => goToPage(currentPage - 1)}
              onNext={() => goToPage(currentPage + 1)}
              canPrev={canMovePrev}
              canNext={canMoveNext}
            />
          </>
        )}
      </div>
      </ZoomPanWrapper>

      {tts.playing && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50">
          <TTSPlayerBar
            paused={tts.paused}
            rate={tts.rate}
            voices={tts.voices}
            selectedVoice={tts.selectedVoice}
            onPauseResume={() => (tts.paused ? tts.resume() : tts.pause())}
            onStop={tts.stop}
            onBack={tts.back}
            onForward={tts.forward}
            onRateChange={tts.setRate}
            onVoiceChange={tts.setSelectedVoice}
          />
        </div>
      )}

      {!loading && !error && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--ml-bg-hover)] shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <NoteSourceButton
              noteStatus={noteStatus}
              noteStatusLoaded={noteStatusLoaded}
              savingNoteSource={savingNoteSource}
              onSaveAsNoteSource={onSaveAsNoteSource}
            />
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
            <button
              onClick={handleReadAloud}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition"
            >
              {tts.playing ? (tts.paused ? "Resume" : "Pause") : "Read Aloud"}
            </button>
            <HighlightColorPicker value={highlightColor} onChange={setHighlightColor} disabled={!pendingSelection} onApply={handleAddHighlight} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={!canMovePrev}
              className="px-2.5 py-1.5 text-xs rounded-lg text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500 w-20 text-center shrink-0">
              Page {currentPage} / {numPages}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={!canMoveNext}
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
