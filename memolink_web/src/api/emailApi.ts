import { api } from "./client";

export interface EmailAccount {
  id: number;
  email: string;
  provider: string;
}

export interface EmailStatus {
  connected: boolean;
  accounts: EmailAccount[];
}

export interface EmailRecord {
  id: number;
  subject: string;
  sender_name: string | null;
  sender_email: string;
  snippet: string | null;
  body_text?: string;
  importance_score: number;
  is_read: boolean;
  email_date: string | null;
  gmail_thread_id?: string | null;
  gmail_message_id?: string;
  email_account_id?: number | null;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  filtered: number;
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
  return res.data;
}

export async function emailToReminder(id: number): Promise<{ reminder_id: number; text: string; due_date: string | null; due_time: string | null }> {
  const res = await api.post(`/email/emails/${id}/to-reminder`);
  return res.data;
}

export async function getReplySuggestions(id: number): Promise<string[]> {
  const res = await api.get(`/email/emails/${id}/reply-suggestions`);
  return res.data.replies;
}

export async function sendEmailReply(id: number, body: string): Promise<void> {
  await api.post(`/email/emails/${id}/send-reply`, { body });
}
