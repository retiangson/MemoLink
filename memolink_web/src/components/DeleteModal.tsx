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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#1e1e2a] border border-[#2a2a38] p-6 rounded-2xl w-80 shadow-2xl text-white">
        <h3 className="font-semibold mb-1">Delete Message</h3>
        <p className="text-sm text-gray-400 mb-5">What would you like to do with this message?</p>
        <div className="space-y-2">
          <button onClick={onSaveAndDelete} className="w-full bg-indigo-600 hover:bg-indigo-500 py-2.5 rounded-xl text-sm transition">
            📒 Save to Notes & Delete
          </button>
          <button onClick={onDeleteOnly} className="w-full bg-red-600/80 hover:bg-red-600 py-2.5 rounded-xl text-sm transition">
            🗑 Delete Only
          </button>
          <button onClick={onCancel} className="w-full bg-[#2a2a38] hover:bg-[#333345] py-2.5 rounded-xl text-sm transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
