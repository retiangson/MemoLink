import React from "react";
import ChatBubble from "./ChatBubble";
import type { Conversation, Message } from "../types";

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  activeConversation: Conversation | null;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlder: () => void;
  onAddToNotes: (content: string) => Promise<void> | void;
  onDeleteMessage: (id: number, content: string, index: number) => void;
  onDropFiles: (files: File[]) => void;
  onApplyNoteEdit: (content: string, noteId: number | null) => void;
  onOpenNote?: (noteId: number) => void;
  onSaveNote?: (title: string, content: string) => Promise<void> | void;
  hasOpenNote: boolean;
  translationEnabled?: boolean;
  modelAttributionEnabled?: boolean;
  confidenceEnabled?: boolean;
  autopilotEnabled?: boolean;
  workflowContext?: { conversationId: number; workspaceId: number | null; model: string | null };
  workflowSuggestions?: Record<number, { id: string; type: string; label: string; preview: string; params: Record<string, unknown> }[]>;
  onWorkflowActionDone?: (type: string) => void;
  onWorkflowConversationMessages?: (messages: Message[]) => void;
  evaluationActive?: boolean;
  evalRatings?: Record<string, Record<string, number | string>>;
  onRetry?: (index: number) => void;
  onSearchOnline?: (searchQuerySuggestion?: string) => void;
}

export function MessageList({
  messages, loading, streaming, activeConversation,
  messagesContainerRef, bottomRef,
  onLoadOlder, onAddToNotes, onDeleteMessage, onDropFiles,
  onApplyNoteEdit, onOpenNote, onSaveNote, hasOpenNote, translationEnabled = true, modelAttributionEnabled = true, confidenceEnabled = true, autopilotEnabled = true, workflowContext, workflowSuggestions, onWorkflowActionDone, onWorkflowConversationMessages, evaluationActive = false, evalRatings, onRetry, onSearchOnline,
}: MessageListProps) {
  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 min-w-0 overflow-y-auto"
      onScroll={(e) => { if (e.currentTarget.scrollTop < 120 && activeConversation) onLoadOlder(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDropFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="max-w-full sm:max-w-[740px] mx-auto flex flex-col gap-4">
        {messages.map((msg, idx) => {
          const isLast = idx === messages.length - 1;
          const isStreamingMsg = streaming && isLast && msg.role === "assistant";
          // Only offer the evaluation rating once the AI has fully finished this
          // reply — never while it's still thinking (loading) or streaming.
          const ratingReady = evaluationActive && !(isLast && (loading || streaming));
          return (
            <ChatBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              model={msg.model}
              streaming={isStreamingMsg}
              onAdd={!isStreamingMsg && msg.role === "assistant" ? (text) => onAddToNotes(text) : undefined}
              onDelete={!isStreamingMsg ? () => onDeleteMessage(msg.id, msg.content, idx) : undefined}
              onApplyEdit={!isStreamingMsg && msg.role === "assistant" ? onApplyNoteEdit : undefined}
              onOpenNote={!isStreamingMsg && msg.role === "assistant" ? onOpenNote : undefined}
              onSaveNote={!isStreamingMsg && msg.role === "assistant" ? onSaveNote : undefined}
              hasOpenNote={hasOpenNote}
              translationEnabled={translationEnabled}
              modelAttributionEnabled={modelAttributionEnabled}
              confidence={msg.confidence}
              confidenceReason={msg.confidence_reason}
              confidenceEnabled={confidenceEnabled}
              routingReason={msg.routing_reason}
              autopilotEnabled={autopilotEnabled}
              workflowContext={workflowContext}
              workflowActions={workflowSuggestions?.[msg.id]}
              onWorkflowActionDone={onWorkflowActionDone}
              onWorkflowConversationMessages={onWorkflowConversationMessages}
              messageId={msg.id}
              evaluationActive={ratingReady}
              evalRating={evalRatings?.[String(msg.id)]}
              onRetry={!isStreamingMsg && onRetry ? () => onRetry(idx) : undefined}
              suggestWebSearch={!isStreamingMsg && msg.role === "assistant" && isLast ? msg.suggest_web_search : undefined}
              onSearchOnline={!isStreamingMsg && msg.role === "assistant" && isLast && onSearchOnline ? () => onSearchOnline(msg.search_query_suggestion) : undefined}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
