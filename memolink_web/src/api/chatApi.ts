import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";
import type { ChatStreamEvent } from "../types";

function normalizeChatStreamEvent(raw: any): ChatStreamEvent {
  if (raw && typeof raw.type === "string") return raw as ChatStreamEvent;
  if (typeof raw?.t === "string") return { type: "message.delta", text: raw.t };
  if (typeof raw?.replace === "string") return { type: "message.replace", content: raw.replace };
  if (raw?.done) {
    return {
      type: "message.complete",
      message_id: raw.id ?? null,
      model: raw.model,
      confidence: raw.confidence,
      confidence_reason: raw.confidence_reason,
      routing_reason: raw.routing_reason,
      suggest_web_search: raw.suggest_web_search === true,
      search_query_suggestion: typeof raw.search_query_suggestion === "string" ? raw.search_query_suggestion : undefined,
    };
  }
  if (typeof raw?.close_note === "number") return { type: "note.close", note_id: raw.close_note };
  if (typeof raw?.open_note === "number") return { type: "note.open", note_id: raw.open_note };
  if (typeof raw?.note_updated === "number") return { type: "note.updated", note_id: raw.note_updated };
  if (typeof raw?.improving_note === "string") return { type: "note.improving", title: raw.improving_note };
  if (raw?.image_generating) return { type: "image.generating" };
  if (typeof raw?.cmd_running === "string") return { type: "command.running", command: raw.cmd_running };
  if (typeof raw?.speak === "string") return { type: "tts.speak", text: raw.speak };
  if (raw?.quiz !== undefined) return { type: "quiz.ready", quiz: raw.quiz };
  if (raw?.tool_call && raw?.label) return { type: "tool.start", label: raw.label, tool_call: raw.tool_call };
  if (raw?.ok !== undefined && raw?.tool_result !== undefined) return { type: "tool.complete", ok: !!raw.ok, result: raw.tool_result };
  return { type: "unknown", raw };
}

export async function sendChat(conversation_id: number, prompt: string, top_k = 5, workspace_id?: number | null, model?: string | null) {
  return (await api.post("/chat", { conversation_id, prompt, top_k, workspace_id: workspace_id ?? null, model: model ?? null })).data;
}

/** Async generator that yields parsed SSE events from /chat/stream. */
export async function* streamChat(
  conversation_id: number,
  prompt: string,
  top_k = 5,
  workspace_id?: number | null,
  model?: string | null,
  web_search = false,
  search_query_override?: string | null,
) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      conversation_id,
      prompt,
      top_k,
      workspace_id: workspace_id ?? null,
      model: model ?? null,
      web_search,
      search_query_override: search_query_override ?? null,
    }),
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
        yield normalizeChatStreamEvent(JSON.parse(line.slice(6)));
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

export async function* streamResearch(conversation_id: number, prompt: string, workspace_id?: number | null, model?: string | null): AsyncGenerator<ChatStreamEvent> {
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
        yield normalizeChatStreamEvent(JSON.parse(line.slice(6)));
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
    // Content-Type is intentionally not set - the presigned URL no longer
    // includes ContentType as a signed condition, so S3 accepts any type.
    // Setting it here with an inconsistent value (browsers vary on audio/video
    // MIME types) would cause a 403 SignatureDoesNotMatch from S3.
    xhr.send(file);
  });
}
