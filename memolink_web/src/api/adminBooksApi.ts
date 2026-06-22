import { api } from "./client";
import type { Book } from "./booksApi";

export interface OneDriveStatus {
  connected: boolean;
  display_name?: string;
  email?: string;
}

export interface BookSyncResult {
  scanned: number;
  created: number;
  updated: number;
}

export interface AdminBooksResponse {
  items: Book[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export async function listAdminBooks(params?: { search?: string; page?: number; page_size?: number }): Promise<AdminBooksResponse> {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  qs.set("page", String(params?.page ?? 1));
  qs.set("page_size", String(params?.page_size ?? 20));
  return (await api.get(`/admin/books?${qs}`)).data;
}

export async function getOneDriveStatus(): Promise<OneDriveStatus> {
  return (await api.get("/admin/books/onedrive/status")).data;
}

export async function getOneDriveAuthUrl(): Promise<string> {
  return (await api.get("/admin/books/onedrive/auth-url")).data.url;
}

export async function disconnectOneDrive(): Promise<void> {
  await api.delete("/admin/books/onedrive/disconnect");
}

export async function syncBooks(): Promise<BookSyncResult> {
  return (await api.post("/admin/books/sync")).data;
}

export async function updateBookMetadata(
  bookId: number,
  body: { title?: string; author?: string; description?: string; category?: string; tags?: string; cover_image_url?: string }
): Promise<Book> {
  return (await api.patch(`/admin/books/${bookId}`, body)).data;
}

export async function publishBook(bookId: number): Promise<Book> {
  return (await api.post(`/admin/books/${bookId}/publish`)).data;
}

export async function unpublishBook(bookId: number): Promise<Book> {
  return (await api.post(`/admin/books/${bookId}/unpublish`)).data;
}

export interface BulkPublishResult {
  updated: number;
}

export async function publishAllBooks(): Promise<BulkPublishResult> {
  return (await api.post("/admin/books/publish-all")).data;
}

export async function unpublishAllBooks(): Promise<BulkPublishResult> {
  return (await api.post("/admin/books/unpublish-all")).data;
}

export async function publishSelectedBooks(bookIds: number[]): Promise<BulkPublishResult> {
  return (await api.post("/admin/books/publish-selected", { book_ids: bookIds })).data;
}

export async function unpublishSelectedBooks(bookIds: number[]): Promise<BulkPublishResult> {
  return (await api.post("/admin/books/unpublish-selected", { book_ids: bookIds })).data;
}
