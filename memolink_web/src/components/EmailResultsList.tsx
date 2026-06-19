import React from "react";
import type { BrowseEmailResult } from "../api/emailApi";

interface EmailResultsListProps {
  results: BrowseEmailResult[];
  onOpen: (email: BrowseEmailResult) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function EmailResultsList({ results, onOpen }: EmailResultsListProps) {
  if (!results.length) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {results.map((email, idx) => (
        <button
          key={`${email.gmail_message_id ?? email.id ?? idx}`}
          onClick={() => onOpen(email)}
          className="flex items-start gap-3 px-3.5 py-2.5 rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] text-left hover:border-indigo-500/30 hover:bg-indigo-500/5 transition group"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mt-0.5 text-gray-500 group-hover:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-100 truncate group-hover:text-indigo-300">
                {email.subject || "(no subject)"}
              </p>
              {email.email_date && (
                <span className="text-[11px] text-gray-600 shrink-0">{formatDate(email.email_date)}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {email.sender_name ? `${email.sender_name} <${email.sender_email}>` : email.sender_email}
            </p>
            {email.snippet && (
              <p className="text-xs text-gray-600 truncate mt-0.5">{email.snippet}</p>
            )}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 mt-1 text-gray-600 group-hover:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ))}
    </div>
  );
}
