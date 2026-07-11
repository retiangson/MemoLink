import type { BrowseEmailResult } from "./api/emailApi";

export type MessageRole = "user" | "assistant";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNSUPPORTED";

export interface ChatSource {
  note_id: number;
  title: string | null;
  snippet: string;
}

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
  model?: string;
  confidence?: ConfidenceLevel;
  confidence_reason?: string;
  routing_reason?: string;
  suggest_web_search?: boolean;
  search_query_suggestion?: string;
  email_results?: BrowseEmailResult[];
  sources?: ChatSource[];
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
export const TEMP_WORKFLOW_ID = -2;

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

export type ChatStreamEvent =
  | { type: "message.delta"; text: string }
  | { type: "message.replace"; content: string }
  | {
      type: "message.complete";
      message_id: number | null;
      model?: string;
      confidence?: ConfidenceLevel;
      confidence_reason?: string;
      routing_reason?: string;
      suggest_web_search?: boolean;
      search_query_suggestion?: string;
      email_results?: BrowseEmailResult[];
      sources?: ChatSource[];
    }
  | { type: "note.close"; note_id: number }
  | { type: "note.open"; note_id: number }
  | { type: "note.updated"; note_id: number }
  | { type: "note.improving"; title: string }
  | { type: "image.generating" }
  | { type: "command.running"; command: string }
  | { type: "quiz.ready"; quiz: unknown }
  | { type: "tts.speak"; text: string }
  | { type: "tool.start"; label: string; tool_call?: string }
  | { type: "tool.complete"; ok: boolean; result?: string }
  | { type: "unknown"; raw: unknown };
