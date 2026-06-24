import { READER_FONT_SIZES, READER_FONT_SIZE_LABELS, nextReaderFontSize, type ReaderFontSize } from "./book-readers/format";

interface Props {
  value: ReaderFontSize;
  onChange: (size: ReaderFontSize) => void;
  className?: string;
}

// "A-" / "A+" stepper instead of a 4-way picker — shared by Books and Note views,
// always positioned just left of the ColorModePicker in the view's header/toolbar.
export function FontSizePicker({ value, onChange, className = "" }: Props) {
  const atMin = value === READER_FONT_SIZES[0];
  const atMax = value === READER_FONT_SIZES[READER_FONT_SIZES.length - 1];

  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`} role="group" aria-label="Text size">
      <button
        type="button"
        onClick={() => onChange(nextReaderFontSize(value, -1))}
        disabled={atMin}
        title={`Decrease text size (${READER_FONT_SIZE_LABELS[value]})`}
        aria-label="Decrease text size"
        className="w-6 h-6 flex items-center justify-center rounded-md text-[10px] font-semibold leading-none text-gray-400 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
      >
        A
      </button>
      <button
        type="button"
        onClick={() => onChange(nextReaderFontSize(value, 1))}
        disabled={atMax}
        title={`Increase text size (${READER_FONT_SIZE_LABELS[value]})`}
        aria-label="Increase text size"
        className="w-6 h-6 flex items-center justify-center rounded-md text-base font-semibold leading-none text-gray-200 border border-[var(--ml-bg-hover)] hover:bg-[var(--ml-bg-hover)] transition disabled:opacity-30"
      >
        A
      </button>
    </div>
  );
}
