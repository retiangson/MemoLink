import { useEffect, useRef, useState } from "react";
import { listShellProcesses, killShellProcess, RunningProcess } from "../api/shellApi";

const POLL_MS = 3000;

export function RunningProcessBanner() {
  const [processes, setProcesses] = useState<RunningProcess[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const procs = await listShellProcesses();
      setProcesses(procs);
    } catch {
      // silently ignore — backend may be starting
    }
  }

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleKill(procId: string) {
    try {
      await killShellProcess(procId);
      setProcesses((prev) => prev.filter((p) => p.proc_id !== procId));
    } catch {
      // re-poll to sync state
      refresh();
    }
  }

  if (processes.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-1.5 bg-[var(--ml-bg-panel)] border-t border-[var(--ml-bg-bar)]">
      {processes.map((proc) => (
        <div
          key={proc.proc_id}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                     bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
          <span className="truncate max-w-[160px]" title={proc.command}>
            {proc.name}
          </span>
          <button
            onClick={() => handleKill(proc.proc_id)}
            title={`Stop ${proc.name}`}
            className="ml-0.5 text-indigo-400 hover:text-red-400 transition-colors leading-none"
            aria-label={`Stop ${proc.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
