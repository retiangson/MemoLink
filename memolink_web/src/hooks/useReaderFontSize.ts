import { useEffect, useState } from "react";
import { isReaderFontSize, type ReaderFontSize } from "../components/book-readers/format";

const STORAGE_KEY = "memolink_reader_font_size";
const CHANGE_EVENT = "memolink-reader-font-size-change";

function readStored(): ReaderFontSize {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isReaderFontSize(saved) ? saved : "md";
}

// Shared across Books and Note views, same cross-tab sync pattern as useReaderColorMode.
export function useReaderFontSize() {
  const [size, setSize] = useState<ReaderFontSize>(readStored);

  useEffect(() => {
    function sync() {
      setSize(readStored());
    }
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function setFontSize(next: ReaderFontSize) {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [size, setFontSize] as const;
}
