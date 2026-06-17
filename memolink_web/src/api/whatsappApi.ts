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
  senderId?: string;
  senderName?: string;
  fromMe: boolean;
  body: string;
  mediaType: "image" | "video" | "audio" | "document" | "sticker" | null;
  timestamp: number;
}

// In Electron, WhatsApp calls go directly to the local bridge at 127.0.0.1:3797.
// In web/Lambda, calls go through the backend API as normal.
const inElectron = (): boolean =>
  typeof window !== "undefined" && !!window.electronAPI?.waProxy;

async function bridgeRequest<T>(
  method: string,
  bridgePath: string,
  opts: { body?: Record<string, unknown>; params?: Record<string, string> } = {},
): Promise<T> {
  const result = await window.electronAPI!.waProxy({ method, path: bridgePath, ...opts });
  if (!result.ok) throw new Error(result.error ?? "Bridge request failed");
  return result.data as T;
}

export async function getWhatsappStatus(): Promise<WhatsappStatus> {
  if (inElectron()) {
    const d = await bridgeRequest<any>("GET", "/health");
    return {
      connected: d.status === "connected",
      status: d.status ?? "disconnected",
      qr_image: d.qr_image ?? null,
      historySynced: d.historySynced ?? false,
      chatCount: d.chatCount ?? 0,
      messageCount: d.messageCount ?? 0,
    };
  }
  const { data } = await api.get("/whatsapp/status");
  return data;
}

export async function startWhatsapp(): Promise<{ started: boolean; message?: string }> {
  if (inElectron()) {
    const result = await window.electronAPI!.waStart();
    if (result.error) throw new Error(result.error);
    return { started: result.started };
  }
  const { data } = await api.post("/whatsapp/start");
  return data;
}

export async function stopWhatsapp(): Promise<{ stopped: boolean }> {
  if (inElectron()) {
    return window.electronAPI!.waStop();
  }
  const { data } = await api.delete("/whatsapp/stop");
  return data;
}

export async function listWhatsappChats(): Promise<WhatsappChat[]> {
  if (inElectron()) {
    const d = await bridgeRequest<{ chats: WhatsappChat[] }>("GET", "/chats");
    const chats = d.chats ?? [];
    // Mirror the backend filter exactly: use messageCount if available,
    // otherwise fetch /messages to confirm the chat has content.
    const hasMessages = await Promise.all(
      chats.map(async (c) => {
        if (typeof c.messageCount === "number") return c.messageCount > 0;
        if (c.lastMessage) return true;
        try {
          const r = await bridgeRequest<{ messages: unknown[]; total: number }>(
            "GET", "/messages", { params: { chatId: c.id, limit: "1", offset: "0" } },
          );
          return (r.total ?? 0) > 0 || (r.messages?.length ?? 0) > 0;
        } catch {
          return false;
        }
      }),
    );
    return chats.filter((_, i) => hasMessages[i]);
  }
  const { data } = await api.get("/whatsapp/chats");
  return data.chats ?? [];
}

export async function getWhatsappMessages(
  chatId: string,
  limit = 30,
  offset = 0,
): Promise<{ messages: WhatsappMessage[]; total: number }> {
  if (inElectron()) {
    const d = await bridgeRequest<{ messages: WhatsappMessage[]; total: number }>(
      "GET", "/messages",
      { params: { chatId, limit: String(limit), offset: String(offset) } },
    );
    return { messages: d.messages ?? [], total: d.total ?? 0 };
  }
  const { data } = await api.get("/whatsapp/messages", { params: { chat_id: chatId, limit, offset } });
  return { messages: data.messages ?? [], total: data.total ?? 0 };
}

export async function getWhatsappProfilePicture(chatId: string): Promise<string | null> {
  try {
    if (inElectron()) {
      const d = await bridgeRequest<any>("GET", "/profile-picture", { params: { chatId } });
      return d?.data_url ?? d?.url ?? null;
    }
    const { data } = await api.get("/whatsapp/profile-picture", { params: { chat_id: chatId } });
    return data.data_url ?? data.url ?? null;
  } catch {
    return null;
  }
}

export async function sendWhatsappMessage(chatId: string, text: string): Promise<{ ok: boolean }> {
  if (inElectron()) {
    return bridgeRequest<{ ok: boolean }>("POST", "/send", { body: { chatId, message: text } });
  }
  const { data } = await api.post("/whatsapp/send", { chat_id: chatId, text });
  return data;
}

export async function deleteWhatsappMessage(chatId: string, msgId: string): Promise<{ ok: boolean }> {
  if (inElectron()) {
    return bridgeRequest<{ ok: boolean }>("POST", "/delete", { body: { chatId, msgId } });
  }
  const { data } = await api.post("/whatsapp/delete", { chat_id: chatId, msg_id: msgId });
  return data;
}

export async function deleteWhatsappChat(chatId: string): Promise<{ ok: boolean }> {
  if (inElectron()) {
    return bridgeRequest<{ ok: boolean }>("POST", "/chat/delete", { body: { chatId } });
  }
  const { data } = await api.post("/whatsapp/delete-chat", { chat_id: chatId });
  return data;
}

export async function getWhatsappMedia(
  chatId: string,
  msgId: string,
): Promise<{ data_url: string; mime_type: string } | null> {
  try {
    if (inElectron()) {
      return bridgeRequest<{ data_url: string; mime_type: string }>(
        "GET", "/media", { params: { chatId, msgId } },
      );
    }
    const { data } = await api.get("/whatsapp/media", { params: { chat_id: chatId, msg_id: msgId } });
    return data;
  } catch {
    return null;
  }
}

export async function suggestWhatsappReply(chatId: string, noteContext = ""): Promise<string[]> {
  // Always goes through the backend (uses OpenAI)
  const { data } = await api.post("/whatsapp/suggest-reply", {
    chat_id: chatId,
    note_context: noteContext,
  });
  return data.replies ?? [];
}

export async function resetWhatsappSession(): Promise<{ reset: boolean }> {
  if (inElectron()) {
    return window.electronAPI!.waReset();
  }
  const { data } = await api.post("/whatsapp/reset-session");
  return data;
}
