import { useState, useEffect } from "react";
import { generateSuggestions } from "../api/chatApi";
import {
  listReminders,
  createReminder,
  updateReminderDone,
  deleteReminder,
} from "../api/reminderApi";
import type { ReminderItem } from "../api/reminderApi";

export type SuggestionItem = ReminderItem;

export function useSuggestions() {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    listReminders().then(setItems).catch(() => {});
  }, []);

  async function generateFromNote(title: string, content: string) {
    if (!content.trim()) return;
    setIsGenerating(true);
    try {
      const { suggestions } = await generateSuggestions(title, content);
      const newItems: SuggestionItem[] = suggestions.map((s) => ({
        id: s.id,
        text: s.text,
        type: "ai" as const,
        done: false,
        due_date: s.due_date ?? null,
        due_time: s.due_time ?? null,
      }));
      setItems((prev) => [...newItems, ...prev]);
    } catch {
      // silent — suggestions are non-critical
    } finally {
      setIsGenerating(false);
    }
  }

  async function addManual(text: string) {
    try {
      const reminder = await createReminder(text);
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

  return { items, isGenerating, generateFromNote, addManual, toggleDone, remove, clearDone };
}
