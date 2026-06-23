import { api } from "./client";

export interface Book {
  id: number;
  title: string;
  author?: string | null;
  description?: string | null;
  category?: string | null;
  tags?: string | null;
  file_name: string;
  file_extension?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  cover_image_url?: string | null;
  onedrive_web_url?: string | null;
  last_modified?: string | null;
  is_published: boolean;
  sync_status: string;
  sync_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UserBook {
  id: number;
  user_id: number;
  book_id: number;
  status: string;
  current_page: number;
  total_pages?: number | null;
  progress_percent: number;
  borrowed_at?: string | null;
  last_read_at?: string | null;
  completed_at?: string | null;
  book?: Book | null;
}

export interface Bookmark {
  id: number;
  user_id: number;
  book_id: number;
  page_number: number;
  note?: string | null;
  created_at?: string | null;
}

export interface BookNoteSourceStatus {
  id: number;
  user_id: number;
  book_id: number;
  status: "pending" | "processing" | "ready" | "failed";
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface CachedBookBlob {
  bookId: number;
  signature: string;
  blob: Blob;
  savedAt: number;
}

const BOOK_CACHE_DB = "memolink-book-cache";
const BOOK_CACHE_STORE = "books";
const BOOK_CACHE_VERSION = 1;

function bookCacheSignature(book: Book): string {
  return [
    book.onedrive_web_url ?? "",
    book.last_modified ?? "",
    book.file_size ?? "",
    book.file_name ?? "",
  ].join("|");
}

function openBookCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(BOOK_CACHE_DB, BOOK_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOK_CACHE_STORE)) {
        db.createObjectStore(BOOK_CACHE_STORE, { keyPath: "bookId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function getCachedBookBlob(bookId: number, signature: string): Promise<Blob | null> {
  const db = await openBookCache();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(BOOK_CACHE_STORE, "readonly");
    const store = tx.objectStore(BOOK_CACHE_STORE);
    const request = store.get(bookId);
    request.onsuccess = () => {
      const cached = request.result as CachedBookBlob | undefined;
      resolve(cached?.signature === signature ? cached.blob : null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

async function putCachedBookBlob(bookId: number, signature: string, blob: Blob): Promise<void> {
  const db = await openBookCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(BOOK_CACHE_STORE, "readwrite");
    tx.objectStore(BOOK_CACHE_STORE).put({ bookId, signature, blob, savedAt: Date.now() } satisfies CachedBookBlob);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); resolve(); };
  });
}

export async function listBooks(params?: { search?: string; category?: string; tag?: string }): Promise<Book[]> {
  return (await api.get("/books", { params })).data;
}

export async function listMyBooks(): Promise<UserBook[]> {
  return (await api.get("/books/my")).data;
}

export async function getBook(bookId: number): Promise<Book> {
  return (await api.get(`/books/${bookId}`)).data;
}

export async function borrowBook(bookId: number): Promise<UserBook> {
  return (await api.post(`/books/${bookId}/borrow`)).data;
}

export async function removeFromMyBooks(bookId: number): Promise<{ removed: boolean }> {
  return (await api.delete(`/books/${bookId}/my`)).data;
}

export async function updateBookProgress(bookId: number, currentPage: number, totalPages?: number | null): Promise<UserBook> {
  return (await api.post(`/books/${bookId}/progress`, { current_page: currentPage, total_pages: totalPages ?? null })).data;
}

export async function addBookmark(bookId: number, pageNumber: number, note?: string | null): Promise<Bookmark> {
  return (await api.post(`/books/${bookId}/bookmark`, { page_number: pageNumber, note: note ?? null })).data;
}

export async function listBookmarks(bookId: number): Promise<Bookmark[]> {
  return (await api.get(`/books/${bookId}/bookmarks`)).data;
}

export async function fetchBookBlob(bookOrId: Book | number): Promise<Blob> {
  const bookId = typeof bookOrId === "number" ? bookOrId : bookOrId.id;
  const signature = typeof bookOrId === "number" ? "" : bookCacheSignature(bookOrId);
  const cached = await getCachedBookBlob(bookId, signature);
  if (cached) return cached;

  const r = await api.get(`/books/${bookId}/read`, { responseType: "blob" });
  await putCachedBookBlob(bookId, signature, r.data);
  return r.data;
}

export async function saveAsNoteSource(bookId: number): Promise<BookNoteSourceStatus> {
  return (await api.post(`/books/${bookId}/save-as-note-source`)).data;
}

export async function getNoteSourceStatus(bookId: number): Promise<BookNoteSourceStatus | null> {
  return (await api.get(`/books/${bookId}/note-source-status`)).data;
}
