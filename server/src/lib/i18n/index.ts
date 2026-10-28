import { en, type Dictionary } from "./en";
import { cs } from "./cs";

export type { Dictionary };

/** Add a new language: create <code>.ts exporting a Dictionary and register it here. */
export const DICTIONARIES: Record<string, Dictionary> = { en, cs };
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "lang";
export const SUPPORTED_LOCALES = Object.keys(DICTIONARIES);

export function hasLocale(code: string | undefined | null): code is keyof typeof DICTIONARIES {
  return !!code && code in DICTIONARIES;
}

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q.slice(2)) : 1, i };
    })
    .filter((x) => x.tag && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (hasLocale(tag)) return tag;
    if (hasLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** Cookie override first, then browser preference, then English. */
export function resolveLocale(cookieValue: string | undefined | null, acceptLanguage: string | null | undefined): string {
  if (hasLocale(cookieValue)) return cookieValue;
  return negotiateLocale(acceptLanguage);
}

export function getDictionary(locale: string): Dictionary {
  return DICTIONARIES[locale] ?? en;
}

/** Tiny "{name}" interpolation. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
