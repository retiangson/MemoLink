/**
 * MemoLink WhatsApp Bridge
 * Connects to WhatsApp using Baileys and exposes HTTP endpoints.
 *
 * Usage: node bridge.js [--port 3797] [--session /path/to/session]
 *
 * Endpoints:
 *   GET  /health                        → { status, qr_image? }
 *   GET  /chats                         → { chats: [...] }
 *   GET  /messages?chatId=...&limit=20  → { messages: [...] }
 *   GET  /media?chatId=...&msgId=...    → { data_url, mime_type } (downloads on demand)
 *   POST /send                          → body: { chatId, message } → { ok }
 */

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import express from "express";
import pino from "pino";
import { mkdirSync } from "fs";
import path from "path";
import QRCode from "qrcode";

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const PORT = parseInt(arg("port", "3797"), 10);
const SESSION_DIR = arg(
  "session",
  path.join(process.env.USERPROFILE || process.env.HOME || ".", ".memolink", "whatsapp")
);

mkdirSync(SESSION_DIR, { recursive: true });
const logger = pino({ level: "silent" });

// ── In-memory state ───────────────────────────────────────────────────────────

let sock = null;
let connectionState = "disconnected";
let latestQRImage = null;
let historySynced = false;
let connectedAt = 0;

// chatId → [MsgObj]
const messagesByChat = new Map();
// chatId → { id, name, lastMessage, lastTime }
const chatMeta = new Map();
// jid → display name
const contactNames = new Map();
// "chatId::msgId" → raw Baileys message (kept for media download)
const rawMessages = new Map();

const MAX_MESSAGES_PER_CHAT = 5000;
const MAX_RAW_MESSAGES = 20000; // cap to avoid OOM
const HISTORY_READY_FALLBACK_MS = 30000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function mediaType(msg) {
  const m = msg?.message;
  if (!m) return null;
  if (m.imageMessage)    return "image";
  if (m.videoMessage)    return "video";
  if (m.audioMessage)    return "audio";
  if (m.documentMessage) return "document";
  if (m.stickerMessage)  return "sticker";
  return null;
}

function extractBody(msg) {
  const m = msg?.message;
  if (!m) return "";
  const type = mediaType(msg);
  if (type === "image")    return m.imageMessage?.caption    || "[image]";
  if (type === "video")    return m.videoMessage?.caption    || "[video]";
  if (type === "audio")    return "[voice/audio]";
  if (type === "document") return m.documentMessage?.fileName || "[document]";
  if (type === "sticker")  return "[sticker]";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.reactionMessage?.text ||
    "[message]"
  );
}

function displayNameFor(jid) {
  if (!jid) return "Unknown";
  return contactNames.get(jid) || jid.replace(/@.*/, "");
}

function updateContact(contact) {
  const name = contact?.name || contact?.notify || contact?.verifiedName;
  if (name && contact?.id) {
    contactNames.set(contact.id, name);
    const meta = chatMeta.get(contact.id);
    if (meta) chatMeta.set(contact.id, { ...meta, name });
  }
}

function updateChat(chat) {
  if (!chat?.id || chat.id === "status@broadcast" || chat.id.endsWith("@broadcast")) return;
  const name = chat.name || contactNames.get(chat.id) || chat.id.replace(/@.*/, "");
  const time = chat.conversationTimestamp ? Number(chat.conversationTimestamp) * 1000 : 0;
  const existing = chatMeta.get(chat.id);
  chatMeta.set(chat.id, {
    id: chat.id,
    name: name || existing?.name || chat.id.replace(/@.*/, ""),
    lastMessage: existing?.lastMessage || "",
    lastTime: Math.max(time, existing?.lastTime || 0),
  });
}

function isHistoryReady() {
  if (historySynced) return true;
  if (connectionState !== "connected") return false;
  return chatMeta.size > 0 || (connectedAt > 0 && Date.now() - connectedAt >= HISTORY_READY_FALLBACK_MS);
}

