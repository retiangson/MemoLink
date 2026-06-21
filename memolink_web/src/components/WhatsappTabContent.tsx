import React, { useEffect, useRef, useState } from "react";
import type { WhatsappChat, WhatsappMessage } from "../api/whatsappApi";
import {
  getWhatsappMessages,
  getWhatsappProfilePicture,
  sendWhatsappMessage,
  deleteWhatsappMessage,
  deleteWhatsappChat,
  suggestWhatsappReply,
  getWhatsappMedia,
} from "../api/whatsappApi";
import { translateText } from "../api/chatApi";
import { useTTS } from "../hooks/useTTS";
import { formatWhatsappText } from "../utils/formatWhatsappText";

const TRANSLATE_LANGUAGES = [
  "English", "Māori", "Chinese", "Japanese", "Korean",
  "Spanish", "French", "German", "Portuguese", "Italian",
  "Russian", "Arabic", "Hindi", "Tagalog",
];

interface TranslationState {
  translation: string;
  translatedTo: string;
  accuracy: number | null;
  model?: string;
  cached: boolean;
}

interface WhatsappTabContentProps {
  chat: WhatsappChat;
  draft: string;
  onDraftChange: (chatId: string, draft: string) => void;
  onChatDeleted: (chatId: string) => void;
}

