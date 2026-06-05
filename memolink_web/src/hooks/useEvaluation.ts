import { useState, useEffect } from "react";

const LS = "memolink_eval_session";

export interface EvalSession {
  session_id: number;
  participant_code: string;
}

function read(): EvalSession | null {
  try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; }
}

/** Tracks the active evaluation session across the app via localStorage. */
export function useEvaluation() {
  const [session, setSession] = useState<EvalSession | null>(read);

  useEffect(() => {
    const handler = () => setSession(read());
    window.addEventListener("memolink_eval_changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("memolink_eval_changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  function start(s: EvalSession) {
    localStorage.setItem(LS, JSON.stringify(s));
    setSession(s);
    window.dispatchEvent(new Event("memolink_eval_changed"));
  }

  function clear() {
    localStorage.removeItem(LS);
    setSession(null);
    window.dispatchEvent(new Event("memolink_eval_changed"));
  }

  return { session, start, clear };
}
