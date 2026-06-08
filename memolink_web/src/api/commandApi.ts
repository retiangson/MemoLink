import { API_BASE } from "./client";
import { getToken } from "../utils/auth";
import type { ChatStreamEvent } from "../types";

function normalizeCommandStreamEvent(raw: any): ChatStreamEvent {
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
    };
  }
  if (typeof raw?.cmd_running === "string") return { type: "command.running", command: raw.cmd_running };
  if (typeof raw?.speak === "string") return { type: "tts.speak", text: raw.speak };
  if (raw?.quiz !== undefined) return { type: "quiz.ready", quiz: raw.quiz };
  if (typeof raw?.close_note === "number") return { type: "note.close", note_id: raw.close_note };
  if (typeof raw?.open_note === "number") return { type: "note.open", note_id: raw.open_note };
  if (typeof raw?.note_updated === "number") return { type: "note.updated", note_id: raw.note_updated };
  if (typeof raw?.improving_note === "string") return { type: "note.improving", title: raw.improving_note };
  if (raw?.image_generating) return { type: "image.generating" };
  if (raw?.tool_call && raw?.label) return { type: "tool.start", label: raw.label, tool_call: raw.tool_call };
  if (raw?.ok !== undefined && raw?.tool_result !== undefined) return { type: "tool.complete", ok: !!raw.ok, result: raw.tool_result };
  return { type: "unknown", raw };
}

export async function* streamCommand(
  command: string,
  conversationId: number | null,
  workspaceId: number | null,
  model: string | null
): AsyncGenerator<ChatStreamEvent> {
  const token = getToken();
  const response = await fetch(`${API_BASE}/commands/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ command, conversation_id: conversationId, workspace_id: workspaceId, model }),
  });
  if (!response.ok) throw new Error(`Command failed: ${response.status}`);
  const reader = response.body!.getReader();
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
        try { yield normalizeCommandStreamEvent(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
}
