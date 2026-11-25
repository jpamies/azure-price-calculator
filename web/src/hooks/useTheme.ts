import { useLayoutEffect } from "react";
import { useMediaQuery } from "@/data/hooks";
import type { Settings } from "@/domain/model";

export type ThemeSetting = Settings["theme"];
export type ResolvedTheme = "light" | "dark";

/** The effective theme: the setting, or the OS preference for "system" (kept in sync). */
export function useResolvedTheme(theme: ThemeSetting): ResolvedTheme {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

/** Applies the theme as the `dark` class on <html> (index.html does the same before first paint). */
export function useApplyTheme(theme: ThemeSetting): ResolvedTheme {
  const resolved = useResolvedTheme(theme);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);
  return resolved;
}
