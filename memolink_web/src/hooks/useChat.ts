import { useState, useRef } from "react";
import { streamChat, uploadChat } from "../api/chatApi";
import { streamCommand } from "../api/commandApi";
import { createConversation, renameConversation } from "../api/conversationApi";
import { buildDiscussionCommand } from "../constants/slashCommands";
import { useTTS } from "./useTTS";
import type { ChatStreamEvent, Conversation, Message } from "../types";
import { TEMP_ID } from "../types";

const STREAMING_ID = -99;

function usePersistedToggle(key: string): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => localStorage.getItem(key) === "true");
  const setAndPersist: React.Dispatch<React.SetStateAction<boolean>> = (action) => {
    setValue((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      localStorage.setItem(key, String(next));
      return next;
    });
  };
  return [value, setAndPersist];
}

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
  const [webSearch, setWebSearch] = usePersistedToggle("memolink_mode_web");
  const [discussionMode, setDiscussionMode] = usePersistedToggle("memolink_mode_discussion");
  // Last user prompt — needed so searchOnline can re-send the same turn with web search enabled
  const lastUserPromptRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  function autoResize() {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }

  async function handleSend(overrideInput?: string, options?: { webSearchOverride?: boolean; searchQueryOverride?: string }) {
    const trimmed = (overrideInput ?? input).trim();
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
        const placeholderMsg: Message = { id: STREAMING_ID, role: "assistant", content: "__THINKING__" };
        updated = { ...updated, messages: [...updated.messages, placeholderMsg] };
        setActiveConversation(updated);

        let toolStatus = "";   // tool-call status lines shown above the answer
        let accum = "";
        let firstContent = true;
        const isSlashCommand = trimmed.startsWith("/");

        // Store prompt so searchOnline can re-send it with web_search=true
        lastUserPromptRef.current = trimmed;

        const effectiveWebSearch = options?.webSearchOverride ?? webSearch;
        const stream = isSlashCommand
          ? streamCommand(trimmed, conversationId, workspaceId ?? null, model ?? null)
          : discussionMode
            ? streamCommand(buildDiscussionCommand(trimmed), conversationId, workspaceId ?? null, model ?? null)
            : streamChat(
                conversationId,
                trimmed,
                5,
                workspaceId,
                model,
                effectiveWebSearch,
                options?.searchQueryOverride ?? null,
              );

        for await (const rawEvent of stream) {
          const event = rawEvent as ChatStreamEvent;
          switch (event.type) {
            case "note.close":
              onCloseNote?.(event.note_id);
              continue;
            case "note.open":
              onOpenNote?.(event.note_id);
              continue;
            case "tts.speak":
              tts.speak(event.text);
              continue;
            case "note.updated":
              onNoteUpdated?.(event.note_id);
              continue;
            case "command.running": {
              const content = `__CMD_RUNNING__:${event.command}`;
              accum = content;
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
              });
              if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
              continue;
            }
            case "quiz.ready": {
              const quizContent = `__QUIZ__:${JSON.stringify(event.quiz)}`;
              accum = quizContent;
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: quizContent } : m) };
              });
              if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
              continue;
            }
            case "note.improving": {
              const content = `__IMPROVING_NOTE__:${event.title}`;
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content } : m) };
              });
              if (firstContent) { firstContent = false; setLoading(false); setStreaming(true); }
              continue;
            }
            case "image.generating":
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
            case "message.complete": {
              const finalId = event.message_id ?? STREAMING_ID;
              const finalModel = event.model;
              const confidence = event.confidence ?? undefined;
              const confidenceReason = event.confidence_reason ?? undefined;
              const routingReason = event.routing_reason ?? undefined;
              const suggestWebSearch = event.suggest_web_search === true && !effectiveWebSearch;
              const searchQuerySuggestion = event.search_query_suggestion ?? undefined;
              const stripTag = (s: string) => s.replace(/<confidence[^>]*>[\s\S]*?<\/confidence>/gi, "").trimEnd();
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, id: finalId, model: finalModel, content: stripTag(m.content), confidence, confidence_reason: confidenceReason, routing_reason: routingReason, suggest_web_search: suggestWebSearch, search_query_suggestion: searchQuerySuggestion } : m) };
              });
              setConversations((p) =>
                p.map((c) =>
                  c.id === conversationId
                    ? { ...c, messages: c.messages.map((m) => m.id === STREAMING_ID ? { ...m, id: finalId, model: finalModel, content: stripTag(m.content), confidence, confidence_reason: confidenceReason, routing_reason: routingReason, suggest_web_search: suggestWebSearch, search_query_suggestion: searchQuerySuggestion } : m) }
                    : c
                )
              );
              break;
            }
            case "tool.start":
              toolStatus += (toolStatus ? "\n" : "") + `_🔧 ${event.label}…_`;
              setActiveConversation((prev) => {
                if (!prev) return prev;
                return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: toolStatus } : m) };
              });
              if (firstContent) {
                firstContent = false;
                setLoading(false);
                setStreaming(true);
              }
              continue;
            case "tool.complete":
              if (event.ok) {
                toolStatus = toolStatus.replace(/…_$/, " ✓_");
                setActiveConversation((prev) => {
                  if (!prev) return prev;
                  return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: toolStatus } : m) };
                });
              }
              continue;
            case "message.replace":
              accum = event.content;
              if (firstContent) {
                firstContent = false;
                setLoading(false);
                setStreaming(true);
                const withPlaceholder = { ...updated, messages: [...updated.messages] };
                withPlaceholder.messages[withPlaceholder.messages.length - 1] = { ...placeholderMsg, content: event.content };
                setActiveConversation(withPlaceholder);
                setConversations((p) => [withPlaceholder, ...p.filter((c) => c.id !== withPlaceholder.id)]);
              } else {
                setActiveConversation((prev) => {
                  if (!prev) return prev;
                  return { ...prev, messages: prev.messages.map((m) => m.id === STREAMING_ID ? { ...m, content: event.content } : m) };
                });
              }
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              continue;
            case "message.delta": {
              if (accum.startsWith("__CMD_RUNNING__:")) accum = "";
              accum += event.text;
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
              continue;
            }
            default:
              continue;
          }
        }
      }
    } finally {
      setLoading(false);
      setStreaming(false);
      setPendingFiles([]);
    }
  }

  // Re-send the last user prompt with web search enabled (triggered by the "Search online?" chip)
  async function searchOnline(searchQuerySuggestion?: string) {
    const prompt = lastUserPromptRef.current;
    if (!prompt || loading) return;
    setWebSearch(true);
    setInput(prompt);
    await handleSend(prompt, { webSearchOverride: true, searchQueryOverride: searchQuerySuggestion?.trim() || undefined });
  }

  return {
    input, setInput,
    loading,
    streaming,
    pendingFiles, setPendingFiles,
    textareaRef, attachmentInputRef,
    autoResize, handleSend, searchOnline,
    webSearch, setWebSearch,
    discussionMode, setDiscussionMode,
    tts,
  };
}
