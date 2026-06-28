import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";
import { notifyNoteChanged } from "../utils/noteEvents";

export interface EmailAccount {
  id: number;
  email: string;
  provider: string;
  page_size?: number;
  display_name?: string | null;
}

export interface EmailStatus {
  connected: boolean;
  accounts: EmailAccount[];
}

export interface EmailAttachmentMeta {
  filename: string;
  attachment_id: string;
  size: number;
  mime_type: string;
  content_id: string | null;
  is_inline: boolean;
}

export interface EmailRecord {
  id: number;
  subject: string;
  sender_name: string | null;
  sender_email: string;
  snippet: string | null;
  body_text?: string;
  body_html?: string | null;
  attachments?: EmailAttachmentMeta[];
  importance_score: number;
  is_read: boolean;
  email_date: string | null;
  gmail_thread_id?: string | null;
  gmail_message_id?: string;
  email_account_id?: number | null;
}

export interface BrowseEmailResult extends Omit<EmailRecord, "id"> {
  id: number | null;
  email_address?: string;
  is_pinned?: boolean;
}

export interface BrowseEmailsResponse {
  emails: BrowseEmailResult[];
  next_page_token: string | null;
}

export type EmailFolder = "inbox" | "outbox" | "drafts" | "trash" | "all";

export interface EmailAttachmentRef {
  key: string;
  filename: string;
  contentType: string;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  filtered: number;
}

export function getAttachmentDownloadUrl(opts: {
  gmailMessageId: string;
  attachmentId: string;
  filename: string;
  emailAccountId?: number | null;
  inline?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("filename", opts.filename);
  const token = getToken();
  if (token) params.set("token", token);
  if (opts.emailAccountId != null) params.set("email_account_id", String(opts.emailAccountId));
  if (opts.inline) params.set("disposition", "inline");
  return `${API_BASE}/email/attachment/${encodeURIComponent(opts.gmailMessageId)}/${encodeURIComponent(opts.attachmentId)}?${params.toString()}`;
}

export async function getEmailStatus(): Promise<EmailStatus> {
  const res = await api.get("/email/status");
  return res.data;
}

export async function getEmailConnectUrl(): Promise<string> {
  const res = await api.get("/email/connect-url");
  return res.data.url;
}

export async function disconnectEmail(emailAddress?: string): Promise<void> {
  const params = emailAddress ? { email_address: emailAddress } : {};
  await api.delete("/email/disconnect", { params });
}

export async function syncEmails(): Promise<SyncResult> {
  const res = await api.post("/email/sync");
  return res.data;
}

export interface AutoProcessResult {
  synced: number;
  notes_added: number;
  reminders_created: number;
  filtered: number;
}

export async function autoProcessEmails(workspaceId?: number | null): Promise<AutoProcessResult> {
  const params = workspaceId != null ? { workspace_id: workspaceId } : {};
  const res = await api.post("/email/auto-process", null, { params });
  return res.data;
}

export async function listEmails(emailAccountId?: number): Promise<EmailRecord[]> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  const res = await api.get("/email/emails", { params });
  return res.data.emails;
}

export async function getEmail(id: number): Promise<EmailRecord> {
  const res = await api.get(`/email/emails/${id}`);
  return res.data;
}

export async function deleteEmail(id: number): Promise<void> {
  await api.delete(`/email/emails/${id}`);
}

export async function emailToNote(id: number): Promise<{ note_id: number; title: string }> {
  const res = await api.post(`/email/emails/${id}/to-note`);
  notifyNoteChanged({ noteId: res.data.note_id });
  return res.data;
}

export async function emailToReminder(id: number): Promise<{ reminder_id: number; text: string; due_date: string | null; due_time: string | null }> {
  const res = await api.post(`/email/emails/${id}/to-reminder`);
  return res.data;
}

export async function getReplySuggestions(id: number, draft?: string): Promise<string[]> {
  const res = await api.post(`/email/emails/${id}/reply-suggestions`, draft ? { draft } : {});
  return res.data.replies;
}

