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

export async function fetchBookBlob(bookId: number): Promise<Blob> {
  const r = await api.get(`/books/${bookId}/read`, { responseType: "blob" });
  return r.data;
}

export async function saveAsNoteSource(bookId: number): Promise<BookNoteSourceStatus> {
  return (await api.post(`/books/${bookId}/save-as-note-source`)).data;
}

export async function getNoteSourceStatus(bookId: number): Promise<BookNoteSourceStatus | null> {
  return (await api.get(`/books/${bookId}/note-source-status`)).data;
}
