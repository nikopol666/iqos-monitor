export type ThemePref = "auto" | "light" | "dark";
export const THEME_COOKIE = "theme";

export function parseThemePref(value: string | undefined | null): ThemePref {
  return value === "light" || value === "dark" ? value : "auto";
}
