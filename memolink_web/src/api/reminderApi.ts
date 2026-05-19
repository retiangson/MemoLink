import { api } from "./client";

export interface ReminderItem {
  id: number;
  text: string;
  type: "ai" | "manual";
  done: boolean;
  due_date: string | null;
  due_time: string | null;
}

export async function listReminders(): Promise<ReminderItem[]> {
  return (await api.get("/reminders")).data;
}

export async function createReminder(text: string, due_date?: string | null, due_time?: string | null): Promise<ReminderItem> {
  return (await api.post("/reminders", { text, due_date: due_date ?? null, due_time: due_time ?? null })).data;
}

export async function updateReminderDone(id: number, done: boolean): Promise<{ id: number; done: boolean }> {
  return (await api.patch(`/reminders/${id}`, { done })).data;
}

export async function deleteReminder(id: number): Promise<void> {
  await api.delete(`/reminders/${id}`);
}
