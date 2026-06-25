import type { BrowseEmailResult, EmailAccount } from "../api/emailApi";
import type { EmailFolder, EmailListScope } from "../hooks/useEmailTabs";
import { EmailAllMailList } from "./EmailAllMailList";
import { EmailSingleFolderList } from "./EmailSingleFolderList";
import { EmailTabContent } from "./EmailTabContent";
import { FOLDERS } from "./EmailFolderBrowser";

interface EmailListTabContentProps {
  scope: EmailListScope;
  selectedFolder: EmailFolder;
  onFolderChange: (folder: EmailFolder) => void;
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
  selectedFolder,
  onFolderChange,
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
  const account = scope.type === "account" ? emailAccounts.find((a) => a.id === scope.accountId) : null;
  const label = scope.type === "all" ? "All Mail" : account?.display_name || account?.email || "Account";

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

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-white">{label}</h2>
      </div>

      {scope.type === "account" && (
        <div className="flex items-center gap-1 px-4 border-b border-[var(--ml-bg-hover)] shrink-0">
          {FOLDERS.map((folder) => (
            <button
              key={folder.key}
              onClick={() => onFolderChange(folder.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition ${
                selectedFolder === folder.key
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d={folder.iconPath} />
              </svg>
              {folder.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {scope.type === "all" ? (
          <EmailAllMailList onOpenEmail={onOpenEmail} />
        ) : account ? (
          <EmailSingleFolderList account={account} folder={selectedFolder} onOpenEmail={onOpenEmail} />
        ) : (
          <p className="text-sm text-gray-500">Account not found.</p>
        )}
      </div>
    </div>
  );
}
