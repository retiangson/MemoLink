const PALETTE = [
  { bg: "bg-indigo-500/15", border: "border-indigo-500/30", text: "text-indigo-300" },
  { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-300" },
  { bg: "bg-amber-500/15", border: "border-amber-500/30", text: "text-amber-300" },
  { bg: "bg-rose-500/15", border: "border-rose-500/30", text: "text-rose-300" },
  { bg: "bg-sky-500/15", border: "border-sky-500/30", text: "text-sky-300" },
  { bg: "bg-violet-500/15", border: "border-violet-500/30", text: "text-violet-300" },
  { bg: "bg-teal-500/15", border: "border-teal-500/30", text: "text-teal-300" },
];

export function initialsFor(name: string): string {
  const clean = (name || "?").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

export function avatarColorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
