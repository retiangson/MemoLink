import { api } from "./client";

export interface CalendarOccurrence {
  reminder_id: number;
  occurrence_date: string; // YYYY-MM-DD
  text: string;
  description: string | null;
  due_time: string | null;
  end_time: string | null;
  all_day: boolean;
  recurrence_rule: string | null;
  source: "local" | "google";
  done: boolean;
}

export interface CalendarAccountStatus {
  id: number;
  email: string;
  calendar_connected: boolean;
}

export async function listCalendarEvents(
  start: string,
  end: string,
  workspaceId?: number | null
): Promise<CalendarOccurrence[]> {
  const params: Record<string, string | number> = { start, end };
  if (workspaceId != null) params.workspace_id = workspaceId;
  const res = await api.get("/calendar/events", { params });
  return res.data.events as CalendarOccurrence[];
}

export async function getCalendarStatus(): Promise<{ accounts: CalendarAccountStatus[] }> {
  return (await api.get("/calendar/status")).data;
}
