import { useEffect, useRef, useState } from "react";
import { getBudget, sendHeartbeat, sendHeartbeatBeacon } from "../api/evaluationApi";

// Foreground-usage tracking for the per-user evaluation collection window.
// Time accrues whenever the app tab is visible and the user is logged in;
// switching tabs or logging out / closing pauses it. Returns live status so the
// UI can show a countdown and hide evaluation features once the window ends.
const TICK_MS = 1000;
const SEND_EVERY_MS = 20000;    // flush accumulated usage seconds every 20s

export interface EvalStatus {
  enabled: boolean;
  loaded: boolean;
  consumedSeconds: number;
  budgetSeconds: number;
  remainingSeconds: number;
  exhausted: boolean;
}

export function useEvaluationHeartbeat(enabled: boolean): EvalStatus {
  const unsent = useRef(0);            // usage seconds not yet sent
  const serverConsumed = useRef(0);    // last server-confirmed consumed seconds
  const budget = useRef(0);
  const exhaustedRef = useRef(false);
  const [status, setStatus] = useState<EvalStatus>({
    enabled, loaded: false, consumedSeconds: 0, budgetSeconds: 0, remainingSeconds: 0, exhausted: false,
  });

  useEffect(() => {
    if (!enabled) {
      setStatus({ enabled: false, loaded: false, consumedSeconds: 0, budgetSeconds: 0, remainingSeconds: 0, exhausted: false });
      return;
    }
    let stopped = false;

    function publish() {
      const consumed = serverConsumed.current + unsent.current;
      const remaining = Math.max(0, budget.current - consumed);
      const exhausted = budget.current > 0 && remaining <= 0;
      exhaustedRef.current = exhausted;
      setStatus({ enabled: true, loaded: budget.current > 0, consumedSeconds: consumed, budgetSeconds: budget.current, remainingSeconds: remaining, exhausted });
    }

    getBudget().then(b => {
      budget.current = b.budget_seconds;
      serverConsumed.current = b.consumed_seconds;
      if (b.exhausted) exhaustedRef.current = true;
      publish();
    }).catch(() => {});

    const tick = window.setInterval(() => {
      if (stopped || exhaustedRef.current) return;
      if (document.visibilityState !== "hidden") {
        unsent.current += 1;
        publish();
      }
    }, TICK_MS);

    async function flush() {
      if (stopped || exhaustedRef.current) return;
      const delta = unsent.current;
      if (delta <= 0) return;
      unsent.current = 0;
      try {
        const b = await sendHeartbeat(delta);
        budget.current = b.budget_seconds;
        serverConsumed.current = b.consumed_seconds;
        if (b.exhausted) exhaustedRef.current = true;
        publish();
      } catch {
        unsent.current += delta;   // re-queue on failure
      }
    }
    const send = window.setInterval(flush, SEND_EVERY_MS);

    const onHide = () => {
      const delta = unsent.current;
      if (delta > 0 && !exhaustedRef.current) {
        unsent.current = 0;
        sendHeartbeatBeacon(delta);
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);

    return () => {
      stopped = true;
      window.clearInterval(tick);
      window.clearInterval(send);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      onHide();   // flush remaining usage time on unmount (e.g. logout)
    };
  }, [enabled]);

  return status;
}
