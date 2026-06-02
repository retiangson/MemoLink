import React from "react";
import ChatBubble from "./ChatBubble";
import type { Conversation, Message } from "../types";

function ThinkingSpinner() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 max-w-[740px]">
      <div className="relative w-7 h-7 shrink-0">
        <div className="absolute inset-0 rounded-full border-[3px] border-indigo-500/20 border-t-indigo-400 animate-spin" />
        <div className="absolute inset-[4px] rounded-full border-2 border-purple-500/20 border-t-purple-400 animate-[spin_1.4s_linear_infinite_reverse]" />
      </div>
      <span className="text-sm text-indigo-300/70 animate-pulse">Thinking…</span>
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  activeConversation: Conversation | null;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlder: () => void;
  onAddToNotes: (content: string) => void;
  onDeleteMessage: (id: number, content: string, index: number) => void;
  onDropFiles: (files: File[]) => void;
  onApplyNoteEdit: (content: string, noteId: number | null) => void;
  onOpenNote?: (noteId: number) => void;
  onSaveNote?: (title: string, content: string) => void;
  hasOpenNote: boolean;
  translationEnabled?: boolean;
  modelAttributionEnabled?: boolean;
  confidenceEnabled?: boolean;
  autopilotEnabled?: boolean;
  workflowContext?: { conversationId: number; workspaceId: number | null; model: string | null };
  workflowSuggestions?: Record<number, { id: string; type: string; label: string; preview: string; params: Record<string, unknown> }[]>;
}

export function MessageList({
  messages, loading, streaming, activeConversation,
  messagesContainerRef, bottomRef,
  onLoadOlder, onAddToNotes, onDeleteMessage, onDropFiles,
  onApplyNoteEdit, onOpenNote, onSaveNote, hasOpenNote, translationEnabled = true, modelAttributionEnabled = true, confidenceEnabled = true, autopilotEnabled = true, workflowContext, workflowSuggestions,
}: MessageListProps) {
  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 min-w-0 overflow-y-auto"
      onScroll={(e) => { if (e.currentTarget.scrollTop < 120 && activeConversation) onLoadOlder(); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDropFiles(Array.from(e.dataTransfer.files)); }}
    >
      <div className="max-w-[740px] mx-auto flex flex-col gap-4">
        {messages.map((msg, idx) => {
          const isStreamingMsg = streaming && idx === messages.length - 1 && msg.role === "assistant";
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
            />
          );
        })}
        {loading && <ThinkingSpinner />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
