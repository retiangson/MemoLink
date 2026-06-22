import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  listBooks, listMyBooks, borrowBook, removeFromMyBooks,
  type Book, type UserBook,
} from "../api/booksApi";

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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [borrowingId, setBorrowingId] = useState<number | null>(null);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const b = await listBooks(search ? { search } : undefined);
      setBooks(b);
    } catch {
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

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
  }, [view, search]);

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

  const filteredMyBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myBooks;
    return myBooks.filter((ub) => {
      const book = ub.book;
      return [
        book?.title,
        book?.author,
        book?.description,
        book?.category,
        book?.tags,
        book?.file_name,
      ].some((value) => (value ?? "").toLowerCase().includes(q));
    });
  }, [myBooks, search]);

  const activeItems = view === "browse" ? books : filteredMyBooks;
  const totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedBooks = books.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagedMyBooks = filteredMyBooks.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function renderPager() {
    if (loading || activeItems.length <= PAGE_SIZE) return null;
    return (
      <div className="flex items-center justify-between gap-3 pt-4">
        <p className="text-xs text-gray-500">
          Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, activeItems.length)} of {activeItems.length}
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
      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-4 flex flex-col gap-2 min-h-[190px]">
        <div className="flex items-start gap-3">
          <div className="w-12 h-16 rounded-md bg-gradient-to-br from-indigo-500/30 to-slate-700 border border-indigo-400/20 shadow-sm shrink-0 flex items-center justify-center">
            <span className="text-[10px] font-semibold text-indigo-200 uppercase">{book.file_extension?.replace(".", "") || "Book"}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-200 line-clamp-2">{book.title}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{book.author || "Unknown author"}</p>
          </div>
        </div>
        {book.description && <p className="text-xs text-gray-600 line-clamp-3">{book.description}</p>}
        {book.category && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 w-fit">{book.category}</span>
        )}
        {footer}
        <div className="mt-auto pt-2">{actions}</div>
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
      </div>

      <div className="flex-1 overflow-auto p-5">
        {view === "browse" && (
          <div className="max-w-4xl mx-auto">
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : books.length === 0 ? (
              <p className="text-sm text-gray-500">No published books found.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pagedBooks.map((book) => (
                    <React.Fragment key={book.id}>
                      {renderBookCard(
                        book,
                        isBorrowed(book.id) ? (
                          <button
                            onClick={() => openReader(book, myBooks.find((m) => m.book_id === book.id)?.current_page ?? 1)}
                            className="w-full px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
                          >
                            Read
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBorrow(book)}
                            disabled={borrowingId === book.id}
                            className="w-full px-3 py-1.5 text-xs rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition disabled:opacity-50"
                          >
                            {borrowingId === book.id ? "Adding…" : "Add to My Books"}
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
                {search.trim() ? "No books in My Books match your search." : "You haven't added any books yet. Browse the library to get started."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pagedMyBooks.map((ub) => (
                    ub.book ? (
                      <React.Fragment key={ub.id}>
                        {renderBookCard(
                          ub.book,
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openReader(ub.book!, ub.current_page || 1)}
                              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
                            >
                              {ub.current_page > 0 ? "Continue" : "Read"}
                            </button>
                            <button
                              onClick={() => handleRemove(ub.book!)}
                              className="px-3 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition"
                            >
                              Remove
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
