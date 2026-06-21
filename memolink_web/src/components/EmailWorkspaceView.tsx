import React, { useState } from "react";
import type { EmailAccount } from "../api/emailApi";
import { archiveEmail, trashEmail, pinEmail, unpinEmail } from "../api/emailApi";
import { EmailTreeNav, type EmailTreeSelection } from "./EmailTreeNav";
import { EmailMessageList } from "./EmailMessageList";
import { EmailTabContent } from "./EmailTabContent";
import { EmailComposeTabContent } from "./EmailComposeTabContent";
import { useEmailTabs } from "../hooks/useEmailTabs";

interface EmailWorkspaceViewProps {
  emailAccounts: EmailAccount[];
}

export function EmailWorkspaceView({ emailAccounts }: EmailWorkspaceViewProps) {
  const [selection, setSelection] = useState<EmailTreeSelection>({ kind: "all" });
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const {
    openTabs,
    activeIndex,
    setActiveIndex,
    active,
    openEmailTab,
    closeEmailTab,
    closeEmailTabById,
    updateEmailTab,
    setEmailReplyDraft,
    setComposeDraft,
  } = useEmailTabs();

  if (emailAccounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Connect an email account in Settings to get started.
      </div>
    );
  }

  async function handleArchive() {
    if (!active || active.kind !== "view" || !active.email.gmail_message_id) return;
    const gmailMessageId = active.email.gmail_message_id;
    setActionLoadingId(gmailMessageId);
    try {
      await archiveEmail(gmailMessageId, active.email.email_account_id ?? undefined);
      closeEmailTabById(gmailMessageId);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTrash() {
    if (!active || active.kind !== "view" || !active.email.gmail_message_id) return;
    const gmailMessageId = active.email.gmail_message_id;
    setActionLoadingId(gmailMessageId);
    try {
      await trashEmail(gmailMessageId, active.email.email_account_id ?? undefined);
      closeEmailTabById(gmailMessageId);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleTogglePin() {
    if (!active || active.kind !== "view" || !active.email.gmail_message_id) return;
    const gmailMessageId = active.email.gmail_message_id;
    setActionLoadingId(gmailMessageId);
    try {
      if (active.email.is_pinned) {
        const res = await unpinEmail(gmailMessageId);
        updateEmailTab(gmailMessageId, { is_pinned: res.is_pinned });
      } else {
        const res = await pinEmail(gmailMessageId, active.email.email_account_id ?? undefined);
        updateEmailTab(gmailMessageId, { is_pinned: res.is_pinned, id: res.id });
      }
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-56 shrink-0 border-r border-[var(--ml-bg-panel)]">
        <EmailTreeNav
          emailAccounts={emailAccounts}
          selection={selection}
          onSelect={setSelection}
        />
      </div>

      <div className="w-96 shrink-0 border-r border-[var(--ml-bg-panel)] flex flex-col">
        <EmailMessageList
          selection={selection}
          emailAccounts={emailAccounts}
          selectedGmailMessageId={active?.kind === "view" ? (active.email.gmail_message_id ?? null) : null}
          onOpenEmail={openEmailTab}
          onEmailArchived={closeEmailTabById}
          onEmailTrashed={closeEmailTabById}
          onPinChanged={(gmailMessageId, isPinned) => updateEmailTab(gmailMessageId, { is_pinned: isPinned })}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {openTabs.length > 0 && (
          <div className="flex items-stretch border-b border-[var(--ml-bg-panel)] shrink-0 overflow-x-auto">
            {openTabs.map((tab, i) => (
              <div
                key={tab.kind === "view" ? tab.email.gmail_message_id : tab.composeId}
                onClick={() => setActiveIndex(i)}
                className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-[var(--ml-bg-panel)] max-w-[180px] shrink-0 ${
                  i === activeIndex ? "bg-[var(--ml-bg-surface)] text-gray-100" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <span className="truncate">{tab.kind === "view" ? (tab.email.subject || "(no subject)") : "New Mail"}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeEmailTab(i);
                  }}
                  className="text-gray-600 hover:text-gray-300 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {active && active.kind === "compose" ? (
          <EmailComposeTabContent
            key={active.composeId}
            accounts={emailAccounts}
            draft={active.draft}
            onDraftChange={(patch) => setComposeDraft(active.composeId, patch)}
          />
        ) : active ? (
          <EmailTabContent
            key={active.email.gmail_message_id}
            email={active.email}
            actionLoading={actionLoadingId === active.email.gmail_message_id}
            onArchive={handleArchive}
            onTrash={handleTrash}
            onTogglePin={handleTogglePin}
            replyDraft={active.replyDraft}
            onReplyDraftChange={setEmailReplyDraft}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
            Select an email to open it in a tab
          </div>
        )}
      </div>
    </div>
  );
}
