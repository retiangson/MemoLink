import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";

export async function sendChat(conversation_id: number, prompt: string, top_k = 5, workspace_id?: number | null, model?: string | null) {
  return (await api.post("/chat", { conversation_id, prompt, top_k, workspace_id: workspace_id ?? null, model: model ?? null })).data;
}

/** Async generator that yields parsed SSE events from /chat/stream. */
export async function* streamChat(conversation_id: number, prompt: string, top_k = 5, workspace_id?: number | null, model?: string | null, web_search = false) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id, prompt, top_k, workspace_id: workspace_id ?? null, model: model ?? null, web_search }),
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
        yield JSON.parse(line.slice(6)) as { t?: string; replace?: string; done?: boolean; id?: number | null; model?: string; tool_call?: string; label?: string; tool_result?: string; ok?: boolean; image_generating?: boolean; close_note?: number; improving_note?: string };
      }
    }
  }
}

export async function* streamAgentChat(conversation_id: number, prompt: string, workspace_id?: number | null, model?: string | null) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/chat/agent/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id, prompt, workspace_id: workspace_id ?? null, model: model ?? null }),
  });

  if (!res.ok || !res.body) throw new Error(`Agent stream error: ${res.status}`);

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
        yield JSON.parse(line.slice(6)) as {
          t?: string;
          done?: boolean;
          id?: number | null;
          model?: string;
          tool_call?: string;
          label?: string;
          tool_result?: string;
          ok?: boolean;
        };
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

export async function translateText(
  text: string,
  targetLanguage = "English",
  force = false,
): Promise<{ translation: string; accuracy: number | null; model: string; cached: boolean }> {
  return (await api.post("/translate", { text, target_language: targetLanguage, force })).data;
}

export async function* streamResearch(conversation_id: number, prompt: string, workspace_id?: number | null, model?: string | null) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/research/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id, prompt, workspace_id: workspace_id ?? null, model: model ?? null }),
  });

  if (!res.ok || !res.body) throw new Error(`Research stream error: ${res.status}`);

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
        yield JSON.parse(line.slice(6)) as {
          t?: string; done?: boolean; id?: number | null; model?: string;
          tool_call?: string; label?: string; tool_result?: string; ok?: boolean;
          replace?: string; image_generating?: boolean;
        };
      }
    }
  }
}

export async function uploadChat(conversationId: number, prompt: string, files: File[]) {
  const formData = new FormData();
  formData.append("conversation_id", String(conversationId));
  formData.append("prompt", prompt);
  files.forEach((f) => formData.append("files", f, f.name));
  return (await api.post("/chat/upload", formData, { headers: { "Content-Type": "multipart/form-data" } })).data;
}

export async function presignUpload(
  filename: string,
  contentType: string,
  sizeBytes: number,
): Promise<{ url: string; key: string }> {
  return (await api.post("/upload/presign", { filename, content_type: contentType, size_bytes: sizeBytes })).data;
}

export async function processFromS3(
  keys: string[],
  workspaceId?: number | null,
): Promise<{ notes: any[]; failed: { filename: string; reason: string }[] }> {
  return (await api.post("/upload/process", { keys, workspace_id: workspaceId ?? null })).data;
}

export function uploadToS3(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("S3 upload network error"));
    xhr.ontimeout = () => reject(new Error("S3 upload timed out"));
    xhr.timeout = 600000; // 10 min
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}
