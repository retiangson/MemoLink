import type { BrowseEmailResult, EmailAccount } from "../api/emailApi";
import type { EmailListScope } from "../hooks/useEmailTabs";
import { EmailAllMailList } from "./EmailAllMailList";
import { EmailSingleFolderList } from "./EmailSingleFolderList";
import { EmailTabContent } from "./EmailTabContent";

interface EmailListTabContentProps {
  scope: EmailListScope;
  viewingEmail: BrowseEmailResult | null;
  onOpenEmail: (email: BrowseEmailResult) => void;
  onBack: () => void;
  emailAccounts: EmailAccount[];
  actionLoading?: boolean;
  onArchive: () => Promise<void>;
  onTrash: () => Promise<void>;
  onTogglePin: () => Promise<void>;
  replyDraft?: string;
  onReplyDraftChange?: (gmailMessageId: string, draft: string) => void;
}

export function EmailListTabContent({
  scope,
  viewingEmail,
  onOpenEmail,
  onBack,
  emailAccounts,
  actionLoading,
  onArchive,
  onTrash,
  onTogglePin,
  replyDraft,
  onReplyDraftChange,
}: EmailListTabContentProps) {
  const label = scope.type === "all" ? "All Mail" : scope.folderLabel;

  if (viewingEmail) {
    return (
      <div className="flex-1 overflow-hidden flex flex-col">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition px-4 py-2 border-b border-[var(--ml-bg-hover)] shrink-0 self-start"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
            <path fillRule="evenodd" d="M15 8a.5.5 0 0 1-.5.5H2.707l3.147 3.146a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 7.5H14.5A.5.5 0 0 1 15 8" />
          </svg>
          Back to {label}
        </button>
        <EmailTabContent
          email={viewingEmail}
          actionLoading={actionLoading}
          onArchive={onArchive}
          onTrash={onTrash}
          onTogglePin={onTogglePin}
          replyDraft={replyDraft}
          onReplyDraftChange={onReplyDraftChange}
        />
      </div>
    );
  }

  const account = scope.type === "account" ? emailAccounts.find((a) => a.id === scope.accountId) : null;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-white mb-3">{label}</h2>
      {scope.type === "all" ? (
        <EmailAllMailList onOpenEmail={onOpenEmail} />
      ) : account ? (
        <EmailSingleFolderList account={account} folder={scope.folder} onOpenEmail={onOpenEmail} />
      ) : (
        <p className="text-sm text-gray-500">Account not found.</p>
      )}
    </div>
  );
}
