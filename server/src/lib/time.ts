/** Time-zone helpers built on Intl so no extra runtime dependency is needed. */

export const DISPLAY_TZ = process.env.DISPLAY_TZ || "Europe/Prague";

const partCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    partCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, tz: string = DISPLAY_TZ): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** "YYYY-MM-DD" of the instant in the display zone. */
export function localDateKey(date: Date, tz: string = DISPLAY_TZ): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** ISO-8601 week key "YYYY-Www" for a calendar date key. */
export function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** First day of the week containing the date key; firstDay 1 = Monday … 7 = Sunday. */
export function weekStartOf(dateKey: string, firstDay: number = 1): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - ((dayNum - firstDay + 7) % 7));
  return date.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing the date key. */
export function isoWeekStart(dateKey: string): string {
  return weekStartOf(dateKey, 1);
}

/** Last calendar day of the month of the date key. */
export function monthEnd(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

function utcMidnight(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86400000) + 1;
}

export function isDateKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

/**
 * UTC instant range covering local calendar days [from, to] in tz. Computed by
 * probing the zone offset at local midnight (DST-safe to the minute).
 */
export function localDayRangeUtc(from: string, to: string, tz: string = DISPLAY_TZ): { startUtc: Date; endUtcExclusive: Date } {
  return { startUtc: localMidnightUtc(from, tz), endUtcExclusive: localMidnightUtc(addDays(to, 1), tz) };
}

export function localMidnightUtc(dateKey: string, tz: string = DISPLAY_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Start from the UTC midnight guess and correct by the zone offset twice
  // (second pass handles a DST transition on that day).
  let guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offsetMs = asUtc - guess.getTime();
    guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
  }
  return guess;
}

export function todayKey(tz: string = DISPLAY_TZ): string {
  return localDateKey(new Date(), tz);
}