function waInitials(name: string): string {
  const clean = (name || "?").replace(/^\+/, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function WhatsappTabContent({ chat, draft, onDraftChange, onChatDeleted }: WhatsappTabContentProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(chat.avatarUrl ?? null);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgOffset, setMsgOffset] = useState(0);
  const [msgLoading, setMsgLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  // Draft text lives in useWhatsappTabs (owned by ChatPage), not local state, so it
  // survives this component unmounting when the user switches to a different tab type.
  const reply = draft;
  const setReply = (value: string) => onDraftChange(chat.id, value);
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaCache, setMediaCache] = useState<Map<string, string>>(new Map());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingChat, setDeletingChat] = useState(false);

  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [langPickerFor, setLangPickerFor] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Map<string, TranslationState>>(new Map());

  const tts = useTTS();
  const suggestRequestId = useRef(0);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  async function loadMessages() {
    setMessages([]);
    setMsgTotal(0);
    setMsgOffset(0);
    setSuggestions([]);
    setError(null);
    setMsgLoading(true);
    try {
      const { messages: msgs, total } = await getWhatsappMessages(chat.id, 30, 0);
      setMessages(msgs);
      setMsgTotal(total);
      setMsgOffset(0);
    } catch {
      setError("Could not load messages.");
    } finally {
      setMsgLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    if (!chat.avatarUrl) {
      getWhatsappProfilePicture(chat.id).then(setAvatarUrl).catch(() => {});
    } else {
      setAvatarUrl(chat.avatarUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(() => {
    return () => tts.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(() => {
    if (!tts.playing) setSpeakingMsgId(null);
  }, [tts.playing]);

  useEffect(() => {
    const el = replyTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [reply]);

  async function handleLoadOlder() {
    const nextOffset = msgOffset + 30;
    setOlderLoading(true);
    try {
      const { messages: msgs, total } = await getWhatsappMessages(chat.id, 30, nextOffset);
      setMessages((prev) => [...msgs, ...prev]);
      setMsgTotal(total);
      setMsgOffset(nextOffset);
    } catch {
      /* ignore */
    } finally {
      setOlderLoading(false);
    }
  }

  async function handleSendReply() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await sendWhatsappMessage(chat.id, reply.trim());
      setReply("");
      setSuggestions([]);
      const { messages: msgs, total } = await getWhatsappMessages(chat.id, 30, 0);
      setMessages(msgs);
      setMsgTotal(total);
      setMsgOffset(0);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteMessage(message: WhatsappMessage) {
    if (!message.fromMe || deletingId) return;
    if (!window.confirm("Delete this WhatsApp message for everyone?")) return;
    setDeletingId(message.id);
    setError(null);
    try {
      await deleteWhatsappMessage(chat.id, message.id);
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
      setMsgTotal((prev) => Math.max(0, prev - 1));
      setMediaCache((prev) => {
        const next = new Map(prev);
        next.delete(message.id);
        return next;
      });
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Could not delete message.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteConversation() {
    if (deletingChat) return;
    if (!window.confirm(`Delete the WhatsApp conversation with ${chat.name}? This removes the chat from your WhatsApp account.`)) return;
    setDeletingChat(true);
    setError(null);
    try {
      await deleteWhatsappChat(chat.id);
      onChatDeleted(chat.id);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Could not delete conversation.");
      setDeletingChat(false);
    }
  }

  async function handleSuggestReply() {
    // Guard against out-of-order responses: if the user clicks Suggest again
    // (e.g. after editing the draft) before the first request resolves, a
    // slower earlier response landing later must not overwrite the newer one.
    const requestId = ++suggestRequestId.current;
    const draftAtRequestTime = reply;
    setSuggestLoading(true);
    setSuggestions([]);
    try {
      const result = await suggestWhatsappReply(chat.id, "", draftAtRequestTime);
      if (suggestRequestId.current === requestId) setSuggestions(result);
    } catch {
      /* ignore */
    } finally {
      if (suggestRequestId.current === requestId) setSuggestLoading(false);
    }
  }

  function handleToggleSpeak(message: WhatsappMessage) {
    if (speakingMsgId === message.id && tts.playing) {
      tts.stop();
      setSpeakingMsgId(null);
      return;
    }
    if (!message.body.trim()) return;
    tts.speak(message.body);
    setSpeakingMsgId(message.id);
  }

  async function handleTranslate(message: WhatsappMessage, lang: string, force = false) {
    setLangPickerFor(null);
    setTranslatingId(message.id);
    try {
      const { translation, accuracy, model, cached } = await translateText(message.body, lang, force);
      setTranslations((prev) => new Map(prev).set(message.id, { translation, translatedTo: lang, accuracy, model, cached }));
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? "Unknown error";
      setTranslations((prev) => new Map(prev).set(message.id, { translation: `Translation failed: ${msg}`, translatedTo: lang, accuracy: null, cached: false }));
    } finally {
      setTranslatingId(null);
    }
  }

  function clearTranslation(messageId: string) {
    setTranslations((prev) => {
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });
  }

  const isGroup = chat.id.endsWith("@g.us");
  const phoneNum = !isGroup ? `+${chat.id.replace("@s.whatsapp.net", "")}` : null;
  const showNum = phoneNum && phoneNum !== `+${chat.name}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              onError={() => setAvatarUrl(null)}
              className="h-9 w-9 shrink-0 rounded-full object-cover border border-green-500/20 bg-[var(--ml-bg-hover)]"
            />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded-full border border-green-500/20 bg-green-500/10 text-xs font-semibold text-green-300 flex items-center justify-center">
              {waInitials(chat.name)}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-100 truncate">{chat.name}</h3>
            {showNum && <p className="text-[11px] text-gray-500 truncate">{phoneNum}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDeleteConversation}
            disabled={deletingChat}
            title="Delete conversation"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
          >
            {deletingChat ? (
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1 0-2H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1M4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {!msgLoading && messages.length > 0 && msgOffset + 30 < msgTotal && (
          <button
            onClick={handleLoadOlder}
            disabled={olderLoading}
            className="w-full text-xs text-gray-500 hover:text-gray-300 py-1.5 border border-[var(--ml-bg-hover)] rounded-lg hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-40"
          >
            {olderLoading ? "Loading…" : `↑ Load older messages (${msgTotal - messages.length} more)`}
          </button>
        )}

        {msgLoading ? (
          <p className="text-xs text-gray-600">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-gray-600">No messages yet</p>
        ) : (
          messages.map((m) => {
            const senderLabel = m.senderName || m.from || m.senderId || "Unknown";
            const bubbleCls = m.fromMe ? "bg-green-600/20 text-gray-200" : "bg-[var(--ml-bg-hover)] text-gray-300";
            const isPreviewableImage = m.mediaType === "image" || m.mediaType === "sticker";
            const cachedImg = isPreviewableImage ? mediaCache.get(m.id) : undefined;
            const isSpeaking = speakingMsgId === m.id && tts.playing;
            const translation = translations.get(m.id);
            const isTranslating = translatingId === m.id;

            return (
              <div key={m.id} className={`flex flex-col ${m.fromMe ? "items-end" : "items-start"}`}>
                {!m.fromMe && <p className="text-[11px] text-green-400 font-medium mb-0.5">{senderLabel}</p>}
                <div className="group/message flex items-start gap-1.5 max-w-[80%]">
                  {m.fromMe && (
                    <button
                      onClick={() => handleDeleteMessage(m)}
                      disabled={deletingId === m.id}
                      title="Delete for everyone"
                      className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover/message:opacity-100 disabled:cursor-wait disabled:opacity-50"
                    >
                      {deletingId === m.id ? (
                        <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                          <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1 0-2H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1M4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                        </svg>
                      )}
                    </button>
                  )}

                  <div className="flex flex-col gap-1">
                    {m.quoted && (
                      <div className={`rounded-lg border-l-2 border-green-500/40 bg-black/15 px-2.5 py-1.5 max-w-full ${m.fromMe ? "self-end" : "self-start"}`}>
                        <p className="text-[10px] text-green-400 font-medium truncate">
                          {m.quoted.senderName === "me" ? "You" : (m.quoted.senderName || "Unknown")}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">{m.quoted.body || "[message]"}</p>
                      </div>
                    )}
                    <div className={`rounded-2xl overflow-hidden ${bubbleCls}`}>
                      {isPreviewableImage ? (
                        cachedImg ? (
                          <img
                            src={cachedImg}
                            alt={m.mediaType === "sticker" ? "sticker" : "image"}
                            className={m.mediaType === "sticker" ? "max-w-40 max-h-40 object-contain rounded-2xl" : "max-w-full max-h-72 object-cover rounded-2xl"}
                          />
                        ) : (
                          <button
                            onClick={async () => {
                              const result = await getWhatsappMedia(m.chatId, m.id);
                              if (result?.data_url) setMediaCache((prev) => new Map(prev).set(m.id, result.data_url));
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
                              <path d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z" />
                            </svg>
                            {m.mediaType === "sticker" ? "Tap to load sticker" : m.body !== "[image]" ? m.body : "Tap to load image"}
                          </button>
                        )
                      ) : m.mediaType === "audio" ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M6 3a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-1 0v-9A.5.5 0 0 1 6 3m2.5 2a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5M3 6.5a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0zm6.5-.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 1 .5-.5M1 8a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 0 1h-.5A.5.5 0 0 1 1 8m11 0a.5.5 0 0 1 .5-.5h.5a.5.5 0 0 1 0 1h-.5A.5.5 0 0 1 12 8" />
                          </svg>
                          Voice message
                        </div>
                      ) : m.mediaType === "video" || m.mediaType === "document" ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2z" />
                          </svg>
                          {m.body}
                        </div>
                      ) : (
                        <p className="px-3 py-2 text-sm leading-snug whitespace-pre-wrap">{formatWhatsappText(m.body)}</p>
                      )}
                    </div>

                    {translation && (
                      <div className="rounded-2xl bg-[var(--ml-bg-surface)] border border-indigo-500/20 px-3 py-2 max-w-full">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-indigo-400 uppercase tracking-wider font-medium">{translation.translatedTo}</span>
                            {translation.cached && !isTranslating && (
                              <span className="px-1 py-0.5 rounded text-[8px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">Cached</span>
                            )}
                          </div>
                          <button onClick={() => clearTranslation(m.id)} className="text-gray-600 hover:text-gray-400 text-[10px] leading-none px-1">✕</button>
                        </div>
                        <p className="text-sm text-gray-200 leading-snug whitespace-pre-wrap">{translation.translation}</p>
                        {translation.accuracy !== null && (
                          <p className={`mt-1 text-[9px] ${translation.accuracy >= 85 ? "text-emerald-600/60" : translation.accuracy >= 70 ? "text-amber-600/60" : "text-red-600/60"}`}>
                            {translation.accuracy}% accuracy
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2.5 px-1">
                      <button
                        onClick={() => handleToggleSpeak(m)}
                        title={isSpeaking ? "Stop reading" : "Read aloud"}
                        className={`flex items-center justify-center w-5 h-5 rounded transition ${isSpeaking ? "text-indigo-400" : "text-gray-600 hover:text-indigo-300"}`}
                      >
                        {isSpeaking ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm4 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z" />
                            <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z" />
                            <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06" />
                          </svg>
                        )}
                      </button>

                      <div className="relative">
                        {langPickerFor === m.id && (
                          <>
                            <div className="fixed inset-0 z-[9]" onClick={() => setLangPickerFor(null)} />
                            <div className={`absolute bottom-full mb-1 z-10 bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-xl overflow-hidden min-w-[140px] max-h-56 overflow-y-auto ${m.fromMe ? "right-0" : "left-0"}`}>
                              {TRANSLATE_LANGUAGES.map((lang) => (
                                <button
                                  key={lang}
                                  onClick={() => handleTranslate(m, lang)}
                                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[var(--ml-bg-hover)] transition"
                                >
                                  {lang}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        <button
                          onClick={() => setLangPickerFor((v) => (v === m.id ? null : m.id))}
                          disabled={isTranslating}
                          title="Translate"
                          className="flex items-center justify-center w-5 h-5 rounded text-gray-600 hover:text-indigo-300 transition disabled:opacity-60 disabled:cursor-wait"
                        >
                          {isTranslating ? (
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M4.545 6.714 4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z" />
                              <path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14v-.91h-3v-.703h-.905v.703h-3v.91h1.05c.171.592.43 1.147.774 1.657a6.08 6.08 0 0 1-1.927 1.292 5.085 5.085 0 0 0 .536.732 6.73 6.73 0 0 0 1.862-1.276z" />
                            </svg>
                          )}
                        </button>
                      </div>

                      <p className="text-[10px] text-gray-700">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="px-5 pt-3 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-600">
              AI suggestions{reply.trim() ? " (based on your draft)" : ""} — tap to use:
            </p>
            <button
              onClick={() => setSuggestions([])}
              title="Dismiss suggestions"
              className="shrink-0 text-gray-600 hover:text-gray-300 text-xs leading-none px-1"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setReply(s)}
                className="text-left text-xs px-3 py-1.5 rounded-lg border border-green-500/20 bg-green-500/5 text-gray-300 hover:bg-green-500/15 hover:border-green-500/40 transition leading-snug"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 px-5 py-4 border-t border-[var(--ml-bg-hover)] shrink-0">
        <div className="relative group/suggest shrink-0">
          <button
            onClick={handleSuggestReply}
            disabled={suggestLoading || deletingChat}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-green-500/25 text-green-400 hover:bg-green-500/10 transition disabled:opacity-40"
          >
            {suggestLoading ? (
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <span className="text-sm leading-none">✦</span>
            )}
          </button>
          <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-panel)] px-2 py-1 text-[10px] text-gray-300 opacity-0 transition group-hover/suggest:opacity-100">
            {reply.trim() ? "Improve draft" : "Suggest"}
          </span>
        </div>
        <textarea
          ref={replyTextareaRef}
          value={reply}
          onChange={(e) => {
            setReply(e.target.value);
            if (suggestions.length > 0) setSuggestions([]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendReply();
            }
          }}
          placeholder="Reply… (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none bg-[var(--ml-bg-base)] border border-[var(--ml-bg-hover)] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-green-500/50 leading-snug max-h-[150px] overflow-y-auto"
        />
        <button
          onClick={handleSendReply}
          disabled={sending || !reply.trim()}
          className="px-4 py-2 text-sm bg-green-600/20 border border-green-500/30 text-green-300 rounded-lg hover:bg-green-600/30 disabled:opacity-40 transition"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
