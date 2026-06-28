import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  listBooks, listMyBooks, borrowBook, removeFromMyBooks,
  type Book, type UserBook,
} from "../api/booksApi";
import { getBookFormat, getBookCategory, BOOK_CATEGORY_LABELS, type BookCategory, type BookFormat } from "./book-readers/format";
import { BookFormatIcon, getFormatStyle } from "./BookFormatIcon";

const CATEGORY_OPTIONS: BookCategory[] = ["ebook", "pdf", "audiobook", "video", "comic", "presentation", "text"];

const CATEGORY_ICON_FORMAT: Record<BookCategory, BookFormat> = {
  ebook: "epub",
  pdf: "pdf",
  audiobook: "audio",
  video: "video",
  comic: "cbz",
  presentation: "pptx",
  text: "txt",
};

const COVER_PALETTES = [
  "from-indigo-400 to-indigo-950",
  "from-rose-400 to-rose-950",
  "from-amber-400 to-amber-950",
  "from-emerald-400 to-emerald-950",
  "from-sky-400 to-sky-950",
  "from-purple-400 to-purple-950",
  "from-teal-400 to-teal-950",
  "from-orange-400 to-orange-950",
];

function paletteFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_PALETTES[h % COVER_PALETTES.length];
}

function CircleIcon({ icon, dimmed }: { icon: "plus" | "play" | "spinner"; dimmed?: boolean }) {
  return (
    <div
      className={`w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/50 text-white transition-opacity ${
        dimmed ? "opacity-0 group-hover:opacity-100" : "opacity-100"
      }`}
    >
      {icon === "plus" && (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      )}
      {icon === "play" && (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 translate-x-px drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
        </svg>
      )}
      {icon === "spinner" && (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 animate-spin drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
    </div>
  );
}

function BookCover({
  book, action, meta, onRemove, onActivate, activateDisabled, activateLabel,
}: {
  book: Book;
  action?: React.ReactNode;
  meta?: React.ReactNode;
  onRemove?: () => void;
  onActivate?: () => void;
  activateDisabled?: boolean;
  activateLabel?: string;
}) {
  const format = getBookFormat(book);
  const style = getFormatStyle(format);
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={activateLabel}
      onClick={!activateDisabled ? onActivate : undefined}
      onKeyDown={onActivate ? (e) => {
        if (activateDisabled) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); }
      } : undefined}
      className={`relative aspect-[2/3] w-full rounded-md overflow-hidden shadow-lg shadow-black/50 border border-white/10 origin-left transition-transform duration-300 ease-out group-hover:[transform:rotateY(-8deg)_translateY(-4px)_scale(1.04)] will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${
        onActivate ? "cursor-pointer" : ""
      } ${activateDisabled ? "pointer-events-none" : ""}`}
    >
      {book.cover_image_url ? (
        <img src={book.cover_image_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className={`w-full h-full bg-gradient-to-br ${paletteFor(book.title || String(book.id))} flex flex-col items-center justify-center p-2.5 text-center`}>
          <BookFormatIcon format={format} className="w-7 h-7 text-white/35 mb-1.5 shrink-0" />
          <p className="text-[10.5px] font-semibold text-white leading-snug line-clamp-4 drop-shadow-sm">{book.title}</p>
        </div>
      )}
      {/* page edges: thin striped strip mimicking stacked paper pages seen from the side */}
      <div
        className="absolute right-0 top-0.5 bottom-0.5 w-[3px] opacity-70"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, rgba(0,0,0,0.25) 1px, rgba(0,0,0,0.25) 2px)",
        }}
      />
      {/* spine: darker bevel with a thin highlight to mimic a bound edge */}
      <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
      <div className="absolute left-0 top-0 bottom-0 w-px bg-white/15" />
      <div className={`absolute top-1.5 left-1.5 inline-flex items-center justify-center w-5 h-5 rounded-md ${style.bg} ${style.fg} backdrop-blur-sm`} title={style.label}>
        <BookFormatIcon format={format} className="w-3 h-3" />
      </div>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from My Books"
          className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-md bg-black/55 text-gray-200 hover:bg-red-500/80 hover:text-white backdrop-blur-sm transition pointer-events-auto"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {action && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {action}
        </div>
      )}
      {meta && (
        <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5 pt-6 bg-gradient-to-t from-black/70 to-transparent">
          {meta}
        </div>
      )}
    </div>
  );
}

interface Props {
  show: boolean;
  onClose: () => void;
  initialView?: "browse" | "my";
  onMyBooksChanged?: (myBooks: UserBook[]) => void;
  onOpenBook: (book: Book, page: number) => void;
}

type View = "browse" | "my";
const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const BOOKS_PAGE_SIZE_KEY = "memolink-books-page-size";

