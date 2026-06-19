import React, { useEffect, useState } from "react";
import {
  browseEmails,
  archiveEmail,
  trashEmail,
  pinEmail,
  unpinEmail,
  type BrowseEmailResult,
} from "../api/emailApi";
import { readEmailCache, writeEmailCache } from "../utils/emailCache";
import { initialsFor, avatarColorFor } from "../utils/avatar";

const CACHE_KEY = "all";
const POLL_MS = 60000;

interface EmailAllMailListProps {
  onOpenEmail: (email: BrowseEmailResult) => void;
  selectedGmailMessageId?: string | null;
  onEmailArchived?: (gmailMessageId: string) => void;
  onEmailTrashed?: (gmailMessageId: string) => void;
  onPinChanged?: (gmailMessageId: string, isPinned: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
}

export function EmailAllMailList({
  onOpenEmail,
  selectedGmailMessageId,
  onEmailArchived,
  onEmailTrashed,
  onPinChanged,
  onUnreadCountChange,
}: EmailAllMailListProps) {
  const [emails, setEmails] = useState<BrowseEmailResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(undefined, true), POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onUnreadCountChange?.(emails.filter((e) => !e.is_read).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails]);

  async function load(pageToken?: string | null, silent = false) {
    const isFreshLoad = !pageToken;
    if (isFreshLoad) {
      if (!silent) {
        const cached = readEmailCache<{ emails: BrowseEmailResult[]; nextPageToken: string | null }>(CACHE_KEY);
        if (cached) {
          setEmails(cached.emails);
          setNextPageToken(cached.nextPageToken);
          setLoadedOnce(true);
        } else {
          setLoading(true);
        }
      }
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const res = await browseEmails({ folder: "all", pageToken });
      setEmails((prev) => {
        let next: BrowseEmailResult[];
        if (pageToken) {
          next = [...prev, ...res.emails];
        } else if (prev.length === 0) {
          next = res.emails;
        } else {
          // Merge a refreshed first page: new mail lands on top, anything
          // already loaded (older page-1 items or "load more" pages) that
          // isn't in the fresh page stays put rather than being dropped.
          const freshIds = new Set(res.emails.map((e) => e.gmail_message_id));
          const stale = prev.filter((e) => !freshIds.has(e.gmail_message_id));
          next = [...res.emails, ...stale];
        }
        if (isFreshLoad) writeEmailCache(CACHE_KEY, { emails: next, nextPageToken: res.next_page_token });
        return next;
      });
      setNextPageToken(res.next_page_token);
    } catch (err: any) {
      if (!loadedOnce && !silent) setError(err?.response?.data?.detail || "Failed to load emails");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setLoadedOnce(true);
    }
  }

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await load(undefined, true);
    } finally {
      setRefreshing(false);
    }
  }

  function patchEmail(gmailMessageId: string, patch: Partial<BrowseEmailResult> | null) {
    setEmails((prev) =>
      patch
        ? prev.map((m) => (m.gmail_message_id === gmailMessageId ? { ...m, ...patch } : m))
        : prev.filter((m) => m.gmail_message_id !== gmailMessageId)
    );
  }

  async function handleArchive(e: React.MouseEvent, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      await archiveEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      patchEmail(email.gmail_message_id, null);
      onEmailArchived?.(email.gmail_message_id);
    } catch {
      /* ignore */
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
      patchEmail(email.gmail_message_id, null);
      onEmailTrashed?.(email.gmail_message_id);
    } catch {
      /* ignore */
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTogglePin(e: React.MouseEvent, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      if (email.is_pinned) await unpinEmail(email.gmail_message_id);
      else await pinEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      patchEmail(email.gmail_message_id, { is_pinned: !email.is_pinned });
      onPinChanged?.(email.gmail_message_id, !email.is_pinned);
    } catch {
      /* ignore */
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleManualRefresh}
        disabled={refreshing || loading}
        title="Refresh"
        className="self-end flex items-center gap-1 text-[10px] text-gray-600 hover:text-indigo-300 transition disabled:opacity-40 px-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-2.5 h-2.5 ${refreshing ? "animate-spin" : ""}`} fill="currentColor" viewBox="0 0 16 16">
          <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2zm.5-.5v1.5a.5.5 0 1 1-1 0V2.5a.5.5 0 0 1 1 0z"/>
        </svg>
        Refresh
      </button>
      {loading ? (
        <p className="text-[11px] text-gray-600 text-center py-2">Loading…</p>
      ) : error ? (
        <p className="text-[11px] text-red-400 text-center py-2">{error}</p>
      ) : emails.length === 0 ? (
        <p className="text-[11px] text-gray-600 text-center py-2">{loadedOnce ? "No emails." : ""}</p>
      ) : (
        emails.map((email) => {
          const isActive = !!selectedGmailMessageId && selectedGmailMessageId === email.gmail_message_id;
          const isActing = actionLoadingId === email.gmail_message_id;
          const dateLabel = email.email_date
            ? new Date(email.email_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "";
          return (
            <div
              key={`${email.email_account_id ?? "x"}-${email.gmail_message_id}`}
              onClick={() => onOpenEmail(email)}
              className={`group rounded-lg border px-2 py-1.5 cursor-pointer transition mt-1 ${
                isActive ? "bg-indigo-600/10 border-indigo-500/40" : "bg-[#131320] border-[var(--ml-bg-hover)] hover:border-blue-500/30"
              }`}
            >
              <div className="flex items-start gap-2">
                {(() => {
                  const label = email.sender_name || email.sender_email || "?";
                  const color = avatarColorFor(email.sender_email || label);
                  return (
                    <div
                      title={label}
                      className={`h-7 w-7 shrink-0 rounded-full border ${color.border} ${color.bg} ${color.text} flex items-center justify-center text-[10px] font-semibold`}
                    >
                      {initialsFor(label)}
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${email.is_read ? "bg-transparent" : "bg-indigo-400"}`} title={email.is_read ? undefined : "Unread"} />
                    <span className={`text-[11px] truncate ${email.is_read ? "font-normal text-gray-400" : "font-bold text-gray-100"}`}>
                      {email.sender_name || email.sender_email}
                    </span>
                  </p>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{email.subject || "(no subject)"}</p>
                  {email.snippet && (
                    <p className="text-[10px] text-gray-600 truncate mt-0.5">{email.snippet}</p>
                  )}
                  {email.email_address && (
                    <p className="text-[9px] text-gray-700 truncate mt-0.5">{email.email_address}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {dateLabel && <span className="text-[9px] text-gray-600">{dateLabel}</span>}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      title={email.is_pinned ? "Unpin" : "Pin"}
                      disabled={isActing}
                      onClick={(e) => handleTogglePin(e, email)}
                      className={`w-4 h-4 flex items-center justify-center text-[10px] rounded transition disabled:opacity-40 ${
                        email.is_pinned ? "text-blue-400" : "text-gray-600 hover:text-blue-400"
                      }`}
                    >
                      📌
                    </button>
                    <button
                      title="Archive"
                      disabled={isActing}
                      onClick={(e) => handleArchive(e, email)}
                      className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-amber-400 transition disabled:opacity-40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6v6.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 1 4.5zM3 6v6.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V6zm-.5-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5"/>
                      </svg>
                    </button>
                    <button
                      title="Trash"
                      disabled={isActing}
                      onClick={(e) => handleTrash(e, email)}
                      className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-red-400 transition disabled:opacity-40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
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
          onClick={() => load(nextPageToken)}
          disabled={loadingMore}
          className="mt-1 w-full text-center text-[10px] text-indigo-400 hover:text-indigo-300 py-1.5 rounded-lg border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 transition disabled:opacity-40"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
