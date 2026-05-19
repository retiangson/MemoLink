import { useState, useRef } from "react";
import { sendChat, uploadChat } from "../api/chatApi";
import { createConversation, renameConversation } from "../api/conversationApi";
import type { Conversation, Message } from "../types";
import { TEMP_ID } from "../types";

interface UseChatDeps {
  activeConversation: Conversation | null;
  setActiveConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

export function useChat({ activeConversation, setActiveConversation, setConversations, bottomRef }: UseChatDeps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  function autoResize() {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }

  async function handleSend() {
    const trimmed = input.trim();
    const hasText = trimmed.length > 0;
    const hasFiles = pendingFiles.length > 0;
    if (!hasText && !hasFiles) return;

    setInput("");
    setLoading(true);

    try {
      let conv = activeConversation;
      let conversationId: number;

      if (!conv || conv.id === TEMP_ID) {
        const created = await createConversation();
        conversationId = created.id;
        const title = (trimmed || pendingFiles[0]?.name || "New conversation").slice(0, 60);
        await renameConversation(conversationId, title);
        conv = { id: conversationId, title, messages: [] };
        setConversations((p) => [conv!, ...p]);
        setActiveConversation(conv);
      } else {
        conversationId = conv.id;
      }

      const userContent = hasFiles
        ? (pendingFiles.map((f) => `📎 ${f.name}`).join("\n") + (trimmed ? `\n\n${trimmed}` : ""))
        : trimmed;

      const userMsg: Message = { id: Date.now() - 1, role: "user", content: userContent };
      let updated: Conversation = { ...conv, messages: [...conv.messages, userMsg] };
      setActiveConversation(updated);
      setConversations((p) => [updated, ...p.filter((c) => c.id !== updated.id)]);

      const res = hasFiles
        ? await uploadChat(conversationId, trimmed, pendingFiles)
        : await sendChat(conversationId, trimmed);

      const aiMsg: Message = { id: res.message_id, role: "assistant", content: res.answer };
      updated = { ...updated, messages: [...updated.messages, aiMsg] };
      setActiveConversation(updated);
      setConversations((p) => [updated, ...p.filter((c) => c.id !== updated.id)]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } finally {
      setLoading(false);
      setPendingFiles([]);
    }
  }

  return {
    input, setInput,
    loading,
    pendingFiles, setPendingFiles,
    textareaRef, attachmentInputRef,
    autoResize, handleSend,
  };
}
