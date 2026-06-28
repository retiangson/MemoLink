import axios from "axios";
import { getToken, getUser, logout } from "../utils/auth";
import { notifyNoteChanged } from "../utils/noteEvents";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string)?.replace(/\/$/, "") ?? "";

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout when a stored session token is rejected by the backend.
// Skips auth endpoints (wrong-password 401 should not log you out).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const is401 = error?.response?.status === 401;
    const isAuthRoute = error?.config?.url?.includes("/auth/");
    if (is401 && !isAuthRoute && getUser()) {
      logout();
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

// Notes
export async function createNote(title: string | null, content: string, source: string | null = null, workspace_id?: number | null) {
  const note = (await api.post("/notes", { title, content, source, workspace_id: workspace_id ?? null })).data;
  notifyNoteChanged({ note, noteId: note.id });
  return note;
}
export async function getNote(note_id: number) {
  return (await api.post("/notes/get", { note_id })).data;
}
export async function listNotes(workspace_id?: number | null) {
  return (await api.post("/notes/list", { workspace_id: workspace_id ?? null })).data;
}
export async function updateNote(note_id: number, title?: string | null, content?: string | null) {
  return (await api.post("/notes/update", { note_id, title: title ?? null, content: content ?? null })).data;
}
export async function autosaveNote(note_id: number, title: string, content: string) {
  return (await api.put(`/notes/${note_id}/autosave`, { title, content })).data;
}

function keepaliveRequest(path: string, method: "POST" | "PUT", body: unknown): void {
  const token = getToken();
  void fetch(`${API_BASE}${path}`, {
    method,
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => { /* the pending local snapshot remains available for retry */ });
}

export function autosaveNoteOnPageExit(note_id: number, title: string, content: string): void {
  keepaliveRequest(`/notes/${note_id}/autosave`, "PUT", { title, content });
}

export function createNoteOnPageExit(title: string, content: string, workspace_id?: number | null): void {
  keepaliveRequest("/notes", "POST", { title, content, source: "manual", workspace_id: workspace_id ?? null });
}

export async function solveNoteEquation(note_id: number, model?: string) {
  return (await api.post("/commands/solve-equation", { note_id, model: model || null })).data;
}
export async function completeNoteEquation(note_id: number, model?: string) {
  return (await api.post("/commands/complete-equation", { note_id, model: model || null })).data;
}
export async function deleteNote(note_id: number) {
  return (await api.post("/notes/delete", { note_id })).data;
}
export async function listTrashedNotes() {
  return (await api.post("/notes/trash")).data;
}
export async function restoreNote(note_id: number) {
  return (await api.post("/notes/restore", { note_id })).data;
}
export async function permanentDeleteNote(note_id: number) {
  return (await api.post("/notes/permanent-delete", { note_id })).data;
}
export async function setNotePublicAgentEnabled(note_id: number, enabled: boolean) {
  return (await api.post("/notes/public-agent", { note_id, enabled })).data;
}

// Auth
export async function changePassword(current_password: string, new_password: string) {
  return (await api.post("/auth/change-password", { current_password, new_password })).data;
}

// Feedback
export async function submitFeedback(type: "bug" | "suggestion", title: string, message: string): Promise<{ ok: boolean }> {
  return (await api.post("/feedback", { type, title, message })).data;
}