function initialPageSize(): number {
  try {
    const saved = Number(localStorage.getItem(BOOKS_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved as typeof PAGE_SIZE_OPTIONS[number]) ? saved : 20;
  } catch {
    return 20;
  }
}

export function BooksLibraryModal({ show, onClose, initialView = "browse", onMyBooksChanged, onOpenBook }: Props) {
  const [view, setView] = useState<View>(initialView);
  const [books, setBooks] = useState<Book[]>([]);
  const [myBooks, setMyBooks] = useState<UserBook[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BookCategory | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [availableTotal, setAvailableTotal] = useState(0);
  const [browsePages, setBrowsePages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listBooks({
        search: search || undefined,
        format: category !== "all" ? category : undefined,
        page,
        page_size: pageSize,
      });
      setBooks(result.items);
      setBrowseTotal(result.total);
      setAvailableTotal(result.available_total ?? result.total);
      setBrowsePages(result.pages);
      if (page > result.pages) setPage(result.pages);
    } catch {
      setBooks([]);
      setBrowseTotal(0);
      setAvailableTotal(0);
      setBrowsePages(1);
    } finally {
      setLoading(false);
    }
  }, [search, category, page, pageSize]);

  const loadMyBooks = useCallback(async () => {
    setLoading(true);
    try {
      const b = await listMyBooks();
      setMyBooks(b);
      onMyBooksChanged?.(b);
    } catch {
      setMyBooks([]);
    } finally {
      setLoading(false);
    }
  }, [onMyBooksChanged]);

  useEffect(() => {
    if (!show) return;
    setView(initialView);
    setPage(1);
    loadMyBooks();
    if (initialView === "browse") loadBrowse();
  }, [show, initialView]);

  useEffect(() => {
    if (!show) return;
    if (view === "browse") loadBrowse();
    else loadMyBooks();
  }, [view, show, loadBrowse, loadMyBooks]);

  useEffect(() => {
    setPage(1);
  }, [view, search, category, pageSize]);

  useEffect(() => {
    try { localStorage.setItem(BOOKS_PAGE_SIZE_KEY, String(pageSize)); } catch { /* storage can be unavailable */ }
  }, [pageSize]);

  async function handleBorrow(book: Book) {
    setBorrowingId(book.id);
    try {
      await borrowBook(book.id);
      await loadMyBooks();
      openReader(book, 1);
    } catch {
      // ignore
    } finally {
      setBorrowingId(null);
    }
  }

  async function handleRemove(book: Book) {
    if (!confirm(`Remove "${book.title}" from My Books? Your reading progress will be lost.`)) return;
    try {
      await removeFromMyBooks(book.id);
      await loadMyBooks();
    } catch {
      // ignore
    }
  }

  function openReader(book: Book, page: number) {
    onOpenBook(book, page || 1);
  }

  function isBorrowed(bookId: number): boolean {
    return myBooks.some((m) => m.book_id === bookId);
  }

  function matchesCategory(book: Book | null | undefined): boolean {
    if (category === "all") return true;
    if (!book) return false;
    return getBookCategory(getBookFormat(book)) === category;
  }

  const filteredMyBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return myBooks.filter((ub) => {
      const book = ub.book;
      if (!matchesCategory(book)) return false;
      if (!q) return true;
      return [
        book?.title,
        book?.author,
        book?.description,
        book?.category,
        book?.tags,
        book?.file_name,
      ].some((value) => (value ?? "").toLowerCase().includes(q));
    });
  }, [myBooks, search, category]);

  const activeItemsCount = view === "browse" ? browseTotal : filteredMyBooks.length;
  const totalPages = view === "browse" ? browsePages : Math.max(1, Math.ceil(filteredMyBooks.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = books;
  const pagedMyBooks = filteredMyBooks.slice((safePage - 1) * pageSize, safePage * pageSize);

  function renderPager() {
    if (loading || activeItemsCount <= pageSize) return null;
    return (
      <div className="flex items-center justify-between gap-3 pt-4">
        <p className="text-xs text-gray-500">
          Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, activeItemsCount)} of {activeItemsCount}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ml-bg-hover)] text-gray-300 hover:bg-[var(--ml-bg-surface)] disabled:opacity-40 disabled:hover:bg-transparent transition"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--ml-bg-hover)] text-gray-300 hover:bg-[var(--ml-bg-surface)] disabled:opacity-40 disabled:hover:bg-transparent transition"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  function renderBookCard(book: Book, opts: {
    action: React.ReactNode;
    meta?: React.ReactNode;
    onRemove?: () => void;
    onActivate?: () => void;
    activateDisabled?: boolean;
    activateLabel?: string;
  }) {
    return (
      <div className="group flex flex-col [perspective:800px]" title={`${book.title}${book.author ? ` — ${book.author}` : ""}`}>
        <BookCover book={book} {...opts} />
      </div>
    );
  }

  if (!show) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[var(--ml-bg-base)]">
      <div className="px-5 py-3 border-b border-[var(--ml-bg-hover)] shrink-0">
        <div className="max-w-4xl mx-auto flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1 bg-[var(--ml-bg-surface)] rounded-lg p-1 shrink-0">
            <button
              onClick={() => setView("browse")}
              className={`px-3 py-1.5 text-xs rounded-md transition ${view === "browse" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
            >
              Browse Books ({availableTotal})
            </button>
            <button
              onClick={() => setView("my")}
              className={`px-3 py-1.5 text-xs rounded-md transition ${view === "my" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-200"}`}
            >
              My Books {myBooks.length > 0 && `(${myBooks.length})`}
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && view === "browse") loadBrowse(); }}
            placeholder={view === "browse" ? "Search browse books…" : "Search my books…"}
            className="min-w-0 flex-1 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200"
          />
        </div>
        <div className="max-w-4xl mx-auto flex items-center gap-1.5 flex-wrap mt-2.5">
          <button
            onClick={() => setCategory("all")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition ${category === "all" ? "bg-indigo-600 border-indigo-600 text-white" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
            </svg>
            All
          </button>
          {CATEGORY_OPTIONS.map((c) => {
            const style = getFormatStyle(CATEGORY_ICON_FORMAT[c]);
            const active = category === c;
            return (
              <button
                key={c}
                onClick={() => setCategory((prev) => (prev === c ? "all" : c))}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition ${active ? "bg-indigo-600 border-indigo-600 text-white" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
              >
                <BookFormatIcon
                  format={CATEGORY_ICON_FORMAT[c]}
                  className={`w-3 h-3 ${active ? "text-white" : style.fg}`}
                />
                {BOOK_CATEGORY_LABELS[c]}
              </button>
            );
          })}
          <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-gray-500">
            Books per page
            <select
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
              className="rounded-lg border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] px-2 py-1 text-xs text-gray-300 focus:border-indigo-500/50 focus:outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        {view === "browse" && !loading && (
          <p className="max-w-4xl mx-auto mt-2 text-[11px] text-gray-500">
            {search.trim() || category !== "all"
              ? `Showing ${browseTotal} of ${availableTotal} books`
              : `${availableTotal} books available`}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-5">
        {view === "browse" && (
          <div className="max-w-4xl mx-auto">
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : books.length === 0 ? (
              <p className="text-sm text-gray-500">
                {category !== "all" ? "No books match this category." : "No published books found."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-4">
                  {pagedBooks.map((book) => (
                    <React.Fragment key={book.id}>
                      {renderBookCard(book, {
                        action: isBorrowed(book.id) ? (
                          <CircleIcon icon="play" dimmed />
                        ) : (
                          <CircleIcon icon={borrowingId === book.id ? "spinner" : "plus"} dimmed={borrowingId !== book.id} />
                        ),
                        onActivate: isBorrowed(book.id)
                          ? () => openReader(book, myBooks.find((m) => m.book_id === book.id)?.current_page ?? 1)
                          : () => handleBorrow(book),
                        activateDisabled: borrowingId === book.id,
                        activateLabel: isBorrowed(book.id) ? "Read" : "Add to My Books",
                      })}
                    </React.Fragment>
                  ))}
                </div>
                {renderPager()}
              </>
            )}
          </div>
        )}

        {view === "my" && (
          <div className="max-w-4xl mx-auto">
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : filteredMyBooks.length === 0 ? (
              <p className="text-sm text-gray-500">
                {search.trim() || category !== "all"
                  ? "No books in My Books match your search or filter."
                  : "You haven't added any books yet. Browse the library to get started."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-4">
                  {pagedMyBooks.map((ub) => (
                    ub.book ? (
                      <React.Fragment key={ub.id}>
                        {renderBookCard(ub.book, {
                          action: <CircleIcon icon="play" dimmed />,
                          meta: (
                            <div className="flex flex-col gap-1">
                              <p className="text-[9px] text-gray-300 leading-none">{Math.round(ub.progress_percent)}% read</p>
                              <div className="h-1 bg-white/25 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.round(ub.progress_percent))}%` }} />
                              </div>
                            </div>
                          ),
                          onRemove: () => handleRemove(ub.book!),
                          onActivate: () => openReader(ub.book!, ub.current_page || 1),
                          activateLabel: ub.current_page > 0 ? "Continue reading" : "Start reading",
                        })}
                      </React.Fragment>
                    ) : null
                  ))}
                </div>
                {renderPager()}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
