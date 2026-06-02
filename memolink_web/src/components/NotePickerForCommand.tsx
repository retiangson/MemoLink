import React from "react";
import type { Note } from "../types";

const ALL_SUPPORT = new Set(["improve","enhance","summarize","quiz","discussion"]);

interface Props {
  command: string;
  query: string;
  notes: Note[];
  activeIndex: number;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function NotePickerForCommand({ command, query, notes, activeIndex, onSelect, onClose }: Props) {
  const showAllOption = ALL_SUPPORT.has(command.toLowerCase()) &&
    (!query || "all".includes(query.toLowerCase()));

  const filtered = notes
    .filter(n => !query || (n.title ?? "").toLowerCase().includes(query.toLowerCase()))
    .slice(0, 25);

  const hasItems = showAllOption || filtered.length > 0;
  if (!hasItems) return null;

  // Build items in same order as ChatInput so activeIndex aligns
  type Item = { id: string; label: string; isAll?: boolean };
  const items: Item[] = [
    ...(showAllOption ? [{ id: "__ALL__", label: "All notes", isAll: true }] : []),
    ...filtered.map(n => ({ id: String(n.id), label: n.title ?? "Untitled" })),
  ];

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full mb-1.5 left-0 right-0 z-40 bg-black/65 backdrop-blur-md border border-white/8 rounded-xl shadow-xl overflow-hidden">
        <div className="px-3 pt-2 pb-1 flex items-center justify-between">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">
            {query ? `"${query}"` : "Select note"}
          </p>
          <p className="text-[10px] text-gray-700">↑↓ navigate · Tab/Enter select</p>
        </div>
        <div className="max-h-56 overflow-y-auto">
          {items.map((item, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={item.id}
                onMouseDown={(e) => { e.preventDefault(); onSelect(item.id === "__ALL__" ? "__ALL__" : item.label); }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 transition text-left group ${
                  active ? "bg-indigo-500/15" : "hover:bg-white/6"
                }`}
              >
                {item.isAll ? (
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                    active ? "bg-indigo-500/30 border-indigo-500/50" : "bg-indigo-500/10 border-indigo-500/20"
                  }`}>
                    <svg className="w-2.5 h-2.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </span>
                ) : (
                  <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                    active ? "bg-[#2a2a38] border-indigo-500/40" : "bg-[#1e1e2a] border-[#2a2a38]"
                  }`}>
                    <svg className={`w-2.5 h-2.5 ${active ? "text-indigo-400" : "text-gray-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                )}
                <span className={`text-xs truncate ${
                  active
                    ? item.isAll ? "text-indigo-300 font-medium" : "text-white"
                    : item.isAll ? "text-indigo-400" : "text-gray-400 group-hover:text-gray-200"
                }`}>
                  {item.label}
                </span>
                {active && (
                  <span className="ml-auto text-[10px] text-indigo-500/60 shrink-0">↵</span>
                )}
              </button>
            );
          })}
          {!hasItems && (
            <p className="px-3 py-2 text-[11px] text-gray-600">No notes match &ldquo;{query}&rdquo;</p>
          )}
        </div>
      </div>
    </>
  );
}
