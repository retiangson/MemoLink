export type MessageRole = "user" | "assistant";

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
}

export interface Conversation {
  id: number;
  title: string | null;
  messages: Message[];
}

export interface Note {
  id: number;
  title: string;
  content: string;
  source?: string;
}

export const TEMP_ID = -1;