function msgToObj(msg) {
  const chatId      = msg.key.remoteJid;
  const isGroup     = chatId?.endsWith("@g.us");
  const participant = msg.key.participant || msg.participant || null;
  const type        = mediaType(msg);
  const senderId    = msg.key.fromMe
    ? (sock?.user?.id || "me")
    : (participant || chatId);

  let senderName;
  if (msg.key.fromMe) {
    senderName = "me";
  } else if (isGroup || participant) {
    // Priority: pushName (sent by WhatsApp on every message) → stored contact name → phone number
    senderName = msg.pushName || displayNameFor(senderId);
  } else {
    senderName = msg.pushName || displayNameFor(chatId);
  }

  return {
    id:        msg.key.id,
    chatId,
    from:      senderName,
    senderId,
    senderName,
    fromMe:    !!msg.key.fromMe,
    body:      extractBody(msg),
    mediaType: type,
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : 0,
  };
}

function addMessage(chatId, msg) {
  if (!chatId || chatId === "status@broadcast" || chatId.endsWith("@broadcast")) return;

  // Capture pushName (sender's display name) sent on every WhatsApp message
  const participant = msg.key?.participant || msg.participant;
  if (msg.pushName) {
    contactNames.set(participant || chatId, msg.pushName);
  }

  // Store raw message for later media download
  const rawKey = `${chatId}::${msg.key?.id || msg.id}`;
  if (msg.key && rawMessages.size < MAX_RAW_MESSAGES) {
    rawMessages.set(rawKey, msg);
  }

  const obj = msg.id ? msg : msgToObj(msg); // already converted if no .key
  if (!messagesByChat.has(chatId)) messagesByChat.set(chatId, []);
  const msgs = messagesByChat.get(chatId);
  if (msgs.some((m) => m.id === obj.id)) return; // deduplicate

  msgs.push(obj);
  msgs.sort((a, b) => a.timestamp - b.timestamp);
  if (msgs.length > MAX_MESSAGES_PER_CHAT) msgs.shift();

  const existing = chatMeta.get(chatId);
  if (!existing || obj.timestamp > (existing.lastTime || 0)) {
    chatMeta.set(chatId, {
      id:          chatId,
      name:        existing?.name || displayNameFor(chatId),
      lastMessage: obj.body,
      lastTime:    obj.timestamp,
    });
  }
}

function removeMessage(chatId, msgId) {
  const msgs = messagesByChat.get(chatId) || [];
  const next = msgs.filter((m) => m.id !== msgId);
  if (next.length === msgs.length) return false;

  messagesByChat.set(chatId, next);
  rawMessages.delete(`${chatId}::${msgId}`);

  const existing = chatMeta.get(chatId);
  const last = next[next.length - 1];
  if (existing) {
    chatMeta.set(chatId, {
      ...existing,
      lastMessage: last?.body || "",
      lastTime:    last?.timestamp || existing.lastTime || 0,
    });
  }
  return true;
}

function removeChat(chatId) {
  messagesByChat.delete(chatId);
  chatMeta.delete(chatId);
  contactNames.delete(chatId);
  for (const key of Array.from(rawMessages.keys())) {
    if (key.startsWith(`${chatId}::`)) rawMessages.delete(key);
  }
}

function lastRawMessageForChat(chatId) {
  const msgs = messagesByChat.get(chatId) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const raw = rawMessages.get(`${chatId}::${msgs[i].id}`);
    if (raw?.key && raw.messageTimestamp) return raw;
  }
  return null;
}

function visibleChats() {
  return Array.from(chatMeta.values())
    .map((m) => ({
      ...m,
      name:         contactNames.get(m.id) || m.name,
      messageCount: (messagesByChat.get(m.id) || []).length,
    }))
    .filter((c) => !c.id.endsWith("@broadcast"))
    .filter((c) => c.messageCount > 0)
    .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
}

// ── Socket ────────────────────────────────────────────────────────────────────

