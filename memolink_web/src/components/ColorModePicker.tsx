import { READER_COLOR_MODES, READER_COLOR_MODE_LABELS, type ReaderColorMode } from "./book-readers/format";

const SWATCH_COLOR: Record<ReaderColorMode, string> = {
  dark: "#15151c",
  light: "#f8fafc",
  sepia: "#efe4cf",
};

interface Props {
  value: ReaderColorMode;
  onChange: (mode: ReaderColorMode) => void;
  className?: string;
}

// Color swatches instead of text labels — shared by Books, Email, and Note views,
// always positioned top-right of the view's header/toolbar.
export function ColorModePicker({ value, onChange, className = "" }: Props) {
  return (
    <div className={`flex items-center gap-1.5 shrink-0 ${className}`} role="group" aria-label="Reading color">
      {READER_COLOR_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={READER_COLOR_MODE_LABELS[mode]}
          aria-label={READER_COLOR_MODE_LABELS[mode]}
          aria-pressed={value === mode}
          className={`w-6 h-6 rounded-full border-2 transition shrink-0 ${
            value === mode
              ? "border-indigo-500 scale-110"
              : "border-[var(--ml-bg-hover)] hover:border-gray-500"
          }`}
          style={{ backgroundColor: SWATCH_COLOR[mode] }}
        />
      ))}
    </div>
  );
}
