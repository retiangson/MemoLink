import React, { useState } from "react";
import type { SuggestionItem } from "../hooks/useSuggestions";
import { ReminderDetailModal } from "./ReminderDetailModal";
import { AddReminderModal } from "./AddReminderModal";

interface RightPanelProps {
  open: boolean;
  onClose: () => void;
  items: SuggestionItem[];
  isGenerating: boolean;
  onAddManual: (text: string, description?: string | null, due_date?: string | null, due_time?: string | null) => void;
  onToggleDone: (id: number) => void;
  onUpdate: (id: number, fields: { text: string; description: string | null; due_date: string | null; due_time: string | null; done: boolean }) => void;
  onRemove: (id: number) => void;
  onClearDone: () => void;
  onGenerate: () => void;
}

export function RightPanel({
  open, onClose, items, isGenerating,
  onAddManual, onToggleDone, onUpdate, onRemove, onClearDone,
  onGenerate,
}: RightPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SuggestionItem | null>(null);

  if (!open) return null;

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="w-72 h-full flex flex-col bg-[#0f0f13] border-l border-[#1e1e2a] shrink-0">

      {/* Header */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-[#1e1e2a] shrink-0 bg-[#0a0a0f]">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
          </svg>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Reminders</span>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition text-sm leading-none">✕</button>
      </div>

      {/* Action row: Generate + Add */}
      <div className="px-3 pt-3 pb-3 border-b border-[#1e1e2a] shrink-0 flex flex-col gap-2">
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-lg text-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Generating…
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
              </svg>
              Generate from Notes
            </>
          )}
        </button>

        <button
          onClick={() => setShowAddModal(true)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border border-[#2a2a38] hover:border-[#3a3a4a] text-gray-500 hover:text-gray-300 rounded-lg text-xs transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Reminder
        </button>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {items.length === 0 && !isGenerating && (
          <div className="text-center mt-10 px-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-gray-700 mx-auto mb-3" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a2 2 0 0 0-.453-.618A5.98 5.98 0 0 1 2 6m3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5"/>
            </svg>
            <p className="text-xs text-gray-600 leading-relaxed">
              Save a note to get AI suggestions, or add a reminder above.
            </p>
          </div>
        )}

        {items.map((item) => {
          const isToday = !item.done && item.due_date === today;
          const isOverdue = !item.done && !!item.due_date && item.due_date < today;
          return (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className={`group flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
                item.done
                  ? "bg-[#0a0a0f]/60 border-[#1a1a22] opacity-50 hover:opacity-70"
                  : isOverdue
                    ? "bg-[#1a0a0a] border-red-500/30 hover:border-red-400/50"
                    : isToday
                      ? "bg-[#1a1a10] border-amber-500/40 hover:border-amber-400/60"
                      : "bg-[#1a1a24] border-[#2a2a38] hover:border-indigo-500/40"
              }`}
            >
              {/* Checkbox */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleDone(item.id); }}
                className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  item.done
                    ? "bg-indigo-600 border-indigo-600"
                    : "border-gray-600 hover:border-indigo-400"
                }`}
              >
                {item.done && (
                  <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* Text + meta */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-snug break-words ${item.done ? "line-through text-gray-600" : "text-gray-200"}`}>
                  {item.text}
                </p>
                {item.description && (
                  <p className={`text-[11px] mt-0.5 leading-snug break-words line-clamp-2 ${item.done ? "text-gray-700" : "text-gray-500"}`}>
                    {item.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {item.type === "ai" && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400/60 uppercase tracking-wider">
                      ✦ AI
                    </span>
                  )}
                  {item.due_date && (
                    <span className={`text-[10px] ${
                      isOverdue ? "text-red-400 font-medium" :
                      isToday ? "text-amber-400 font-medium" : "text-gray-600"
                    }`}>
                      {isOverdue ? "⚠ Overdue" : isToday ? "⚠ Today" : item.due_date}
                      {item.due_time && ` · ${item.due_time}`}
                    </span>
                  )}
                </div>
              </div>

              {/* Remove */}
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                className="text-gray-700 hover:text-red-400 transition shrink-0 text-sm leading-none opacity-0 group-hover:opacity-100"
                title="Delete"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer: clear done */}
      {doneCount > 0 && (
        <div className="px-3 py-2 border-t border-[#1e1e2a] shrink-0">
          <button
            onClick={onClearDone}
            className="w-full text-xs text-gray-600 hover:text-gray-400 transition py-1"
          >
            Clear {doneCount} completed
          </button>
        </div>
      )}

      {/* Add reminder popup */}
      {showAddModal && (
        <AddReminderModal
          onClose={() => setShowAddModal(false)}
          onAdd={(t, d, date, time) => onAddManual(t, d, date, time)}
        />
      )}

      {/* Detail modal — keep up-to-date version of item from list */}
      <ReminderDetailModal
        item={selectedItem ? (items.find((i) => i.id === selectedItem.id) ?? selectedItem) : null}
        onClose={() => setSelectedItem(null)}
        onSave={(id, fields) => onUpdate(id, fields)}
        onDelete={(id) => onRemove(id)}
        onToggleDone={(id) => onToggleDone(id)}
      />
    </div>
  );
}
