import React, { useEffect, useRef, useState } from "react";
import {
  browseEmails,
  archiveEmail,
  trashEmail,
  pinEmail,
  unpinEmail,
  type BrowseEmailResult,
  type EmailAccount,
} from "../api/emailApi";
import { readEmailCache, writeEmailCache } from "../utils/emailCache";
import { initialsFor, avatarColorFor } from "../utils/avatar";

const POLL_MS = 60000;

interface FolderDef {
  key: "inbox" | "outbox" | "drafts" | "trash";
  label: string;
  iconPath: string;
}

const FOLDERS: FolderDef[] = [
  {
    key: "inbox",
    label: "Inbox",
    iconPath: "M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z",
  },
  {
    key: "outbox",
    label: "Sent",
    iconPath: "M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z",
  },
  {
    key: "drafts",
    label: "Drafts",
    iconPath: "M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zM1.293 11.793 1 14.5l2.707-.293L9.5 8.414 7.586 6.5z",
  },
  {
    key: "trash",
    label: "Deleted",
    iconPath: "M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0zM14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z",
  },
];

interface FolderState {
  emails: BrowseEmailResult[];
  nextPageToken: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadedOnce: boolean;
}

const EMPTY_STATE: FolderState = {
  emails: [],
  nextPageToken: null,
  loading: false,
  loadingMore: false,
  error: null,
  loadedOnce: false,
};

interface EmailFolderBrowserProps {
  account: EmailAccount;
  onOpenEmail: (email: BrowseEmailResult) => void;
  selectedGmailMessageId?: string | null;
  onEmailArchived?: (gmailMessageId: string) => void;
  onEmailTrashed?: (gmailMessageId: string) => void;
  onPinChanged?: (gmailMessageId: string, isPinned: boolean) => void;
  onUnreadCountChange?: (accountId: number, count: number) => void;
  // When provided, clicking a folder (Inbox/Sent/etc.) opens it as an in-app tab
  // instead of expanding the folder inline in this sidebar list.
  onOpenFolderTab?: (folder: FolderDef["key"], folderLabel: string) => void;
}

