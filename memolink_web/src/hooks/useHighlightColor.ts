import { useEffect, useState } from "react";
import { isHighlightColorId, DEFAULT_COLOR_ID } from "../components/book-readers/highlightColors";

const STORAGE_KEY = "memolink_highlight_color";
const CHANGE_EVENT = "memolink-highlight-color-change";

function readStored(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isHighlightColorId(saved) ? saved : DEFAULT_COLOR_ID;
}

// Mirrors useReaderColorMode.ts: shared across every reader, so picking a color in one
// book reader persists for the next highlight in any reader/tab.
export function useHighlightColor() {
  const [color, setColorState] = useState<string>(readStored);

  useEffect(() => {
    function sync() {
      setColorState(readStored());
    }
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function setColor(next: string) {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return [color, setColor] as const;
}
