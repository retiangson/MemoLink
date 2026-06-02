import React from "react";
import { SLASH_COMMANDS } from "../constants/slashCommands";

interface Props {
  query: string;
  activeIndex: number;
  onSelect: (syntax: string) => void;
  onClose: () => void;
}

export function SlashCommandPicker({ query, activeIndex, onSelect, onClose }: Props) {
  const filter = query.slice(1).toLowerCase();
  const filtered = SLASH_COMMANDS.filter(
    (c) => filter === "" || c.cmd.toLowerCase().startsWith(filter)
  );

  if (filtered.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full mb-1.5 left-0 right-0 z-40 bg-black/60 backdrop-blur-md border border-white/8 rounded-xl shadow-xl overflow-hidden">
        <div className="px-3 pt-2 pb-1 flex items-center justify-between">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Commands</p>
          <p className="text-[10px] text-gray-700">↑↓ navigate · Tab/Enter select · Esc cancel</p>
        </div>
        <div className="max-h-52 overflow-y-auto">
          {filtered.map((cmd, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={cmd.cmd}
                onMouseDown={(e) => { e.preventDefault(); onSelect(cmd.syntax); }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 transition text-left ${
                  active ? "bg-indigo-500/15" : "hover:bg-white/6"
                }`}
              >
                <span className={`font-mono text-xs font-semibold shrink-0 w-24 ${active ? "text-indigo-300" : "text-indigo-400"}`}>
                  /{cmd.cmd}
                </span>
                <span className={`text-[11px] truncate transition ${active ? "text-gray-300" : "text-gray-500"}`}>
                  {cmd.desc}{cmd.hasAll ? " · All" : ""}
                </span>
                {active && <span className="ml-auto text-[10px] text-indigo-500/60 shrink-0">↵</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
