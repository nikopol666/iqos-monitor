import { addDays, daysBetweenInclusive, isoWeekKey, isoWeekStart, localParts, monthKey, DISPLAY_TZ } from "./time";

import { puffSpan } from "./protocol/history";

export type GroupBy = "day" | "week" | "month";

export interface StatRow {
  serial: string;
  timestampUtc: string;
  puffCount: number | null;
  clockSuspect: number;
  /** JSON array of puff pairs (hex), when available. */
  puffPairsJson?: string | null;
}

export interface Bucket {
  key: string;
  /** First calendar day of the bucket (YYYY-MM-DD). */
  start: string;
  /** Last calendar day of the bucket inside the range. */
  end: string;
  days: number;
  records: number;
  sessions: number;
  puffs: number;
  suspect: number;
  /** Average seconds from session start to the last puff (sessions with pair data). */
  avgLastPuffS: number | null;
  perSerial: Record<string, { records: number; sessions: number; puffs: number }>;
}

export interface StatTotals {
  records: number;
  sessions: number;
  puffs: number;
  suspect: number;
  daysInRange: number;
  daysWithData: number;
  avgRecordsPerDay: number;
  avgSessionsPerDay: number;
  avgPuffsPerDay: number;
  avgRecordsPerActiveDay: number;
  avgSessionsPerActiveDay: number;
  avgPuffsPerActiveDay: number;
  avgPuffsPerSession: number | null;
  /** Average seconds from session start to the last puff, and to the first puff. */
  avgLastPuffS: number | null;
  avgFirstPuffS: number | null;
}

export interface StatsResult {
  groupBy: GroupBy;
  from: string;
  to: string;
  tz: string;
  buckets: Bucket[];
  totals: StatTotals;
  /** Sessions (records with puffs) by local hour of day, 0–23. */
  byHour: number[];
  /** Sessions by local weekday, Monday first. */
  byWeekday: number[];
}

function bucketKeyFor(dateKey: string, groupBy: GroupBy): string {
  if (groupBy === "day") return dateKey;
  if (groupBy === "week") return isoWeekKey(dateKey);
  return monthKey(dateKey);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregates archive records into calendar buckets of the display zone.
 * Every bucket in [from, to] is present even when empty, so charts stay
 * continuous. "records" = timestamped archive entries, "sessions" = records
 * with at least one decoded puff event, "puffs" = sum of decoded puff counts.
 */
export function computeStats(rows: StatRow[], from: string, to: string, groupBy: GroupBy, tz: string = DISPLAY_TZ): StatsResult {
  const buckets = new Map<string, Bucket>();
  // Pre-create buckets for the whole range.
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = bucketKeyFor(day, groupBy);
    let b = buckets.get(key);
    if (!b) {
      const start = groupBy === "week" ? isoWeekStart(day) : groupBy === "month" ? day.slice(0, 7) + "-01" : day;
      b = { key, start: start < from ? from : start, end: day, days: 0, records: 0, sessions: 0, puffs: 0, suspect: 0, avgLastPuffS: null, perSerial: {} };
      buckets.set(key, b);
    }
    b.end = day;
    b.days++;
  }
  const activeDays = new Set<string>();
  const spanSum = new Map<string, { last: number; n: number }>();
  let lastSum = 0;
  let firstSum = 0;
  let spanN = 0;
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  let records = 0;
  let sessions = 0;
  let puffs = 0;
  let suspect = 0;
  for (const row of rows) {
    const when = new Date(row.timestampUtc);
    const parts = localParts(when, tz);
    const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    if (day < from || day > to) continue;
    if ((row.puffCount ?? 0) > 0) {
      byHour[parts.hour]++;
      byWeekday[(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7]++;
    }
    const b = buckets.get(bucketKeyFor(day, groupBy));
    if (!b) continue;
    activeDays.add(day);
    const isSession = (row.puffCount ?? 0) > 0;
    const p = row.puffCount ?? 0;
    b.records++;
    records++;
    if (isSession) {
      b.sessions++;
      sessions++;
    }
    b.puffs += p;
    puffs += p;
    if (row.clockSuspect) {
      b.suspect++;
      suspect++;
    }
    const ps = (b.perSerial[row.serial] ??= { records: 0, sessions: 0, puffs: 0 });
    ps.records++;
    if (isSession) ps.sessions++;
    ps.puffs += p;
    if (isSession && row.puffPairsJson) {
      let span: { first: number; last: number } | null = null;
      try {
        span = puffSpan(JSON.parse(row.puffPairsJson) as string[]);
      } catch {
        span = null;
      }
      if (span) {
        const acc = spanSum.get(b.key) ?? { last: 0, n: 0 };
        acc.last += span.last;
        acc.n++;
        spanSum.set(b.key, acc);
        lastSum += span.last;
        firstSum += span.first;
        spanN++;
      }
    }
  }
  for (const [key, acc] of spanSum) {
    const b = buckets.get(key);
    if (b) b.avgLastPuffS = acc.n ? Math.round(acc.last / acc.n) : null;
  }
  const daysInRange = daysBetweenInclusive(from, to);
  const daysWithData = activeDays.size;
  const totals: StatTotals = {
    records,
    sessions,
    puffs,
    suspect,
    daysInRange,
    daysWithData,
    avgRecordsPerDay: round2(records / daysInRange),
    avgSessionsPerDay: round2(sessions / daysInRange),
    avgPuffsPerDay: round2(puffs / daysInRange),
    avgRecordsPerActiveDay: daysWithData ? round2(records / daysWithData) : 0,
    avgSessionsPerActiveDay: daysWithData ? round2(sessions / daysWithData) : 0,
    avgPuffsPerActiveDay: daysWithData ? round2(puffs / daysWithData) : 0,
    avgPuffsPerSession: sessions ? round2(puffs / sessions) : null,
    avgLastPuffS: spanN ? Math.round(lastSum / spanN) : null,
    avgFirstPuffS: spanN ? Math.round(firstSum / spanN) : null,
  };
  return { groupBy, from, to, tz, buckets: [...buckets.values()], totals, byHour, byWeekday };
}