async function startSocket() {
  messagesByChat.clear();
  chatMeta.clear();
  contactNames.clear();
  rawMessages.clear();
  historySynced = false;
  connectedAt = 0;

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser:           ["MemoLink", "Chrome", "120.0"],
    syncFullHistory:   true,   // requests full chat history; pipe deadlock is fixed (DEVNULL)
    markOnlineOnConnect: false,
    getMessage: async (key) => {
      const raw = rawMessages.get(`${key.remoteJid}::${key.id}`);
      return raw?.message || { conversation: "" };
    },
  });

  sock.ev.on("creds.update", saveCreds);

  // ── Connection ──────────────────────────────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionState = "qr";
      try { latestQRImage = await QRCode.toDataURL(qr, { width: 300, margin: 2 }); }
      catch { latestQRImage = null; }
      console.log("[bridge] QR ready – scan with WhatsApp on your phone");
    }

    if (connection === "connecting") {
      connectionState = "connecting";
    } else if (connection === "open") {
      connectionState = "connected";
      connectedAt = Date.now();
      latestQRImage = null;
      console.log("[bridge] WhatsApp connected!");
    } else if (connection === "close") {
      connectionState = "disconnected";
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("[bridge] Logged out"); process.exit(1);
      } else {
        const delay = code === 515 ? 1000 : 4000;
        console.log(`[bridge] Reconnecting in ${delay}ms…`);
        setTimeout(startSocket, delay);
      }
    }
  });

  // ── Contacts ────────────────────────────────────────────────────────────────

  sock.ev.on("contacts.set", ({ contacts }) => {
    for (const c of contacts) {
      updateContact(c);
    }
    console.log(`[bridge] Contacts: ${contactNames.size}`);
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    for (const c of contacts) {
      updateContact(c);
    }
  });

  sock.ev.on("contacts.update", (updates) => {
    for (const u of updates) {
      updateContact(u);
    }
  });

  // ── Chats ───────────────────────────────────────────────────────────────────

  sock.ev.on("chats.set", ({ chats }) => {
    for (const chat of chats) {
      updateChat(chat);
    }
    historySynced = true;  // signal that at least the chat list is ready
    console.log(`[bridge] Chats: ${chatMeta.size}`);
  });

  sock.ev.on("chats.upsert", (newChats) => {
    for (const chat of newChats) {
      updateChat(chat);
    }
  });

  sock.ev.on("chats.update", (updates) => {
    for (const u of updates) {
      const existing = chatMeta.get(u.id);
      if (existing && u.conversationTimestamp) {
        chatMeta.set(u.id, {
          ...existing,
          lastTime: Math.max(Number(u.conversationTimestamp) * 1000, existing.lastTime || 0),
        });
      }
    }
  });

  // ── Messages ─────────────────────────────────────────────────────────────────

  // Baileys history sync — chats, contacts, and old messages in one event.
  sock.ev.on("messaging-history.set", ({ chats = [], contacts = [], messages: msgs = [], isLatest, progress, syncType }) => {
    for (const contact of contacts) updateContact(contact);
    for (const chat of chats) updateChat(chat);

    let count = 0;
    for (const msg of msgs) {
      if (!msg.message || !msg.key?.remoteJid) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      addMessage(msg.key.remoteJid, msg);
      count++;
    }

    // Treat the first usable history batch as ready, while later batches may still add older messages.
    if (isLatest || chatMeta.size > 0 || count > 0 || progress >= 100) historySynced = true;
    console.log(`[bridge] Messaging history: ${count} msgs, ${chatMeta.size} chats, progress=${progress ?? "n/a"}, latest=${isLatest ?? "n/a"}, type=${syncType ?? "n/a"}`);
  });

  // history sync — batches of old messages
  sock.ev.on("messages.set", ({ messages: msgs }) => {
    let count = 0;
    for (const msg of msgs) {
      if (!msg.message || !msg.key?.remoteJid) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;
      addMessage(msg.key.remoteJid, msg);
      count++;
    }
    if (count) console.log(`[bridge] History: ${count} msgs, ${chatMeta.size} chats`);
  });

  // real-time incoming / outgoing
  sock.ev.on("messages.upsert", ({ messages: msgs, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of msgs) {
      if (!msg.message || !msg.key?.remoteJid) continue;
      addMessage(msg.key.remoteJid, msg);
    }
  });
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  const chats = visibleChats();
  res.json({
    status:        connectionState,
    qr_image:      latestQRImage,
    historySynced: isHistoryReady(),
    chatCount:     chats.length,
    rawChatCount:  chatMeta.size,
    messageCount:  Array.from(messagesByChat.values()).reduce((sum, msgs) => sum + msgs.length, 0),
  });
});

app.get("/chats", (_req, res) => {
  res.json({ chats: visibleChats() });
});

