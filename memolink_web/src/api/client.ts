import axios from "axios";
import { getToken } from "../utils/auth";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string)?.replace(/\/$/, "") ?? "";

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Notes
export async function createNote(title: string | null, content: string, source: string | null = null) {
  return (await api.post("/notes", { title, content, source })).data;
}
export async function getNote(note_id: number) {
  return (await api.post("/notes/get", { note_id })).data;
}
export async function listNotes() {
  return (await api.post("/notes/list")).data;
}
export async function updateNote(note_id: number, title?: string | null, content?: string | null) {
  return (await api.post("/notes/update", { note_id, title: title ?? null, content: content ?? null })).data;
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
