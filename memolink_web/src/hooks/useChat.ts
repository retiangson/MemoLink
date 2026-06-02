import { useState, useRef } from "react";
import { streamChat, streamAgentChat, streamResearch, uploadChat } from "../api/chatApi";
import { streamCommand } from "../api/commandApi";
import { createConversation, renameConversation } from "../api/conversationApi";
import { useTTS } from "./useTTS";
import type { Conversation, Message } from "../types";
import { TEMP_ID } from "../types";

const STREAMING_ID = -99;

interface UseChatDeps {
  activeConversation: Conversation | null;
  setActiveConversation: React.Dispatch<React.SetStateAction<Conversation | null>>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  workspaceId?: number | null;
  model?: string | null;
  onCloseNote?: (noteId: number) => void;
  onOpenNote?: (noteId: number) => void;
  onNoteUpdated?: (noteId: number) => void;
}

export function useChat({ activeConversation, setActiveConversation, setConversations, bottomRef, workspaceId, model, onCloseNote, onOpenNote, onNoteUpdated }: UseChatDeps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const tts = useTTS();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
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
        setActiveConversation(updated);

        let toolStatus = "";   // tool-call status lines shown above the answer
        let accum = "";
        let firstContent = true;
        const isSlashCommand = trimmed.startsWith("/");

        const stream = isSlashCommand
          ? streamCommand(trimmed, conversationId, workspaceId ?? null, model ?? null)
          : researchMode
            ? streamResearch(conversationId, trimmed, workspaceId, model)
            : agentMode
              ? streamAgentChat(conversationId, trimmed, workspaceId, model)
              : streamChat(conversationId, trimmed, 5, workspaceId, model, webSearch);

        for await (const rawEvent of stream) {
          const event = rawEvent as any;
          if (event.close_note !== undefined) {
            onCloseNote?.(event.close_note);
            continue;
          }

          if (event.open_note !== undefined) {
            onOpenNote?.(event.open_note);
            continue;
          }

          if (event.speak !== undefined) {
            tts.speak(event.speak);
            continue;
          }

          if (event.note_updated !== undefined) {
            onNoteUpdated?.(event.note_updated);
            continue;
          }

          if (event.cmd_running !== undefined) {
            const content = `__CMD_RUNNING__:${event.cmd_running}`;
            accum = content;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
            });
            if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
            continue;
          }

          if (event.quiz !== undefined) {
            const quizContent = `__QUIZ__:${JSON.stringify(event.quiz)}`;
            accum = quizContent;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: quizContent } : m) };
            });
            if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
            continue;
          }

          if (event.improving_note !== undefined) {
            const content = `__IMPROVING_NOTE__:${event.improving_note}`;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
            });
            if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
            continue;
          }

          if (event.image_generating) {
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: "__IMAGE_GENERATING__" } : m) };
            });
            if (firstContent) {
              firstContent = false;
              setLoading(false);
              setStreaming(true);
            }
            continue;
          }

          if (event.done) {
            const finalId = event.id ?? STREAMING_ID;
            const finalModel = event.model;
            const confidence = event.confidence ?? undefined;
            const confidenceReason = event.confidence_reason ?? undefined;
            // Strip the <confidence> tag that was streamed as tokens but shouldn't display
            const stripTag = (s: string) => s.replace(/<confidence[^>]*>[\s\S]*?<\/confidence>/gi, "").trimEnd();
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, id: finalId, model: finalModel, content: stripTag(m.content), confidence, confidence_reason: confidenceReason } : m) };
            });
            setConversations((p) =>
              p.map((c) =>
                c.id === conversationId
                  ? { ...c, messages: c.messages.map((m) => m.id === STREAMING_ID ? { ...m, id: finalId, model: finalModel, content: stripTag(m.content), confidence, confidence_reason: confidenceReason } : m) }
                  : c
              )
            );
            break;
          }

          // Agent tool-call status chips
          if (event.tool_call && event.label) {
            toolStatus += (toolStatus ? "\n" : "") + `_🔧 ${event.label}…_`;
            const content = toolStatus;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
            });
            if (firstContent) {
              firstContent = false;
              setLoading(false);
              setStreaming(true);
            }
          }

          if (event.tool_result && event.ok) {
            // Mark last tool line as done
            toolStatus = toolStatus.replace(/…_$/, " ✓_");
            const content = toolStatus;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
            });
          }

          if (event.replace !== undefined) {
            accum = event.replace;
            setActiveConversation((prev) => {
              if (!prev) return prev;
              return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: event.replace! } : m) };
            });
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }

          if (event.t) {
            if (accum.startsWith("__CMD_RUNNING__:")) accum = "";
            accum += event.t;
            const content = toolStatus ? toolStatus + "\n\n" + accum : accum;
            if (firstContent) {
              firstContent = false;
              setLoading(false);
              setStreaming(true);
              const withPlaceholder = { ...updated, messages: [...updated.messages] };
              withPlaceholder.messages[withPlaceholder.messages.length - 1] = { ...placeholderMsg, content };
              setActiveConversation(withPlaceholder);
              setConversations((p) => [withPlaceholder, ...p.filter((c) => c.id !== withPlaceholder.id)]);
            } else {
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
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
    webSearch, setWebSearch,
    agentMode, setAgentMode,
    researchMode, setResearchMode,
    tts,
  };
}
