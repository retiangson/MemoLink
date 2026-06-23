import { useEffect, useState } from "react";
import { isReaderColorMode, type ReaderColorMode } from "../components/book-readers/format";

const STORAGE_KEY = "memolink_reader_color_mode";
const CHANGE_EVENT = "memolink-reader-color-mode-change";

function readStored(): ReaderColorMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isReaderColorMode(saved) ? saved : "dark";
}

// Shared across Books, Email, and Note views: writing here notifies every other
// mounted instance immediately (storage events alone don't fire within the same tab).
export function useReaderColorMode() {
  const [mode, setMode] = useState<ReaderColorMode>(readStored);

  useEffect(() => {
    function sync() {
      setMode(readStored());
    }
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function setColorMode(next: ReaderColorMode) {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [mode, setColorMode] as const;
}
