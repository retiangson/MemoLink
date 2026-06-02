import { api } from "./client";

export interface TimelineChapter {
  timestamp: string;
  seconds: number;
  title: string;
  summary: string;
  key_phrase: string;
}

export interface TimelineActionItem {
  timestamp: string;
  seconds: number;
  text: string;
  assignee: string | null;
  key_phrase: string;
}

export interface TimelineImportantMoment {
  timestamp: string;
  seconds: number;
  text: string;
  type: "decision" | "warning" | "key_point" | "deadline" | "question";
  key_phrase: string;
}

export interface TimelineData {
  note_id: number;
  summary: string;
  chapters: TimelineChapter[];
  action_items: TimelineActionItem[];
  important_moments: TimelineImportantMoment[];
  estimated_duration_seconds: number | null;
  word_count: number | null;
  exists: boolean;
}

export async function getTimeline(noteId: number): Promise<TimelineData | null> {
  try {
    const res = await api.get(`/timeline/${noteId}`);
    return res.data;
  } catch (e: any) {
    if (e?.response?.status === 404) return null;
    throw e;
  }
}

export async function generateTimeline(noteId: number): Promise<TimelineData> {
  const res = await api.post(`/timeline/generate/${noteId}`);
  return res.data;
}
