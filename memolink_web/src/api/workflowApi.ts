import { api, API_BASE } from "./client";
import { getToken } from "../utils/auth";
import type { Message } from "../types";

export interface WorkflowAction {
  id: string;
  type: string;
  label: string;
  preview: string;
  params: Record<string, unknown>;
}

export interface WorkflowPlan {
  message_id: number;
  conversation_id: number;
  understanding: string;
  actions: WorkflowAction[];
}

export async function suggestActions(
  message: string,
  workspace_id: number | null,
  user_message?: string,
): Promise<WorkflowAction[]> {
  try {
    const res = await api.post("/workflow/suggest", { message, workspace_id, user_message });
    return res.data.actions ?? [];
  } catch {
    return [];
  }
}

export async function executeAction(
  conversation_id: number,
  action: WorkflowAction,
  workspace_id: number | null,
  user_message = "Yes",
  model: string | null = null,
): Promise<{ ok: boolean; result: string }> {
  const res = await confirmAction(conversation_id, action, user_message, workspace_id, model);
  return { ok: res.ok, result: res.result };
}

export async function confirmAction(
  conversation_id: number,
  action: WorkflowAction,
  user_message: string,
  workspace_id: number | null,
  model: string | null,
): Promise<{ ok: boolean; result: string; user_message: Message; assistant_message: Message }> {
  const res = await api.post("/workflow/confirm", {
    conversation_id,
    action,
    user_message,
    workspace_id,
    model,
  });
  return res.data;
}

export async function planWorkflow(
  conversation_id: number,
  prompt: string,
  workspace_id: number | null,
  model: string | null,
): Promise<WorkflowPlan> {
  const res = await api.post("/workflow/plan", { conversation_id, prompt, workspace_id, model });
  return res.data;
}

export async function* executeWorkflow(
  conversation_id: number,
  actions: WorkflowAction[],
  workspace_id: number | null,
  model: string | null,
): AsyncGenerator<Record<string, unknown>> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/workflow/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id, actions, workspace_id, model }),
  });
  if (!res.ok || !res.body) throw new Error(`Workflow execute error: ${res.status}`);

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
        yield JSON.parse(line.slice(6));
      }
    }
  }
}
