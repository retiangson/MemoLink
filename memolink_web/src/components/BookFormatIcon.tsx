import type { BookFormat } from "./book-readers/format";

const FORMAT_STYLES: Record<BookFormat, { bg: string; fg: string; ring: string; label: string }> = {
  pdf: { bg: "bg-red-500/15", fg: "text-red-400", ring: "ring-red-500/30", label: "PDF" },
  epub: { bg: "bg-sky-500/15", fg: "text-sky-400", ring: "ring-sky-500/30", label: "EPUB" },
  pptx: { bg: "bg-orange-500/15", fg: "text-orange-400", ring: "ring-orange-500/30", label: "PPTX" },
  audio: { bg: "bg-emerald-500/15", fg: "text-emerald-400", ring: "ring-emerald-500/30", label: "Audio" },
  video: { bg: "bg-fuchsia-500/15", fg: "text-fuchsia-400", ring: "ring-fuchsia-500/30", label: "Video" },
  txt: { bg: "bg-slate-500/15", fg: "text-slate-400", ring: "ring-slate-500/30", label: "TXT" },
  srt: { bg: "bg-violet-500/15", fg: "text-violet-400", ring: "ring-violet-500/30", label: "SRT" },
  vtt: { bg: "bg-cyan-500/15", fg: "text-cyan-400", ring: "ring-cyan-500/30", label: "VTT" },
  cbz: { bg: "bg-pink-500/15", fg: "text-pink-400", ring: "ring-pink-500/30", label: "CBZ" },
  cbr: { bg: "bg-rose-500/15", fg: "text-rose-400", ring: "ring-rose-500/30", label: "CBR" },
  mobi: { bg: "bg-teal-500/15", fg: "text-teal-400", ring: "ring-teal-500/30", label: "MOBI" },
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
    case "pptx":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="5" width="18" height="12" rx="1.3" strokeLinejoin="round" />
          <path d="M8 21h8M12 17v4" strokeLinecap="round" />
          <path d="M8.5 14V8h1.7c1 0 1.8.7 1.8 1.7s-.8 1.7-1.8 1.7H8.5" strokeLinecap="round" strokeLinejoin="round" />
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
    case "video":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" strokeLinejoin="round" />
          <path d="M10 9.5v5l4.5-2.5Z" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
    case "txt":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
          <path d="M14 3v4h4" strokeLinejoin="round" />
          <path d="M8.5 12h7M8.5 15h7M8.5 9h4" strokeLinecap="round" />
        </svg>
      );
    case "srt":
    case "vtt":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="5" width="18" height="13" rx="1.5" strokeLinejoin="round" />
          <path d="M6.5 14.5h4M6.5 11.5h7M12.5 14.5h5" strokeLinecap="round" />
        </svg>
      );
    case "cbz":
    case "cbr":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" strokeLinejoin="round" />
          <circle cx="8.5" cy="9" r="1.4" />
          <path d="M3.5 16.5l4.5-4.5a1 1 0 0 1 1.4 0L13 15.5M14.5 13l1.7-1.7a1 1 0 0 1 1.4 0l2.9 2.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "mobi":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth={1.7}>
          <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H17a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18.5Z" strokeLinejoin="round" />
          <path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H18" strokeLinecap="round" />
          <path d="M9 7h5" strokeLinecap="round" />
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