app.get("/messages", (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  const limit  = parseInt(req.query.limit  || "30", 10);
  const offset = parseInt(req.query.offset || "0",  10);
  const msgs   = messagesByChat.get(chatId) || [];
  // return most recent `limit` messages starting from the end, respecting offset
  if (offset >= msgs.length) return res.json({ messages: [], total: msgs.length });
  const end   = Math.max(0, msgs.length - offset);
  const start = Math.max(0, end - limit);
  res.json({ messages: msgs.slice(start, end), total: msgs.length });
});

// On-demand media download
app.get("/media", async (req, res) => {
  const { chatId, msgId } = req.query;
  if (!chatId || !msgId) return res.status(400).json({ error: "chatId and msgId required" });
  if (!sock || connectionState !== "connected") return res.status(503).json({ error: "Not connected" });

  const raw = rawMessages.get(`${chatId}::${msgId}`);
  if (!raw?.message) return res.status(404).json({ error: "Message not in cache" });

  const type = mediaType(raw);
  if (!type || type === "document") {
    // For documents skip auto-download — too large
    return res.status(415).json({ error: "Media type not previewable" });
  }

  try {
    const buffer = await downloadMediaMessage(
      raw,
      "buffer",
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );

    const m = raw.message;
    const mimeType =
      m.imageMessage?.mimetype ||
      m.videoMessage?.mimetype ||
      m.audioMessage?.mimetype ||
      m.stickerMessage?.mimetype ||
      "application/octet-stream";

    const b64 = buffer.toString("base64");
    res.json({ data_url: `data:${mimeType};base64,${b64}`, mime_type: mimeType });
  } catch (err) {
    res.status(500).json({ error: `Download failed: ${err.message}` });
  }
});

app.get("/profile-picture", async (req, res) => {
  const { chatId } = req.query;
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  if (!sock || connectionState !== "connected") return res.status(503).json({ error: "Not connected" });

  try {
    let url = await sock.profilePictureUrl(chatId, "preview", 5000);
    if (!url) url = await sock.profilePictureUrl(chatId, "image", 5000);
    if (!url) return res.status(404).json({ error: "Profile picture not available" });

    try {
      const picResp = await fetch(url);
      if (!picResp.ok) throw new Error(`HTTP ${picResp.status}`);
      const mimeType = picResp.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await picResp.arrayBuffer());
      res.json({
        url,
        data_url: `data:${mimeType};base64,${buffer.toString("base64")}`,
        mime_type: mimeType,
      });
    } catch {
      res.json({ url });
    }
  } catch (err) {
    res.status(404).json({ error: err.message || "Profile picture not available" });
  }
});

app.post("/send", async (req, res) => {
  const { chatId, message } = req.body || {};
  if (!chatId || !message) return res.status(400).json({ error: "chatId and message required" });
  if (!sock || connectionState !== "connected") return res.status(503).json({ error: "Not connected" });
  try {
    const sentMsg = await sock.sendMessage(chatId, { text: message });
    addMessage(chatId, sentMsg);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/delete", async (req, res) => {
  const { chatId, msgId } = req.body || {};
  if (!chatId || !msgId) return res.status(400).json({ error: "chatId and msgId required" });
  if (!sock || connectionState !== "connected") return res.status(503).json({ error: "Not connected" });

  const raw = rawMessages.get(`${chatId}::${msgId}`);
  if (!raw?.key) return res.status(404).json({ error: "Message not in cache" });
  if (!raw.key.fromMe) return res.status(403).json({ error: "Only messages sent by you can be deleted for everyone" });

  try {
    await sock.sendMessage(chatId, { delete: raw.key });
    removeMessage(chatId, msgId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/chat/delete", async (req, res) => {
  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  if (!sock || connectionState !== "connected") return res.status(503).json({ error: "Not connected" });

  const last = lastRawMessageForChat(chatId);
  if (!last) return res.status(404).json({ error: "Chat delete requires cached message history" });

  try {
    await sock.chatModify({
      delete: true,
      lastMessages: [
        {
          key: last.key,
          messageTimestamp: last.messageTimestamp,
        },
      ],
    }, chatId);
    removeChat(chatId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] MemoLink WhatsApp bridge listening on port ${PORT}`);
  startSocket();
});
