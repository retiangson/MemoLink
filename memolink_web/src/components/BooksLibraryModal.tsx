import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  listBooks, listMyBooks, borrowBook, removeFromMyBooks,
  type Book, type UserBook,
} from "../api/booksApi";
import { getBookFormat, getBookCategory, BOOK_CATEGORY_LABELS, type BookCategory } from "./book-readers/format";
import { BookFormatIcon, getFormatStyle } from "./BookFormatIcon";

const CATEGORY_OPTIONS: BookCategory[] = ["ebook", "pdf", "audiobook", "video", "comic", "presentation", "text"];

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

function BookCover({ book }: { book: Book }) {
  const format = getBookFormat(book);
  const style = getFormatStyle(format);
  return (
    <div className="relative aspect-[2/3] w-full rounded-md overflow-hidden shadow-lg shadow-black/50 border border-white/10 transition-transform duration-200 ease-out group-hover:scale-[1.06] group-hover:-translate-y-1 will-change-transform">
      {book.cover_image_url ? (
        <img src={book.cover_image_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className={`w-full h-full bg-gradient-to-br ${paletteFor(book.title || String(book.id))} flex flex-col items-center justify-center p-2.5 text-center`}>
          <BookFormatIcon format={format} className="w-7 h-7 text-white/35 mb-1.5 shrink-0" />
          <p className="text-[10.5px] font-semibold text-white leading-snug line-clamp-4 drop-shadow-sm">{book.title}</p>
        </div>
      )}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-black/25" />
      <div className={`absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-md ${style.bg} ${style.fg} backdrop-blur-sm`} title={style.label}>
        <BookFormatIcon format={format} className="w-3 h-3" />
      </div>
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
const PAGE_SIZE = 12;

export function BooksLibraryModal({ show, onClose, initialView = "browse", onMyBooksChanged, onOpenBook }: Props) {
  const [view, setView] = useState<View>(initialView);
  const [books, setBooks] = useState<Book[]>([]);
  const [myBooks, setMyBooks] = useState<UserBook[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<BookCategory | "all">("all");
  const [page, setPage] = useState(1);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePages, setBrowsePages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listBooks({
        search: search || undefined,
        category: category !== "all" ? category : undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setBooks(result.items);
      setBrowseTotal(result.total);
      setBrowsePages(result.pages);
      if (page > result.pages) setPage(result.pages);
    } catch {
      setBooks([]);
      setBrowseTotal(0);
      setBrowsePages(1);
    } finally {
      setLoading(false);
    }
  }, [search, category, page]);

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
  }, [view, search, category]);

  async function handleBorrow(book: Book) {
    setBorrowingId(book.id);
    try {
      await borrowBook(book.id);
      await loadMyBooks();
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
  const totalPages = view === "browse" ? browsePages : Math.max(1, Math.ceil(filteredMyBooks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = books;
  const pagedMyBooks = filteredMyBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function renderPager() {
    if (loading || activeItemsCount <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between gap-3 pt-4">
        <p className="text-xs text-gray-500">
          Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, activeItemsCount)} of {activeItemsCount}
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

  function renderBookCard(book: Book, actions: React.ReactNode, footer?: React.ReactNode) {
    return (
      <div className="group flex flex-col gap-2">
        <BookCover book={book} />
        <div className="h-1.5 mx-2 -mt-0.5 bg-black/35 rounded-full blur-[2px] transition group-hover:bg-black/50" />
        <div className="flex flex-col gap-1 px-0.5">
          <p className="text-xs font-medium text-gray-200 line-clamp-2" title={book.title}>{book.title}</p>
          <p className="text-[10.5px] text-gray-500 truncate">{book.author || "Unknown author"}</p>
          {book.category && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 w-fit">{book.category}</span>
          )}
          {footer}
        </div>
        <div className="mt-auto pt-1">{actions}</div>
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
              Browse Books
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
            className={`px-2.5 py-1 text-[11px] rounded-full border transition ${category === "all" ? "bg-indigo-600 border-indigo-600 text-white" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
          >
            All
          </button>
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setCategory((prev) => (prev === c ? "all" : c))}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition ${category === c ? "bg-indigo-600 border-indigo-600 text-white" : "border-[var(--ml-bg-hover)] text-gray-400 hover:bg-[var(--ml-bg-hover)]"}`}
            >
              {BOOK_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
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
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-6">
                  {pagedBooks.map((book) => (
                    <React.Fragment key={book.id}>
                      {renderBookCard(
                        book,
                        isBorrowed(book.id) ? (
                          <button
                            onClick={() => openReader(book, myBooks.find((m) => m.book_id === book.id)?.current_page ?? 1)}
                            className="w-full px-2 py-1.5 text-[10.5px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
                          >
                            Read
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBorrow(book)}
                            disabled={borrowingId === book.id}
                            className="w-full px-2 py-1.5 text-[10.5px] rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition disabled:opacity-50"
                          >
                            {borrowingId === book.id ? "Adding…" : "Add"}
                          </button>
                        )
                      )}
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
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-6">
                  {pagedMyBooks.map((ub) => (
                    ub.book ? (
                      <React.Fragment key={ub.id}>
                        {renderBookCard(
                          ub.book,
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openReader(ub.book!, ub.current_page || 1)}
                              className="flex-1 px-2 py-1.5 text-[10.5px] rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
                            >
                              {ub.current_page > 0 ? "Continue" : "Read"}
                            </button>
                            <button
                              onClick={() => handleRemove(ub.book!)}
                              title="Remove from My Books"
                              className="shrink-0 p-1.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
                              </svg>
                            </button>
                          </div>,
                          <div>
                            <div className="h-1 bg-[var(--ml-bg-hover)] rounded-full mt-1 overflow-hidden">
                              <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.round(ub.progress_percent))}%` }} />
                            </div>
                            <p className="text-[10px] text-gray-600 mt-1">{Math.round(ub.progress_percent)}% read</p>
                          </div>
                        )}
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