export async function sendEmailReply(id: number, body: string, attachments?: EmailAttachmentRef[]): Promise<void> {
  await api.post(`/email/emails/${id}/send-reply`, {
    body,
    attachments: attachments?.map((a) => ({ key: a.key, filename: a.filename, content_type: a.contentType })),
  });
}

export async function browseEmails(opts: {
  folder: EmailFolder;
  emailAccountId?: number;
  pageToken?: string | null;
  pageSize?: number;
}): Promise<BrowseEmailsResponse> {
  const params: Record<string, string | number> = { folder: opts.folder };
  if (opts.emailAccountId != null) params.email_account_id = opts.emailAccountId;
  if (opts.pageToken) params.page_token = opts.pageToken;
  if (opts.pageSize != null) params.page_size = opts.pageSize;
  const res = await api.get("/email/browse", { params });
  return res.data;
}

export async function archiveEmail(gmailMessageId: string, emailAccountId?: number): Promise<void> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  await api.post(`/email/gmail/${gmailMessageId}/archive`, null, { params });
}

export async function trashEmail(gmailMessageId: string, emailAccountId?: number): Promise<void> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  await api.post(`/email/gmail/${gmailMessageId}/trash`, null, { params });
}

export async function pinEmail(gmailMessageId: string, emailAccountId?: number): Promise<{ id: number; is_pinned: boolean }> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  const res = await api.post(`/email/gmail/${gmailMessageId}/pin`, null, { params });
  return res.data;
}

export async function unpinEmail(gmailMessageId: string): Promise<{ id: number; is_pinned: boolean }> {
  const res = await api.delete(`/email/gmail/${gmailMessageId}/pin`);
  return res.data;
}

export async function updateEmailAccountSettings(accountId: number, pageSize: number): Promise<{ id: number; page_size: number }> {
  const res = await api.put(`/email/accounts/${accountId}/settings`, { page_size: pageSize });
  return res.data;
}

export async function updateEmailAccountDisplayName(accountId: number, displayName: string | null): Promise<{ id: number; display_name: string | null }> {
  const res = await api.put(`/email/accounts/${accountId}/settings`, { display_name: displayName });
  return res.data;
}

export async function getGmailReplySuggestions(gmailMessageId: string, emailAccountId?: number, draft?: string): Promise<string[]> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  const res = await api.post(`/email/gmail/${gmailMessageId}/reply-suggestions`, draft ? { draft } : {}, { params });
  return res.data.replies;
}

export async function sendGmailReply(gmailMessageId: string, body: string, emailAccountId?: number, attachments?: EmailAttachmentRef[]): Promise<void> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  await api.post(`/email/gmail/${gmailMessageId}/send-reply`, {
    body,
    attachments: attachments?.map((a) => ({ key: a.key, filename: a.filename, content_type: a.contentType })),
  }, { params });
}

export async function gmailEmailToNote(gmailMessageId: string, emailAccountId?: number): Promise<{ note_id: number; title: string }> {
  const params = emailAccountId != null ? { email_account_id: emailAccountId } : {};
  const res = await api.post(`/email/gmail/${gmailMessageId}/to-note`, null, { params });
  notifyNoteChanged({ noteId: res.data.note_id });
  return res.data;
}

export async function composeSuggest(opts: {
  to: string;
  subject: string;
  topic: string;
}): Promise<{ body: string }> {
  const res = await api.post("/email/compose-suggest", {
    to: opts.to,
    subject: opts.subject,
    topic: opts.topic,
  });
  return res.data;
}

export async function sendNewMail(opts: {
  to: string;
  subject: string;
  body: string;
  emailAccountId?: number;
  attachments?: EmailAttachmentRef[];
}): Promise<{ ok: boolean; gmail_message_id?: string }> {
  const res = await api.post("/email/send-draft", {
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    email_account_id: opts.emailAccountId,
    attachments: opts.attachments?.map((a) => ({ key: a.key, filename: a.filename, content_type: a.contentType })),
  });
  return res.data;
}
