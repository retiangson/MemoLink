import React, { useEffect, useState } from "react";
import {
  listAdminBooks, getOneDriveStatus, getOneDriveAuthUrl, disconnectOneDrive,
  syncBooks, updateBookMetadata, publishBook, unpublishBook,
  publishAllBooks, unpublishAllBooks, publishSelectedBooks, unpublishSelectedBooks,
  type OneDriveStatus, type BookSyncResult,
} from "../api/adminBooksApi";
import type { Book } from "../api/booksApi";

const OFFICE_CLIENT_ID = "4765445b-32c6-49b0-83e6-1d93765276ca";
const ONEDRIVE_CALLBACK_PATH = "/api/admin/books/onedrive/callback";

export function AdminBooksPanel() {
  const [status, setStatus] = useState<OneDriveStatus | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<BookSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; author: string; description: string; category: string; tags: string }>({
    title: "", author: "", description: "", category: "", tags: "",
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    loadStatusAndBooks(1);
    const params = new URLSearchParams(window.location.search);
    if (params.get("onedrive_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      loadStatusAndBooks(1);
    }
  }, []);

  async function loadStatusAndBooks(targetPage: number) {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([getOneDriveStatus(), listAdminBooks({ search: search || undefined, page: targetPage })]);
      setStatus(s);
      setBooks(b.items);
      setPage(b.page);
      setPages(b.pages);
      setTotal(b.total);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function loadBooks(targetPage: number) {
    setLoading(true);
    try {
      const b = await listAdminBooks({ search: search || undefined, page: targetPage });
      setBooks(b.items);
      setPage(b.page);
      setPages(b.pages);
      setTotal(b.total);
      setSelectedIds(new Set());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const url = await getOneDriveAuthUrl();
      const authUrl = new URL(url);
      const clientId = authUrl.searchParams.get("client_id")?.toLowerCase();
      const redirectUri = authUrl.searchParams.get("redirect_uri") ?? "";
      if (
        authUrl.hostname !== "login.microsoftonline.com" ||
        clientId === OFFICE_CLIENT_ID ||
        redirectUri.includes("m365.cloud.microsoft") ||
        !redirectUri.includes(ONEDRIVE_CALLBACK_PATH)
      ) {
        throw new Error("The server returned a Microsoft 365/Office sign-in URL instead of MemoLink's OneDrive callback URL. Check MICROSOFT_CLIENT_ID and MICROSOFT_REDIRECT_URI.");
      }
      window.location.href = url;
    } catch (err: any) {
      setConnecting(false);
      setError(err?.response?.data?.detail ?? err?.message ?? "Could not start OneDrive connection. Check server configuration.");
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect OneDrive? Synced book metadata stays, but you won't be able to sync or read books until you reconnect.")) return;
    try { await disconnectOneDrive(); await loadStatusAndBooks(1); } catch { /* ignore */ }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const result = await syncBooks();
      setSyncResult(result);
      await loadStatusAndBooks(1);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  function startEdit(book: Book) {
    setEditingId(book.id);
    setEditForm({
      title: book.title, author: book.author ?? "", description: book.description ?? "",
      category: book.category ?? "", tags: book.tags ?? "",
    });
  }

  async function saveEdit() {
    if (editingId == null) return;
    try {
      const updated = await updateBookMetadata(editingId, editForm);
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setEditingId(null);
    } catch { alert("Could not save changes."); }
  }

  async function togglePublish(book: Book) {
    try {
      const updated = book.is_published ? await unpublishBook(book.id) : await publishBook(book.id);
      setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch { alert("Could not update publish status."); }
  }

  function toggleSelected(bookId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelectedIds((prev) => {
      const allSelected = books.length > 0 && books.every((b) => prev.has(b.id));
      if (allSelected) return new Set();
      return new Set(books.map((b) => b.id));
    });
  }

  async function handlePublishAll() {
    if (!confirm(`Publish all ${total} books in the library?`)) return;
    setBulkBusy(true);
    try {
      await publishAllBooks();
      await loadBooks(page);
    } catch { alert("Could not publish all books."); }
    finally { setBulkBusy(false); }
  }

  async function handleUnpublishAll() {
    if (!confirm(`Unpublish all ${total} books in the library? They will no longer be visible to readers.`)) return;
    setBulkBusy(true);
    try {
      await unpublishAllBooks();
      await loadBooks(page);
    } catch { alert("Could not unpublish all books."); }
    finally { setBulkBusy(false); }
  }

  async function handlePublishSelected() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await publishSelectedBooks(Array.from(selectedIds));
      await loadBooks(page);
    } catch { alert("Could not publish selected books."); }
    finally { setBulkBusy(false); }
  }

  async function handleUnpublishSelected() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await unpublishSelectedBooks(Array.from(selectedIds));
      await loadBooks(page);
    } catch { alert("Could not unpublish selected books."); }
    finally { setBulkBusy(false); }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Books Library</h2>

      <div className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-200 font-medium">OneDrive connection</p>
            {status?.connected ? (
              <p className="text-xs text-gray-500 mt-0.5">Connected as {status.display_name || status.email}</p>
            ) : (
              <p className="text-xs text-gray-500 mt-0.5">Connect a OneDrive account to sync books. Files stay in OneDrive — only metadata is synced.</p>
            )}
          </div>
          {status?.connected ? (
            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
            >
              {connecting ? "Redirecting…" : "Connect OneDrive"}
            </button>
          )}
        </div>

        {status?.connected && (
          <div className="mt-3 pt-3 border-t border-[var(--ml-bg-hover)] flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync Books from OneDrive"}
            </button>
            {syncResult && (
              <p className="text-xs text-gray-500">
                Scanned {syncResult.scanned} · {syncResult.created} new · {syncResult.updated} updated
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") loadBooks(1); }}
        placeholder="Search books by title or author…"
        className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-4 py-2.5 text-sm text-gray-200 mb-3"
      />

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePublishAll}
            disabled={bulkBusy || total === 0}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
          >
            Publish All
          </button>
          <button
            onClick={handleUnpublishAll}
            disabled={bulkBusy || total === 0}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
          >
            Unpublish All
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{selectedIds.size > 0 ? `${selectedIds.size} selected` : ""}</span>
          <button
            onClick={handlePublishSelected}
            disabled={bulkBusy || selectedIds.size === 0}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition disabled:opacity-50"
          >
            Publish Selected
          </button>
          <button
            onClick={handleUnpublishSelected}
            disabled={bulkBusy || selectedIds.size === 0}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
          >
            Unpublish Selected
          </button>
        </div>
      </div>

      {!loading && books.length > 0 && (
        <label className="flex items-center gap-2 mb-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={books.length > 0 && books.every((b) => selectedIds.has(b.id))}
            onChange={toggleSelectAllOnPage}
            className="accent-indigo-500"
          />
          Select all on this page
        </label>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : books.length === 0 ? (
        <p className="text-sm text-gray-500">
          {search ? "No books match your search." : "No books synced yet. Connect OneDrive and run a sync."}
        </p>
      ) : (
        <div className="space-y-2">
          {books.map((book) => (
            <div key={book.id} className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl p-3">
              {editingId === book.id ? (
                <div className="space-y-2">
                  <input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Title"
                    className="w-full bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-sm text-gray-200"
                  />
                  <input
                    value={editForm.author}
                    onChange={(e) => setEditForm((f) => ({ ...f, author: e.target.value }))}
                    placeholder="Author"
                    className="w-full bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-sm text-gray-200"
                  />
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Description"
                    rows={2}
                    className="w-full bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-sm text-gray-200"
                  />
                  <div className="flex gap-2">
                    <input
                      value={editForm.category}
                      onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      placeholder="Category"
                      className="flex-1 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-sm text-gray-200"
                    />
                    <input
                      value={editForm.tags}
                      onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                      placeholder="Tags (comma-separated)"
                      className="flex-1 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-sm text-gray-200"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs rounded-lg text-gray-400 hover:bg-[var(--ml-bg-panel)]">Cancel</button>
                    <button onClick={saveEdit} className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(book.id)}
                      onChange={() => toggleSelected(book.id)}
                      className="accent-indigo-500 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200 truncate">{book.title}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {book.author || "Unknown author"} · {book.file_name}
                        {book.sync_status !== "synced" && <span className="text-amber-400"> · {book.sync_status}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${book.is_published ? "bg-green-500/20 text-green-400" : "bg-gray-600/30 text-gray-400"}`}>
                      {book.is_published ? "Published" : "Unpublished"}
                    </span>
                    <button onClick={() => startEdit(book)} className="px-2.5 py-1 text-xs rounded-lg text-gray-400 hover:bg-[var(--ml-bg-panel)]">Edit</button>
                    <button
                      onClick={() => togglePublish(book)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition ${
                        book.is_published ? "border border-red-500/40 text-red-400 hover:bg-red-500/10" : "bg-indigo-600 hover:bg-indigo-500 text-white"
                      }`}
                    >
                      {book.is_published ? "Unpublish" : "Publish"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && books.length > 0 && pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            disabled={page <= 1}
            onClick={() => loadBooks(page - 1)}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[var(--ml-bg-hover)] rounded-lg disabled:opacity-30 transition"
          >← Prev</button>
          <span className="text-xs text-gray-600">Page {page} of {pages} · {total} books</span>
          <button
            disabled={page >= pages}
            onClick={() => loadBooks(page + 1)}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-[var(--ml-bg-hover)] rounded-lg disabled:opacity-30 transition"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
