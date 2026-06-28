import { api } from "./client";
import { notifyNoteChanged } from "../utils/noteEvents";

export async function getConversations(workspace_id?: number | null) {
  return (await api.post("/conversation/list", { workspace_id: workspace_id ?? null })).data;
}
export async function createConversation(workspace_id?: number | null) {
  return (await api.post("/conversation/create", { workspace_id: workspace_id ?? null })).data;
}
export async function getConversationMessagesPaginated(conversationId: number, limit = 10, beforeId?: number) {
  const query = beforeId ? `?limit=${limit}&before_id=${beforeId}` : `?limit=${limit}`;
  return (await api.post(`/conversation/messages${query}`, { conversation_id: conversationId })).data;
}
export async function renameConversation(conversation_id: number, title: string) {
  return (await api.post("/conversation/rename", { conversation_id, title })).data;
}
export async function deleteConversation(conversation_id: number) {
  return (await api.post("/conversation/delete", { conversation_id })).data;
}
export async function listTrashedConversations() {
  return (await api.post("/conversation/trash")).data;
}
export async function restoreConversation(conversation_id: number) {
  return (await api.post("/conversation/restore", { conversation_id })).data;
}
export async function permanentDeleteConversation(conversation_id: number) {
  return (await api.post("/conversation/permanent-delete", { conversation_id })).data;
}
export async function deleteMessage(messageId: number) {
  return (await api.post("/conversation/delete-message", { message_id: messageId })).data;
}
export async function addMessageToNoteAPI(content: string, title = "Chat Snippet") {
  const note = (await api.post("/conversation/add-to-note", { content, title })).data;
  notifyNoteChanged({ noteId: note.id });
  return note;
}
