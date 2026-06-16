import { api } from "./client";

export interface ReminderItem {
  id: number;
  text: string;
  description: string | null;
  type: "ai" | "manual";
  done: boolean;
  due_date: string | null;
  due_time: string | null;
  email_record_id: number | null;
}

export async function listReminders(workspace_id?: number | null): Promise<ReminderItem[]> {
  const params = workspace_id != null ? { workspace_id } : {};
  return (await api.get("/reminders", { params })).data;
}

export async function createReminder(text: string, description?: string | null, due_date?: string | null, due_time?: string | null, workspace_id?: number | null): Promise<ReminderItem> {
  return (await api.post("/reminders", { text, description: description ?? null, due_date: due_date ?? null, due_time: due_time ?? null, workspace_id: workspace_id ?? null })).data;
}

export async function updateReminderDone(id: number, done: boolean): Promise<ReminderItem> {
  return (await api.patch(`/reminders/${id}`, { done })).data;
}

export interface ReminderUpdate {
  done?: boolean;
  text?: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

export async function updateReminder(id: number, fields: ReminderUpdate): Promise<ReminderItem> {
  return (await api.patch(`/reminders/${id}`, fields)).data;
}

export async function deleteReminder(id: number): Promise<void> {
  await api.delete(`/reminders/${id}`);
}

export interface DetectedReminder {
  detected: boolean;
  text: string | null;
  due_date: string | null;
  due_time: string | null;
}

export async function detectReminderFromMessage(message: string): Promise<DetectedReminder> {
  return (await api.post("/reminders/detect", { message })).data;
}
