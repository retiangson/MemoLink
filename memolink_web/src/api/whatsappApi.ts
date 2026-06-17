import { api } from "./client";

export interface WhatsappStatus {
  connected: boolean;
  status: "disconnected" | "qr" | "connecting" | "connected";
  qr_image: string | null;
  historySynced?: boolean;
  chatCount?: number;
  rawChatCount?: number;
  messageCount?: number;
}

export interface WhatsappChat {
  id: string;
  name: string;
  lastMessage: string;
  lastTime: number;
  messageCount?: number;
  avatarUrl?: string;
}

export interface WhatsappMessage {
  id: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  body: string;
  mediaType: "image" | "video" | "audio" | "document" | "sticker" | null;
  timestamp: number;
}

export async function getWhatsappStatus(): Promise<WhatsappStatus> {
  const { data } = await api.get("/whatsapp/status");
  return data;
}

export async function startWhatsapp(): Promise<{ started: boolean; message?: string }> {
  const { data } = await api.post("/whatsapp/start");
  return data;
}

export async function stopWhatsapp(): Promise<{ stopped: boolean }> {
  const { data } = await api.delete("/whatsapp/stop");
  return data;
}

export async function listWhatsappChats(): Promise<WhatsappChat[]> {
  const { data } = await api.get("/whatsapp/chats");
  return data.chats ?? [];
}

export async function getWhatsappMessages(
  chatId: string,
  limit = 30,
  offset = 0,
): Promise<{ messages: WhatsappMessage[]; total: number }> {
  const { data } = await api.get("/whatsapp/messages", { params: { chat_id: chatId, limit, offset } });
  return { messages: data.messages ?? [], total: data.total ?? 0 };
}

export async function getWhatsappProfilePicture(chatId: string): Promise<string | null> {
  try {
    const { data } = await api.get("/whatsapp/profile-picture", { params: { chat_id: chatId } });
    return data.data_url ?? data.url ?? null;
  } catch {
    return null;
  }
}

export async function sendWhatsappMessage(chatId: string, text: string): Promise<{ ok: boolean }> {
  const { data } = await api.post("/whatsapp/send", { chat_id: chatId, text });
  return data;
}

export async function deleteWhatsappMessage(chatId: string, msgId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post("/whatsapp/delete", { chat_id: chatId, msg_id: msgId });
  return data;
}

export async function deleteWhatsappChat(chatId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post("/whatsapp/delete-chat", { chat_id: chatId });
  return data;
}

export async function getWhatsappMedia(chatId: string, msgId: string): Promise<{ data_url: string; mime_type: string } | null> {
  try {
    const { data } = await api.get("/whatsapp/media", { params: { chat_id: chatId, msg_id: msgId } });
    return data;
  } catch {
    return null;
  }
}

export async function suggestWhatsappReply(chatId: string, noteContext = ""): Promise<string[]> {
  const { data } = await api.post("/whatsapp/suggest-reply", {
    chat_id: chatId,
    note_context: noteContext,
  });
  return data.replies ?? [];
}

export async function resetWhatsappSession(): Promise<{ reset: boolean }> {
  const { data } = await api.post("/whatsapp/reset-session");
  return data;
}
