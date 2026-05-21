import { useState, useRef } from "react";
import { streamChat, uploadChat } from "../api/chatApi";
import { createConversation, renameConversation } from "../api/conversationApi";
import type { Conversation, Message } from "../types";
import { TEMP_ID } from "../types";

const STREAMING_ID = -99;

interface UseChatDeps {
  activeConversation: Conversation | null;
  setActiveConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  workspaceId?: number | null;
}

export function useChat({ activeConversation, setActiveConversation, setConversations, bottomRef, workspaceId }: UseChatDeps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
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
    if (loading || streaming) return;

    setInput("");
    setLoading(true);

    try {
      let conv = activeConversation;
      let conversationId: number;

      if (!conv || conv.id === TEMP_ID) {
        const created = await createConversation(workspaceId);
        conversationId = created.id;
        const title = (trimmed || pendingFiles[0]?.name || "New conversation").slice(0, 60);
        await renameConversation(conversationId, title);
        conv = { id: conversationId, title, messages: [], created_at: created.created_at ?? null };
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

      if (hasFiles) {
        // File uploads use the non-streaming endpoint
        const res = await uploadChat(conversationId, trimmed, pendingFiles);
        const aiMsg: Message = { id: res.message_id, role: "assistant", content: res.answer };
        updated = { ...updated, messages: [...updated.messages, aiMsg] };
        setActiveConversation(updated);
        setConversations((p) => [updated, ...p.filter((c) => c.id !== updated.id)]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        // Text-only: stream the response token by token
        const placeholderMsg: Message = { id: STREAMING_ID, role: "assistant", content: "" };
        updated = { ...updated, messages: [...updated.messages, placeholderMsg] };

        let accum = "";
        let firstToken = true;

        for await (const event of streamChat(conversationId, trimmed, 5, workspaceId)) {
          if (event.done) {
            // Replace placeholder with the final message id
            setActiveConversation((prev) => {
              if (!prev) return prev;
              const msgs = prev.messages.map((m) =>
                m.id === STREAMING_ID ? { ...m, id: event.id ?? STREAMING_ID } : m
              );
              return { ...prev, messages: msgs };
            });
            setConversations((p) =>
              p.map((c) =>
                c.id === conversationId
                  ? { ...c, messages: c.messages.map((m) => m.id === STREAMING_ID ? { ...m, id: event.id ?? STREAMING_ID } : m) }
                  : c
              )
            );
            break;
          }

          if (event.t) {
            accum += event.t;
            if (firstToken) {
              firstToken = false;
              setLoading(false);
              setStreaming(true);
              // Add placeholder to state now that we have the first token
              const withPlaceholder = { ...updated, messages: [...updated.messages] };
              withPlaceholder.messages[withPlaceholder.messages.length - 1] = { ...placeholderMsg, content: accum };
              setActiveConversation(withPlaceholder);
              setConversations((p) => [withPlaceholder, ...p.filter((c) => c.id !== withPlaceholder.id)]);
            } else {
              const currentAccum = accum;
              setActiveConversation((prev) => {
                if (!prev) return prev;
                const msgs = prev.messages.map((m) =>
                  m.id === STREAMING_ID ? { ...m, content: currentAccum } : m
                );
                return { ...prev, messages: msgs };
              });
            }
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
      }
    } finally {
      setLoading(false);
      setStreaming(false);
      setPendingFiles([]);
    }
  }

  return {
    input, setInput,
    loading,
    streaming,
    pendingFiles, setPendingFiles,
    textareaRef, attachmentInputRef,
    autoResize, handleSend,
  };
}
