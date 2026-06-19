import React, { useState } from "react";
import { sendNewMail, type EmailAccount } from "../api/emailApi";

interface EmailComposePanelProps {
  accounts: EmailAccount[];
}

export function EmailComposePanel({ accounts }: EmailComposePanelProps) {
  const [fromAccountId, setFromAccountId] = useState<number | undefined>(accounts[0]?.id);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSend() {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    setResult(null);
    try {
      await sendNewMail({ to: to.trim(), subject: subject.trim(), body: body.trim(), emailAccountId: fromAccountId });
      setResult({ ok: true, msg: `✓ Sent to ${to.trim()}` });
      setTo("");
      setSubject("");
      setBody("");
    } catch (err: any) {
      setResult({ ok: false, msg: err?.response?.data?.detail || "Failed to send email." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-1 py-1.5">
      {accounts.length > 1 && (
        <select
          value={fromAccountId ?? ""}
          onChange={(e) => setFromAccountId(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full bg-[#0e0e16] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-[11px] text-gray-300 outline-none focus:border-indigo-500 transition"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      )}

      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="To"
        className="w-full bg-[#0e0e16] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-[11px] text-gray-200 placeholder-gray-700 outline-none focus:border-indigo-500 transition"
      />
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full bg-[#0e0e16] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-1.5 text-[11px] text-gray-200 placeholder-gray-700 outline-none focus:border-indigo-500 transition"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        placeholder="Write your email…"
        className="w-full bg-[#0e0e16] border border-[var(--ml-bg-hover)] rounded-lg px-2.5 py-2 text-[11px] text-gray-200 placeholder-gray-700 outline-none focus:border-indigo-500 transition resize-none leading-relaxed"
      />

      {result && (
        <p className={`text-[11px] px-2.5 py-1.5 rounded-lg ${result.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
          {result.msg}
        </p>
      )}

      <button
        onClick={handleSend}
        disabled={!to.trim() || !body.trim() || sending}
        className="flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition"
      >
        {sending ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
            <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471z"/>
          </svg>
        )}
        {sending ? "Sending…" : "Send"}
      </button>
    </div>
  );
}
