import { useState, useEffect } from "react";
import { generateSuggestions } from "../api/chatApi";
import {
  listReminders,
  createReminder,
  updateReminderDone,
  updateReminder,
  deleteReminder,
} from "../api/reminderApi";
import type { ReminderItem, ReminderUpdate } from "../api/reminderApi";

export type SuggestionItem = ReminderItem;

export function useSuggestions(workspaceId?: number | null) {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  async function reload() {
    try { setItems(await listReminders(workspaceId)); } catch { /* ignore */ }
  }

  useEffect(() => { reload(); }, [workspaceId]);

  async function generateFromNote(title: string, content: string) {
    if (!content.trim()) return;
    setIsGenerating(true);
    try {
      const { suggestions } = await generateSuggestions(title, content, workspaceId);
      const newItems: SuggestionItem[] = suggestions.map((s) => ({
        id: s.id,
        text: s.text,
        description: s.description ?? null,
        type: "ai" as const,
        done: false,
        due_date: s.due_date ?? null,
        due_time: s.due_time ?? null,
        email_record_id: null,
        recurrence_rule: null,
        end_time: null,
        all_day: false,
        source: "local" as const,
      }));
      setItems((prev) => [...newItems, ...prev]);
    } catch {
      // silent - suggestions are non-critical
    } finally {
      setIsGenerating(false);
    }
  }

  async function addManual(text: string, description?: string | null, due_date?: string | null, due_time?: string | null) {
    try {
      const reminder = await createReminder(text, description, due_date, due_time, workspaceId);
      setItems((prev) => [reminder, ...prev]);
    } catch {
      // silent
    }
  }

  async function toggleDone(id: number) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const newDone = !item.done;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: newDone } : i)));
    try {
      await updateReminderDone(id, newDone);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: item.done } : i)));
    }
  }

  async function updateItem(id: number, fields: ReminderUpdate) {
    const original = items.find((i) => i.id === id);
    if (!original) return;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fields } : i)));
    try {
      const updated = await updateReminder(id, fields);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? original : i)));
    }
  }

  async function remove(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await deleteReminder(id);
    } catch {
      // silent
    }
  }

  async function clearDone() {
    const doneItems = items.filter((i) => i.done);
    setItems((prev) => prev.filter((i) => !i.done));
    await Promise.all(doneItems.map((i) => deleteReminder(i.id).catch(() => {})));
  }

  return { items, isGenerating, generateFromNote, addManual, toggleDone, updateItem, remove, clearDone, reload };
}
