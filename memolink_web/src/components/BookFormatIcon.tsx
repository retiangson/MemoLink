import type { BookFormat } from "./book-readers/format";

const FORMAT_STYLES: Record<BookFormat, { bg: string; fg: string; ring: string; label: string }> = {
  pdf: { bg: "bg-red-500/15", fg: "text-red-400", ring: "ring-red-500/30", label: "PDF" },
  epub: { bg: "bg-sky-500/15", fg: "text-sky-400", ring: "ring-sky-500/30", label: "EPUB" },
  audio: { bg: "bg-emerald-500/15", fg: "text-emerald-400", ring: "ring-emerald-500/30", label: "Audio" },
  unsupported: { bg: "bg-gray-500/15", fg: "text-gray-400", ring: "ring-gray-500/30", label: "File" },
};

export function getFormatStyle(format: BookFormat) {
  return FORMAT_STYLES[format];
}

export function BookFormatIcon({ format, className = "w-4 h-4" }: { format: BookFormat; className?: string }) {
  switch (format) {
    case "pdf":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M14 3v4h4" strokeLinejoin="round" />
          <path d="M9 13.5h1.4M9 13.5v3M9 13.5a1 1 0 1 1 0 2H9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 13.5h1.2c.6 0 1 .4 1 1v1c0 .6-.4 1-1 1H13z" strokeLinejoin="round" />
        </svg>
      );
    case "epub":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M3 5.6c1.5-1 3.5-1.4 5.4-1.1 1 .15 1.9.5 2.6 1v13c-.7-.5-1.6-.85-2.6-1-1.9-.3-3.9.1-5.4 1.1Z" strokeLinejoin="round" />
          <path d="M21 5.6c-1.5-1-3.5-1.4-5.4-1.1-1 .15-1.9.5-2.6 1v13c.7-.5 1.6-.85 2.6-1 1.9-.3 3.9.1 5.4 1.1Z" strokeLinejoin="round" />
        </svg>
      );
    case "audio":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M4 14.5v-3a8 8 0 0 1 16 0v3" strokeLinecap="round" />
          <path d="M4 14a2 2 0 0 1 2-2h0.8a.9.9 0 0 1 .9.9v3.6a.9.9 0 0 1-.9.9H6a2 2 0 0 1-2-2z" strokeLinejoin="round" />
          <path d="M20 14a2 2 0 0 0-2-2h-0.8a.9.9 0 0 0-.9.9v3.6a.9.9 0 0 0 .9.9H18a2 2 0 0 0 2-2z" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M9 12h6M9 15h6M9 9h3" strokeLinecap="round" />
        </svg>
      );
  }
}

export function BookFormatBadge({ format, className = "" }: { format: BookFormat; className?: string }) {
  const s = FORMAT_STYLES[format];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md ${s.bg} ${s.fg} text-[9px] font-bold uppercase tracking-wide ${className}`}>
      <BookFormatIcon format={format} className="w-3 h-3" />
      {s.label}
    </span>
  );
}
