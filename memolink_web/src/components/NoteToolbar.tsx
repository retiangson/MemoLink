import React from "react";

export default function NoteToolbar({ onFormat }: { onFormat: (type: string) => void }) {
  const btn = "px-2 py-1 text-xs bg-[#2A2A2A] rounded-md hover:bg-[#3a3a4a] text-gray-300 transition";
  return (
    <div className="flex gap-1.5 mb-2 flex-wrap">
      <button className={btn} onClick={() => onFormat("bold")}><b>B</b></button>
      <button className={btn} onClick={() => onFormat("italic")}><i>I</i></button>
      <button className={btn} onClick={() => onFormat("h1")}>H1</button>
      <button className={btn} onClick={() => onFormat("h2")}>H2</button>
      <button className={btn} onClick={() => onFormat("bullet")}>• List</button>
      <button className={btn} onClick={() => onFormat("number")}>1. List</button>
      <button className={btn} onClick={() => onFormat("quote")}>" Quote</button>
      <button className={btn} onClick={() => onFormat("code")}>Code</button>
      <button className={btn} onClick={() => onFormat("inlinecode")}>`Inline`</button>
      <button className={btn} onClick={() => onFormat("math")}>∑ Math</button>
      <button className={btn} onClick={() => onFormat("clear")} title="Clear">✕</button>
    </div>
  );
}
