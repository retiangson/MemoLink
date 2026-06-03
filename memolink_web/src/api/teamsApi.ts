import { api } from "./client";

export interface TeamsStatus {
  connected: boolean;
  display_name?: string;
  email?: string;
}

export interface TeamsChat {
  id: string;
  topic: string;
  chatType: string;
  members: string[];
  lastMessagePreview: string;
}

export interface TeamsMessage {
  id: string;
  from: string;
  content: string;
  createdDateTime: string;
  messageType: string;
}

export async function getTeamsStatus(): Promise<TeamsStatus> {
  const r = await api.get("/teams/status");
  return r.data;
}

export async function getTeamsConnectUrl(): Promise<string> {
  const r = await api.get("/teams/connect-url");
  return r.data.url;
}

export async function disconnectTeams(): Promise<void> {
  await api.delete("/teams/disconnect");
}

export async function listTeamsChats(): Promise<TeamsChat[]> {
  const r = await api.get("/teams/chats");
  return r.data.chats;
}

export async function getTeamsMessages(chatId: string, limit = 20): Promise<TeamsMessage[]> {
  const r = await api.get(`/teams/chats/${chatId}/messages`, { params: { limit } });
  return r.data.messages;
}

export async function sendTeamsMessage(chatId: string, text: string): Promise<void> {
  await api.post(`/teams/chats/${chatId}/send`, { text });
}

export async function chatToNote(chatId: string, topic: string, workspaceId?: number | null): Promise<{ note_id: number; title: string }> {
  const r = await api.post(`/teams/chats/${chatId}/to-note`, { topic, workspace_id: workspaceId });
  return r.data;
}
