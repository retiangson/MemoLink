import { useEffect, useState } from "react";

export const DESKTOP_LAYOUT_MIN_WIDTH = 1024;

// Tablet widths should behave like mobile: one active content pane, overlay
// side panels, and no split layout. Width alone is not enough because iPad Pro
// can report a laptop-sized viewport in landscape, so desktop mode also requires
// a fine pointer with hover support.
const QUERY = `(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px) and (hover: hover) and (pointer: fine)`;

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
