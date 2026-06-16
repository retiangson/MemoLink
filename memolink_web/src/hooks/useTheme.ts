import { useEffect, useState } from "react";

export type Theme = "dark" | "midnight" | "light" | "solarized" | "violet";

export const THEMES: Theme[] = ["dark", "midnight", "light", "solarized", "violet"];

const STORAGE_KEY = "memolink_theme";

function initTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  const t = saved && (THEMES as string[]).includes(saved) ? saved : "dark";
  document.documentElement.setAttribute("data-theme", t);
  return t;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(initTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  return { theme, setTheme };
}

export const THEME_META: Record<Theme, { label: string; swatch: string }> = {
  dark:      { label: "Dark",      swatch: "#0f0f13" },
  midnight:  { label: "Midnight",  swatch: "#07091a" },
  light:     { label: "Light",     swatch: "#f1f5f9" },
  solarized: { label: "Solarized", swatch: "#002b36" },
  violet:    { label: "Violet",    swatch: "#120d22" },
};
