import React, { useState } from "react";
import type { EmailAccount } from "../api/emailApi";

export type EmailTreeSelection =
  | { kind: "all" }
  | { kind: "folder"; accountId: number; folder: "inbox" | "outbox" | "drafts" | "trash" };

interface EmailTreeNavProps {
  emailAccounts: EmailAccount[];
  selection: EmailTreeSelection;
  onSelect: (selection: EmailTreeSelection) => void;
}

const MAIL_ICON_PATH =
  "M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z";

function isSameSelection(a: EmailTreeSelection, b: EmailTreeSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "all") return true;
  if (a.kind === "folder" && b.kind === "folder") return a.accountId === b.accountId && a.folder === b.folder;
  return false;
}

export function EmailTreeNav({ emailAccounts, selection, onSelect }: EmailTreeNavProps) {
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<number>>(
    () => new Set(emailAccounts.map((a) => a.id))
  );

  function toggleExpanded(accountId: number) {
    setExpandedAccountIds((prev) => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
      return next;
    });
  }

  function rowClass(selected: boolean) {
    return `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12px] transition ${
      selected
        ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
        : "text-gray-400 hover:bg-[var(--ml-bg-hover)] hover:text-gray-200 border border-transparent"
    }`;
  }

  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto h-full">
      <button
        onClick={() => onSelect({ kind: "all" })}
        className={rowClass(selection.kind === "all")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d={MAIL_ICON_PATH} />
        </svg>
        <span className="font-semibold">All Emails</span>
      </button>

      {emailAccounts.map((account) => {
        const expanded = expandedAccountIds.has(account.id);
        return (
          <div key={account.id} className="flex flex-col gap-0.5">
            <button
              onClick={() => toggleExpanded(account.id)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-left text-[11px] font-medium text-gray-300 hover:bg-[var(--ml-bg-hover)] transition"
              title={account.email}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-2.5 h-2.5 shrink-0 text-gray-600 transition-transform ${expanded ? "" : "-rotate-90"}`}
                fill="currentColor" viewBox="0 0 16 16"
              >
                <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z" />
              </svg>
              <span className="truncate">{account.email}</span>
            </button>

            {expanded && (
              <div className="ml-4 flex flex-col gap-0.5">
                <button
                  onClick={() => onSelect({ kind: "folder", accountId: account.id, folder: "inbox" })}
                  className={rowClass(isSameSelection(selection, { kind: "folder", accountId: account.id, folder: "inbox" }))}
                >
                  Inbox
                </button>
                <button
                  onClick={() => onSelect({ kind: "folder", accountId: account.id, folder: "outbox" })}
                  className={rowClass(isSameSelection(selection, { kind: "folder", accountId: account.id, folder: "outbox" }))}
                >
                  Sent
                </button>
                <button
                  onClick={() => onSelect({ kind: "folder", accountId: account.id, folder: "drafts" })}
                  className={rowClass(isSameSelection(selection, { kind: "folder", accountId: account.id, folder: "drafts" }))}
                >
                  Drafts
                </button>
                <button
                  onClick={() => onSelect({ kind: "folder", accountId: account.id, folder: "trash" })}
                  className={rowClass(isSameSelection(selection, { kind: "folder", accountId: account.id, folder: "trash" }))}
                >
                  Deleted
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
