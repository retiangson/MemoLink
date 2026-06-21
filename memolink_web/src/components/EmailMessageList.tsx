import React, { useEffect, useState } from "react";
import {
  browseEmails,
  archiveEmail,
  trashEmail,
  pinEmail,
  unpinEmail,
  type BrowseEmailResult,
  type EmailAccount,
} from "../api/emailApi";
import type { EmailTreeSelection } from "./EmailTreeNav";

interface EmailMessageListProps {
  selection: EmailTreeSelection;
  emailAccounts: EmailAccount[];
  selectedGmailMessageId?: string | null;
  onOpenEmail: (email: BrowseEmailResult) => void;
  onEmailArchived?: (gmailMessageId: string) => void;
  onEmailTrashed?: (gmailMessageId: string) => void;
  onPinChanged?: (gmailMessageId: string, isPinned: boolean) => void;
}

function selectionKey(selection: EmailTreeSelection): string {
  if (selection.kind === "all") return "all";
  return `folder:${selection.accountId}:${selection.folder}`;
}

export function EmailMessageList({
  selection,
  emailAccounts,
  selectedGmailMessageId,
  onOpenEmail,
  onEmailArchived,
  onEmailTrashed,
  onPinChanged,
}: EmailMessageListProps) {
  const [emails, setEmails] = useState<BrowseEmailResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const folder = selection.kind === "all" ? "all" : selection.folder;
    const emailAccountId = selection.kind === "folder" ? selection.accountId : undefined;
    const account = emailAccountId != null ? emailAccounts.find((a) => a.id === emailAccountId) : undefined;
    browseEmails({ folder, emailAccountId, pageSize: account?.page_size })
      .then((res) => {
        if (cancelled) return;
        setEmails(res.emails);
        setNextPageToken(res.next_page_token);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail || "Failed to load emails");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey(selection)]);

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const folder = selection.kind === "all" ? "all" : selection.folder;
      const emailAccountId = selection.kind === "folder" ? selection.accountId : undefined;
      const account = emailAccountId != null ? emailAccounts.find((a) => a.id === emailAccountId) : undefined;
      const res = await browseEmails({ folder, emailAccountId, pageToken: nextPageToken, pageSize: account?.page_size });
      setEmails((prev) => [...prev, ...res.emails]);
      setNextPageToken(res.next_page_token);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to load more emails");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleArchive(e: React.MouseEvent, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      await archiveEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      setEmails((prev) => prev.filter((m) => m.gmail_message_id !== email.gmail_message_id));
      onEmailArchived?.(email.gmail_message_id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to archive email");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTrash(e: React.MouseEvent, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      await trashEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      setEmails((prev) => prev.filter((m) => m.gmail_message_id !== email.gmail_message_id));
      onEmailTrashed?.(email.gmail_message_id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to trash email");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTogglePin(e: React.MouseEvent, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      if (email.is_pinned) {
        await unpinEmail(email.gmail_message_id);
      } else {
        await pinEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      }
      setEmails((prev) =>
        prev.map((m) => (m.gmail_message_id === email.gmail_message_id ? { ...m, is_pinned: !m.is_pinned } : m))
      );
      onPinChanged?.(email.gmail_message_id, !email.is_pinned);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Failed to update pin");
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {error && (
        <p className="text-[11px] text-red-400 bg-red-500/10 px-3 py-2 shrink-0">{error}</p>
      )}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1.5">
        {loading ? (
          <p className="text-[12px] text-gray-600 text-center pt-6">Loading…</p>
        ) : emails.length === 0 ? (
          <p className="text-[12px] text-gray-600 text-center pt-6">No emails found.</p>
        ) : (
          emails.map((email) => {
            const account = email.email_account_id != null ? emailAccounts.find((a) => a.id === email.email_account_id) : undefined;
            const dateLabel = email.email_date
              ? new Date(email.email_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "";
            const isActive = !!selectedGmailMessageId && selectedGmailMessageId === email.gmail_message_id;
            const isActing = actionLoadingId === email.gmail_message_id;
            return (
              <div
                key={email.gmail_message_id}
                onClick={() => onOpenEmail(email)}
                className={`group rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                  isActive
                    ? "bg-indigo-600/10 border-indigo-500/40"
                    : "bg-[#131320] border-[var(--ml-bg-hover)] hover:border-blue-500/30"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-200 truncate">{email.subject || "(no subject)"}</p>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">
                      {email.sender_name || email.sender_email}
                      {selection.kind === "all" && (email.email_address || account?.email) && (
                        <span className="text-gray-700"> · {email.email_address || account?.email}</span>
                      )}
                    </p>
                    {email.snippet && (
                      <p className="text-[10px] text-gray-600 truncate mt-0.5">{email.snippet}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {dateLabel && <span className="text-[10px] text-gray-600">{dateLabel}</span>}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        title={email.is_pinned ? "Unpin" : "Pin"}
                        disabled={isActing}
                        onClick={(e) => handleTogglePin(e, email)}
                        className={`w-5 h-5 flex items-center justify-center text-xs rounded transition disabled:opacity-40 ${
                          email.is_pinned ? "text-blue-400" : "text-gray-600 hover:text-blue-400"
                        }`}
                      >
                        📌
                      </button>
                      <button
                        title="Archive"
                        disabled={isActing}
                        onClick={(e) => handleArchive(e, email)}
                        className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-amber-400 transition disabled:opacity-40"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6v6.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 1 4.5zM3 6v6.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V6zm-.5-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5"/>
                        </svg>
                      </button>
                      <button
                        title="Trash"
                        disabled={isActing}
                        onClick={(e) => handleTrash(e, email)}
                        className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition disabled:opacity-40"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                          <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {nextPageToken && !loading && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-1 w-full text-center text-[11px] text-indigo-400 hover:text-indigo-300 py-2 rounded-lg border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 transition disabled:opacity-40"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
