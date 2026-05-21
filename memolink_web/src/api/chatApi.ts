import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";

export async function sendChat(conversation_id: number, prompt: string, top_k = 5, workspace_id?: number | null) {
  return (await api.post("/chat", { conversation_id, prompt, top_k, workspace_id: workspace_id ?? null })).data;
}

/** Async generator that yields parsed SSE events from /chat/stream. */
export async function* streamChat(conversation_id: number, prompt: string, top_k = 5, workspace_id?: number | null) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id, prompt, top_k, workspace_id: workspace_id ?? null }),
  });

  if (!res.ok || !res.body) throw new Error(`Stream error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6)) as { t?: string; done?: boolean; id?: number | null };
      }
    }
  }
}

export async function uploadNotes(files: File[], workspace_id?: number | null): Promise<{ notes: any[]; failed: { filename: string; reason: string }[] }> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  if (workspace_id != null) formData.append("workspace_id", String(workspace_id));
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
  workspace_id?: number | null,
): Promise<{ suggestions: { id: number; text: string; description: string | null; due_date: string | null; due_time: string | null }[] }> {
  return (await api.post("/suggest", { title, content, workspace_id: workspace_id ?? null })).data;
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
