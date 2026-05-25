export type MessageRole = "user" | "assistant";

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
  model?: string;
}

export interface Conversation {
  id: number;
  title: string | null;
  messages: Message[];
  created_at?: string | null;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  source?: string;
}

export const TEMP_ID = -1;

export function convLabel(conv: { title?: string | null; created_at?: string | null }): string {
  if (conv.title) return conv.title;
  if (conv.created_at) {
    const d = new Date(conv.created_at);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return "New chat";
}

export type WorkspaceType = "Academic" | "Professional" | "Personal" | "Project" | "Other";

export interface Workspace {
  id: number;
  user_id: number;
  name: string;
  type: WorkspaceType;
  description: string | null;
  is_default: boolean;
  last_accessed_at: string | null;
  created_at: string | null;
  alert_count: number;
}
