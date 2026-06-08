import React from "react";

interface DeleteModalProps {
  show: boolean;
  onSaveAndDelete: () => void;
  onDeleteOnly: () => void;
  onCancel: () => void;
}

export function DeleteModal({ show, onSaveAndDelete, onDeleteOnly, onCancel }: DeleteModalProps) {
  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "linear-gradient(145deg, #1a1a2e 0%, #16162a 100%)" }}
      >
        {/* Top accent line */}
        <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent, #6366f1, transparent)" }} />

        <div className="p-6">
          {/* Icon */}
          <div className="flex items-center justify-center w-12 h-12 rounded-xl mb-4 mx-auto"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#f87171" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>

          {/* Text */}
          <h3 className="text-base font-semibold text-white text-center mb-1">Delete Message</h3>
          <p className="text-sm text-center mb-6" style={{ color: "rgba(255,255,255,0.45)" }}>
            Would you like to save this message to your notes before deleting?
          </p>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={onSaveAndDelete}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
              style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1)", color: "#fff", boxShadow: "0 2px 12px rgba(99,102,241,0.3)" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Save to Notes & Delete
            </button>

            <button
              onClick={onDeleteOnly}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.22)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.45)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)"; }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Only
            </button>

            <button
              onClick={onCancel}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
