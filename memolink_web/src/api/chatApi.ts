import { api } from "./client";

export async function sendChat(conversation_id: number, prompt: string, top_k = 5) {
  return (await api.post("/chat", { conversation_id, prompt, top_k })).data;
}

export async function uploadNotes(files: File[]): Promise<{ notes: any[]; failed: { filename: string; reason: string }[] }> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  return (await api.post("/notes/bulk", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
}

export async function transcribeAudio(blob: Blob, filename: string, language = ""): Promise<{ text: string }> {
  const formData = new FormData();
  formData.append("file", blob, filename);
  if (language) formData.append("language", language);
  return (await api.post("/transcribe", formData)).data;
}

export async function generateSuggestions(
  title: string,
  content: string,
): Promise<{ suggestions: { id: number; text: string; due_date: string | null; due_time: string | null }[] }> {
  return (await api.post("/suggest", { title, content })).data;
}

export async function translateText(text: string, targetLanguage = "English"): Promise<{ translation: string }> {
  return (await api.post("/translate", { text, target_language: targetLanguage })).data;
}

export async function uploadChat(conversationId: number, prompt: string, files: File[]) {
  const formData = new FormData();
  formData.append("conversation_id", String(conversationId));
  formData.append("prompt", prompt);
  files.forEach((f) => formData.append("files", f, f.name));
  return (await api.post("/chat/upload", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
}