export function EmailFolderBrowser({
  account,
  onOpenEmail,
  selectedGmailMessageId,
  onEmailArchived,
  onEmailTrashed,
  onPinChanged,
  onUnreadCountChange,
  onOpenFolderTab,
}: EmailFolderBrowserProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folderState, setFolderState] = useState<Record<string, FolderState>>({});
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const loadedKeysRef = useRef<Set<FolderDef["key"]>>(new Set());

  useEffect(() => {
    const inboxEmails = folderState.inbox?.emails ?? [];
    onUnreadCountChange?.(account.id, inboxEmails.filter((e) => !e.is_read).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderState.inbox, account.id]);

  function getState(key: string): FolderState {
    return folderState[key] ?? EMPTY_STATE;
  }

  function cacheKey(key: FolderDef["key"]) {
    return `${account.id}:${key}`;
  }

  async function loadFolder(key: FolderDef["key"], pageToken?: string | null, silent = false): Promise<boolean> {
    const isFreshLoad = !pageToken;
    if (isFreshLoad) {
      if (!silent) {
        const cached = readEmailCache<{ emails: BrowseEmailResult[]; nextPageToken: string | null }>(cacheKey(key));
        if (cached) {
          setFolderState((prev) => ({
            ...prev,
            [key]: { emails: cached.emails, nextPageToken: cached.nextPageToken, loading: false, loadingMore: false, error: null, loadedOnce: true },
          }));
        } else {
          setFolderState((prev) => ({ ...prev, [key]: { ...getState(key), loading: true, error: null } }));
        }
      }
    } else {
      setFolderState((prev) => ({ ...prev, [key]: { ...getState(key), loadingMore: true, error: null } }));
    }
    try {
      const res = await browseEmails({ folder: key, emailAccountId: account.id, pageToken, pageSize: account.page_size });
      setFolderState((prev) => {
        const prevEmails = prev[key]?.emails ?? [];
        let emails: BrowseEmailResult[];
        if (pageToken) {
          emails = [...prevEmails, ...res.emails];
        } else if (prevEmails.length === 0) {
          emails = res.emails;
        } else {
          // Merge a refreshed first page: new mail lands on top, anything
          // already loaded that isn't in the fresh page stays put.
          const freshIds = new Set(res.emails.map((e) => e.gmail_message_id));
          const stale = prevEmails.filter((e) => !freshIds.has(e.gmail_message_id));
          emails = [...res.emails, ...stale];
        }
        if (isFreshLoad) writeEmailCache(cacheKey(key), { emails, nextPageToken: res.next_page_token });
        return {
          ...prev,
          [key]: {
            emails,
            nextPageToken: res.next_page_token,
            loading: false,
            loadingMore: false,
            error: null,
            loadedOnce: true,
          },
        };
      });
      loadedKeysRef.current.add(key);
      return true;
    } catch (err: any) {
      loadedKeysRef.current.add(key);
      setFolderState((prev) => ({
        ...prev,
        [key]: {
          ...getState(key),
          loading: false,
          loadingMore: false,
          error: prev[key]?.loadedOnce ? null : (err?.response?.data?.detail || "Failed to load emails"),
          loadedOnce: true,
        },
      }));
      return false;
    }
  }

  useEffect(() => {
    // Load inbox in the background on mount (even if collapsed) so the
    // unread-count badge has data without requiring the user to expand it.
    // Retries with backoff if the first attempt fails (e.g. a token refresh
    // still in flight) instead of getting stuck until the user clicks in.
    let cancelled = false;
    let attempt = 0;
    async function preloadInbox() {
      const ok = await loadFolder("inbox", undefined, true);
      if (!ok && !cancelled && attempt < 3) {
        attempt += 1;
        setTimeout(preloadInbox, 3000 * attempt);
      }
    }
    preloadInbox();
    const interval = setInterval(() => {
      loadedKeysRef.current.forEach((key) => loadFolder(key, undefined, true));
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  function toggleFolder(key: FolderDef["key"]) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!getState(key).loadedOnce) loadFolder(key);
  }

  function patchEmail(key: string, gmailMessageId: string, patch: Partial<BrowseEmailResult> | null) {
    setFolderState((prev) => {
      const state = prev[key];
      if (!state) return prev;
      const emails = patch
        ? state.emails.map((m) => (m.gmail_message_id === gmailMessageId ? { ...m, ...patch } : m))
        : state.emails.filter((m) => m.gmail_message_id !== gmailMessageId);
      return { ...prev, [key]: { ...state, emails } };
    });
  }

  async function handleArchive(e: React.MouseEvent, key: string, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      await archiveEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      patchEmail(key, email.gmail_message_id, null);
      onEmailArchived?.(email.gmail_message_id);
    } catch {
      /* ignore */
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTrash(e: React.MouseEvent, key: string, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      await trashEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      patchEmail(key, email.gmail_message_id, null);
      onEmailTrashed?.(email.gmail_message_id);
    } catch {
      /* ignore */
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTogglePin(e: React.MouseEvent, key: string, email: BrowseEmailResult) {
    e.stopPropagation();
    if (!email.gmail_message_id) return;
    setActionLoadingId(email.gmail_message_id);
    try {
      if (email.is_pinned) await unpinEmail(email.gmail_message_id);
      else await pinEmail(email.gmail_message_id, email.email_account_id ?? undefined);
      patchEmail(key, email.gmail_message_id, { is_pinned: !email.is_pinned });
      onPinChanged?.(email.gmail_message_id, !email.is_pinned);
    } catch {
      /* ignore */
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {FOLDERS.map((folder) => {
        const isOpen = expanded.has(folder.key);
        const state = getState(folder.key);
        return (
          <div key={folder.key} className="rounded-lg overflow-hidden">
            <button
              onClick={() => (onOpenFolderTab ? onOpenFolderTab(folder.key, folder.label) : toggleFolder(folder.key))}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-[#1e1e2c] transition text-left"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d={folder.iconPath} />
              </svg>
              <span className="flex-1 text-[11px] font-medium text-gray-300">{folder.label}</span>
              {isOpen && (
                <span
                  role="button"
                  title="Refresh"
                  onClick={(e) => { e.stopPropagation(); loadFolder(folder.key); }}
                  className="w-3.5 h-3.5 flex items-center justify-center text-gray-600 hover:text-indigo-300 transition shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-2.5 h-2.5 ${state.loading ? "animate-spin" : ""}`} fill="currentColor" viewBox="0 0 16 16">
                    <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2zm.5-.5v1.5a.5.5 0 1 1-1 0V2.5a.5.5 0 0 1 1 0z"/>
                  </svg>
                </span>
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-2.5 h-2.5 text-gray-600 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                fill="currentColor" viewBox="0 0 16 16"
              >
                <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z" />
              </svg>
            </button>

            {isOpen && (
              <div className="px-2 pb-2 flex flex-col gap-1 border-t border-[var(--ml-bg-hover)]">
                {state.loading ? (
                  <p className="text-[11px] text-gray-600 text-center py-2">Loading…</p>
                ) : state.error ? (
                  <p className="text-[11px] text-red-400 text-center py-2">{state.error}</p>
                ) : state.emails.length === 0 ? (
                  <p className="text-[11px] text-gray-600 text-center py-2">No emails.</p>
                ) : (
                  state.emails.map((email) => {
                    const isActive = !!selectedGmailMessageId && selectedGmailMessageId === email.gmail_message_id;
                    const isActing = actionLoadingId === email.gmail_message_id;
                    const dateLabel = email.email_date
                      ? new Date(email.email_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                      : "";
                    return (
                      <div
                        key={email.gmail_message_id}
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
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {dateLabel && <span className="text-[9px] text-gray-600">{dateLabel}</span>}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button
                                title={email.is_pinned ? "Unpin" : "Pin"}
                                disabled={isActing}
                                onClick={(e) => handleTogglePin(e, folder.key, email)}
                                className={`w-4 h-4 flex items-center justify-center text-[10px] rounded transition disabled:opacity-40 ${
                                  email.is_pinned ? "text-blue-400" : "text-gray-600 hover:text-blue-400"
                                }`}
                              >
                                📌
                              </button>
                              <button
                                title="Archive"
                                disabled={isActing}
                                onClick={(e) => handleArchive(e, folder.key, email)}
                                className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-amber-400 transition disabled:opacity-40"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                                  <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v1A1.5 1.5 0 0 1 13.5 6v6.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 1 4.5zM3 6v6.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V6zm-.5-3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zM6.5 7.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5"/>
                                </svg>
                              </button>
                              <button
                                title="Trash"
                                disabled={isActing}
                                onClick={(e) => handleTrash(e, folder.key, email)}
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
                {state.nextPageToken && !state.loading && (
                  <button
                    onClick={() => loadFolder(folder.key, state.nextPageToken)}
                    disabled={state.loadingMore}
                    className="mt-1 w-full text-center text-[10px] text-indigo-400 hover:text-indigo-300 py-1.5 rounded-lg border border-[var(--ml-bg-hover)] hover:border-indigo-500/30 transition disabled:opacity-40"
                  >
                    {state.loadingMore ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
