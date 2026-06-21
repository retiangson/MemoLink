import { useState, useEffect, useCallback } from "react";
import {
  listCalendarEvents,
  getCalendarStatus,
} from "../api/calendarApi";
import type { CalendarOccurrence, CalendarAccountStatus } from "../api/calendarApi";
import {
  createReminder,
  updateReminder,
  updateReminderDone,
  deleteReminder,
} from "../api/reminderApi";
import type { ReminderUpdate, CreateReminderOptions } from "../api/reminderApi";

function toISO(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export interface CalendarRange {
  start: Date;
  end: Date;
}

export function useCalendar(workspaceId?: number | null) {
  const today = new Date();
  const [range, setRange] = useState<CalendarRange>({
    start: new Date(today.getFullYear(), today.getMonth(), 1),
    end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
  });
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccountStatus[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [evts, status] = await Promise.all([
        listCalendarEvents(toISO(range.start), toISO(range.end), workspaceId),
        getCalendarStatus().catch(() => ({ accounts: [] as CalendarAccountStatus[] })),
      ]);
      setEvents(evts);
      setAccounts(status.accounts);
    } catch {
      // silent - calendar is non-critical
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, workspaceId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createEvent(
    text: string,
    description?: string | null,
    due_date?: string | null,
    due_time?: string | null,
    options?: CreateReminderOptions
  ) {
    await createReminder(text, description, due_date, due_time, workspaceId, options);
    await reload();
  }

  async function updateEvent(id: number, fields: ReminderUpdate) {
    await updateReminder(id, fields);
    await reload();
  }

  async function deleteEvent(id: number) {
    await deleteReminder(id);
    await reload();
  }

  async function toggleDone(id: number, done: boolean) {
    await updateReminderDone(id, done);
    setEvents((prev) => prev.map((e) => (e.reminder_id === id ? { ...e, done } : e)));
  }

  const calendarConnected = accounts.some((a) => a.calendar_connected);
  const hasUnconnectedAccount = accounts.length > 0 && !calendarConnected;

  return {
    range,
    setRange,
    events,
    accounts,
    calendarConnected,
    hasUnconnectedAccount,
    loading,
    reload,
    createEvent,
    updateEvent,
    deleteEvent,
    toggleDone,
  };
}
