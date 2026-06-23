export interface HighlightColorDef {
  id: string;
  label: string;
  swatch: string;
  mark: string;
}

// `mark` is the translucent overlay color used to paint highlighted text (DOM background,
// PDF text-div background, EPUB ::highlight() background). `swatch` is the opaque dot shown
// in the color picker UI.
export const HIGHLIGHT_COLORS: HighlightColorDef[] = [
  { id: "yellow", label: "Yellow", swatch: "#eab308", mark: "rgba(234,179,8,0.45)" },
  { id: "green", label: "Green", swatch: "#22c55e", mark: "rgba(34,197,94,0.4)" },
  { id: "blue", label: "Blue", swatch: "#3b82f6", mark: "rgba(59,130,246,0.4)" },
  { id: "pink", label: "Pink", swatch: "#ec4899", mark: "rgba(236,72,153,0.4)" },
  { id: "orange", label: "Orange", swatch: "#f97316", mark: "rgba(249,115,22,0.45)" },
  { id: "purple", label: "Purple", swatch: "#a855f7", mark: "rgba(168,85,247,0.4)" },
  { id: "red", label: "Red", swatch: "#ef4444", mark: "rgba(239,68,68,0.4)" },
  { id: "teal", label: "Teal", swatch: "#14b8a6", mark: "rgba(20,184,166,0.4)" },
];

const DEFAULT_COLOR_ID = "yellow";

export function isHighlightColorId(value: string | null | undefined): value is string {
  return !!value && HIGHLIGHT_COLORS.some((c) => c.id === value);
}

export function highlightColorMark(colorId: string | null | undefined): string {
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId)?.mark ?? HIGHLIGHT_COLORS[0].mark;
}

export function highlightColorSwatch(colorId: string | null | undefined): string {
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId)?.swatch ?? HIGHLIGHT_COLORS[0].swatch;
}

export { DEFAULT_COLOR_ID };
