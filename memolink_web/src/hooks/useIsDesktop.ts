import { useEffect, useState } from "react";

// Mirrors Tailwind's `sm:` breakpoint (`@media (min-width: 640px)`) so JS-driven
// panel state and CSS-driven layout/overlay classes can never disagree, and stays
// reactive to live resizes/orientation changes instead of only checking at mount.
const QUERY = "(min-width: 640px)";

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
