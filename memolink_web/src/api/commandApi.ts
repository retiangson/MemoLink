import { API_BASE } from "./client";
import { getToken } from "../utils/auth";

export async function* streamCommand(
  command: string,
  conversationId: number | null,
  workspaceId: number | null,
  model: string | null
): AsyncGenerator<Record<string, any>> {
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
        try { yield JSON.parse(line.slice(6)); } catch {}
      }
    }
  }
}
