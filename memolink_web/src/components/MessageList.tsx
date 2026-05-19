import React from "react";
import ChatBubble from "./ChatBubble";
import type { Conversation, Message } from "../types";

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  activeConversation: Conversation | null;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlder: () => void;
  onAddToNotes: (content: string) => void;
  onDeleteMessage: (id: number, content: string, index: number) => void;
  onDropFiles: (files: File[]) => void;
  onApplyNoteEdit: (content: string, noteId: number | null) => void;
  hasOpenNote: boolean;
}

export function MessageList({
  messages, loading, activeConversation,
  messagesContainerRef, bottomRef,
  onLoadOlder, onAddToNotes, onDeleteMessage, onDropFiles,
  onApplyNoteEdit, hasOpenNote,
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
        {messages.map((msg, idx) => (
          <ChatBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            onAdd={msg.role === "assistant" ? (text) => onAddToNotes(text) : undefined}
            onDelete={() => onDeleteMessage(msg.id, msg.content, idx)}
            onApplyEdit={msg.role === "assistant" ? onApplyNoteEdit : undefined}
            hasOpenNote={hasOpenNote}
          />
        ))}
        {loading && <ChatBubble role="assistant" content="Thinking…" />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
