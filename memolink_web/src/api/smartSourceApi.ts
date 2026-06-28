import { api } from "./client";
import axios from "axios";

export function smartSourceErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (error.message) return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface SourceFileMetadata {
  id: number;
  user_id: number;
  workspace_id: number | null;
  note_id: number;
  source_type: string;
  original_filename: string;
  mime_type: string | null;
  file_size: number | null;
  onedrive_drive_id: string;
  onedrive_item_id: string;
  onedrive_web_url: string | null;
  onedrive_etag: string | null;
  extraction_status: string;
  cache_status: string;
  last_synced_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SourceAnnotation {
  id: number;
  note_id: number;
  source_file_id: number | null;
  book_id: number | null;
  page_number: number | null;
  location_anchor: Record<string, unknown> | null;
  annotation_type: string;
  strokes_json: StrokePayload | null;
  highlight_data: Record<string, unknown> | null;
  comment_text: string | null;
  color: string | null;
  pen_size: number | null;
  tool_type: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  time: number;
}

export interface StrokePayload {
  version: 1;
  pointerType: string;
  points: StrokePoint[];
}

export interface SourceTimelineEvent {
  id: number;
  note_id: number;
  source_file_id: number | null;
  book_id: number | null;
  event_type: string;
  event_summary: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string | null;
}

export interface RecordingMetadata {
  id: number;
  note_id: number;
  file_name: string;
  duration_seconds: number;
  local_only: boolean;
  transcript_status: string;
  transcript_note_id: number | null;
  created_at: string | null;
}

export interface SmartSourceWorkspaceData {
  source_files: SourceFileMetadata[];
  annotations: SourceAnnotation[];
  timeline: SourceTimelineEvent[];
  recordings: RecordingMetadata[];
}

export async function getSmartSourceWorkspace(noteId: number): Promise<SmartSourceWorkspaceData> {
  return (await api.get(`/notes/${noteId}/source-workspace`)).data;
}

export async function autosaveSourceNote(noteId: number, title: string, content: string) {
  return (await api.put(`/notes/${noteId}/source-workspace/autosave`, { title, content })).data;
}

export async function createSourceAnnotation(payload: Omit<SourceAnnotation, "id" | "created_at" | "updated_at">): Promise<SourceAnnotation> {
  return (await api.post("/annotations", payload)).data;
}

export async function updateSourceAnnotation(id: number, payload: Partial<SourceAnnotation>): Promise<SourceAnnotation> {
  return (await api.put(`/annotations/${id}`, payload)).data;
}

export async function deleteSourceAnnotation(id: number): Promise<void> {
  await api.delete(`/annotations/${id}`);
}

export async function saveRecordingMetadata(noteId: number, payload: { file_name: string; duration_seconds: number; local_only: true }): Promise<RecordingMetadata> {
  return (await api.post(`/notes/${noteId}/recordings`, payload)).data;
}
