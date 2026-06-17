import React, { useState } from "react";
import { sendWhatsappMessage } from "../api/whatsappApi";

interface WhatsappDraftCardProps {
  to: string;
  body: string;
}

export function WhatsappDraftCard({ to, body: initialBody }: WhatsappDraftCardProps) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSend() {
    setStatus("sending");
    setErrorMsg("");
    try {
      await sendWhatsappMessage(to, body.trim());
      setStatus("sent");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.response?.data?.detail ?? "Failed to send");
    }
  }

  if (status === "sent") {
    return (
      <div className="my-2 flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
        </svg>
        WhatsApp message sent to <span className="font-medium">{to}</span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-emerald-500/30 bg-[#111b18] overflow-hidden text-sm">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-500/20 bg-emerald-500/5">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 16 16">
          <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326z"/>
        </svg>
        <span className="text-emerald-300 font-medium text-xs">Draft WhatsApp</span>
        <span className="ml-auto text-[11px] text-gray-500">Review before sending</span>
      </div>

      <div className="px-4 pt-3 pb-2">
        <div className="flex gap-2 text-xs">
          <span className="text-gray-500 w-14 shrink-0 pt-0.5">To</span>
          <span className="text-gray-200 break-all">{to}</span>
        </div>
      </div>

      <div className="border-t border-[var(--ml-bg-panel)] px-4 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={status === "sending"}
          rows={4}
          className="w-full resize-y rounded-lg border border-emerald-500/20 bg-black/20 px-3 py-2 text-xs text-gray-100 outline-none focus:border-emerald-400/60 disabled:opacity-60"
        />
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--ml-bg-panel)]">
        {status === "error" && <span className="text-red-400 text-xs flex-1">{errorMsg}</span>}
        <button
          onClick={handleSend}
          disabled={status === "sending" || !body.trim()}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition"
        >
          {status === "sending" ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Sending...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z"/>
              </svg>
              Send
            </>
          )}
        </button>
      </div>
    </div>
  );
}
