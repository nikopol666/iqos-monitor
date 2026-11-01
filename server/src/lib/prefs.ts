/** Viewer preferences kept in cookies (like the language override). */
export const WEEK_START_COOKIE = "week_start";

/** 1 = Monday … 7 = Sunday (ISO numbering). */
export type WeekStart = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const INTL_LOCALE: Record<string, string> = { cs: "cs-CZ", en: "en-GB" };

/** The language's own convention (Intl week info when the runtime has it), Monday otherwise. */
export function defaultWeekStart(locale: string): WeekStart {
  try {
    const l = new Intl.Locale(INTL_LOCALE[locale] ?? locale) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = typeof l.getWeekInfo === "function" ? l.getWeekInfo() : l.weekInfo;
    if (info && Number.isInteger(info.firstDay) && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay as WeekStart;
  } catch {
    /* no week info */
  }
  return 1;
}

export function isWeekStart(n: unknown): n is WeekStart {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7;
}

export function resolveWeekStart(cookieValue: string | undefined | null, locale: string): WeekStart {
  const n = cookieValue == null ? NaN : Number(cookieValue);
  return isWeekStart(n) ? n : defaultWeekStart(locale);
}
