import { useState } from "react";
import type { Workspace, WorkspaceType } from "../types";

const TYPE_ICONS: Record<WorkspaceType, string> = {
  Academic: "🎓",
  Professional: "💼",
  Personal: "🏠",
  Project: "🚀",
  Other: "📁",
};

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  onSwitch: (ws: Workspace) => void;
  onManage: () => void;
}

export function WorkspaceSelector({ workspaces, activeWorkspace, onSwitch, onManage }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false);

  const totalAlerts = workspaces.reduce((sum, ws) => sum + (ws.alert_count ?? 0), 0);
  const icon = activeWorkspace ? (TYPE_ICONS[activeWorkspace.type as WorkspaceType] ?? "📁") : "📁";

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a24] hover:bg-[var(--ml-bg-hover)] border border-[var(--ml-bg-hover)] transition text-left"
      >
        <span className="text-base shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-200 truncate">{activeWorkspace?.name ?? "No workspace"}</p>
          <p className="text-[10px] text-gray-500">{activeWorkspace?.type ?? ""}</p>
        </div>
        {totalAlerts > 0 && (
          <span className="shrink-0 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black leading-none">
            {totalAlerts}
          </span>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-gray-600 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-[9999] w-full bg-[var(--ml-bg-panel)] border border-[var(--ml-bg-hover)] rounded-xl shadow-2xl py-1 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => { onSwitch(ws); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--ml-bg-hover)] transition ${activeWorkspace?.id === ws.id ? "bg-indigo-600/10" : ""}`}
            >
              <span className="text-sm shrink-0">{TYPE_ICONS[ws.type as WorkspaceType] ?? "📁"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 truncate font-medium">{ws.name}</p>
                <p className="text-[10px] text-gray-500">{ws.type}</p>
              </div>
              {ws.alert_count > 0 && (
                <span className="shrink-0 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-black">
                  {ws.alert_count}
                </span>
              )}
              {activeWorkspace?.id === ws.id && (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>
                </svg>
              )}
            </button>
          ))}
          <div className="border-t border-[var(--ml-bg-hover)] mt-1 pt-1">
            <button
              onClick={() => { onManage(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-[var(--ml-bg-hover)] transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
                <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.375l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
              </svg>
              Manage Workspaces
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
