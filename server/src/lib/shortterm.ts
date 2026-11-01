/** Short-term usage for the overview page: today, this ISO week, last 7 days. */
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDays, isoWeekStart, localDateKey, localDayRangeUtc, todayKey, DISPLAY_TZ } from "@/lib/time";

export interface DayPoint {
  day: string;
  perSerial: Record<string, { sessions: number; puffs: number }>;
  sessions: number;
  puffs: number;
}

export interface ShortTermStats {
  today: string;
  weekStart: string;
  /** Last 7 calendar days, oldest first; ends today or yesterday (see includesToday). */
  days: DayPoint[];
  /** False (default): the 7-day window ends yesterday because today is not over yet. */
  includesToday: boolean;
  totals: {
    today: { sessions: number; puffs: number };
    yesterday: { sessions: number; puffs: number };
    week: { sessions: number; puffs: number; days: number };
    lastWeek: { sessions: number; puffs: number };
    avg7: { sessions: number; puffs: number };
    /** Derived averages: sticks per day and puffs per stick. */
    derived: {
      weekSticksPerDay: number;
      lastWeekSticksPerDay: number;
      todayPuffsPerStick: number | null;
      yesterdayPuffsPerStick: number | null;
      weekPuffsPerStick: number | null;
      lastWeekPuffsPerStick: number | null;
      avg7PuffsPerStick: number | null;
    };
  };
  perSerial: Record<string, { today: { sessions: number; puffs: number }; week: { sessions: number; puffs: number } }>;
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function shortTermStats(serials: string[], tz: string = DISPLAY_TZ, includeToday = false): ShortTermStats {
  const today = todayKey(tz);
  const weekStart = isoWeekStart(today);
  const lastWeekStart = addDays(weekStart, -7);
  const from = addDays(today, -13) < lastWeekStart ? addDays(today, -13) : lastWeekStart;
  const last7End = includeToday ? today : addDays(today, -1);
  const empty = (): ShortTermStats => ({
    today,
    weekStart,
    days: [],
    includesToday: includeToday,
    totals: {
      today: { sessions: 0, puffs: 0 },
      yesterday: { sessions: 0, puffs: 0 },
      week: { sessions: 0, puffs: 0, days: 0 },
      lastWeek: { sessions: 0, puffs: 0 },
      avg7: { sessions: 0, puffs: 0 },
      derived: { weekSticksPerDay: 0, lastWeekSticksPerDay: 0, todayPuffsPerStick: null, yesterdayPuffsPerStick: null, weekPuffsPerStick: null, lastWeekPuffsPerStick: null, avg7PuffsPerStick: null },
    },
    perSerial: {},
  });
  const result = empty();
  for (let i = 6; i >= 0; i--) {
    const day = addDays(last7End, -i);
    result.days.push({ day, perSerial: {}, sessions: 0, puffs: 0 });
  }
  for (const s of serials) result.perSerial[s] = { today: { sessions: 0, puffs: 0 }, week: { sessions: 0, puffs: 0 } };
  if (!serials.length) return result;

  const { startUtc, endUtcExclusive } = localDayRangeUtc(from, today, tz);
  const rows = getDb()
    .select({ serial: schema.events.serial, timestampUtc: schema.events.timestampUtc, puffCount: schema.events.puffCount })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.serial, serials),
        eq(schema.events.status, "ok"),
        eq(schema.events.clockSuspect, 0),
        isNotNull(schema.events.timestampUtc),
        gte(schema.events.timestampUtc, isoNoMs(startUtc)),
        lt(schema.events.timestampUtc, isoNoMs(endUtcExclusive)),
      ),
    )
    .all();

  const yesterday = addDays(today, -1);
  const byDay = new Map(result.days.map((d) => [d.day, d]));
  for (const r of rows) {
    const puffs = r.puffCount ?? 0;
    if (puffs <= 0) continue; // only sessions with decoded puffs count as sticks
    const day = localDateKey(new Date(r.timestampUtc!), tz);
    const point = byDay.get(day);
    if (point) {
      point.sessions++;
      point.puffs += puffs;
      const ps = (point.perSerial[r.serial] ??= { sessions: 0, puffs: 0 });
      ps.sessions++;
      ps.puffs += puffs;
    }
    const dev = result.perSerial[r.serial];
    if (day === today) {
      result.totals.today.sessions++;
      result.totals.today.puffs += puffs;
      if (dev) {
        dev.today.sessions++;
        dev.today.puffs += puffs;
      }
    }
    if (day === yesterday) {
      result.totals.yesterday.sessions++;
      result.totals.yesterday.puffs += puffs;
    }
    if (day >= weekStart && day <= today) {
      result.totals.week.sessions++;
      result.totals.week.puffs += puffs;
      if (dev) {
        dev.week.sessions++;
        dev.week.puffs += puffs;
      }
    } else if (day >= lastWeekStart && day < weekStart) {
      result.totals.lastWeek.sessions++;
      result.totals.lastWeek.puffs += puffs;
    }
  }
  const weekDays = Math.round((Date.parse(today) - Date.parse(weekStart)) / 86400000) + 1;
  result.totals.week.days = weekDays;
  const sum7 = result.days.reduce((a, d) => ({ sessions: a.sessions + d.sessions, puffs: a.puffs + d.puffs }), { sessions: 0, puffs: 0 });
  result.totals.avg7 = { sessions: Math.round((sum7.sessions / 7) * 10) / 10, puffs: Math.round(sum7.puffs / 7) };
  const perStick = (puffs: number, sessions: number) => (sessions ? Math.round((puffs / sessions) * 10) / 10 : null);
  const t = result.totals;
  t.derived = {
    weekSticksPerDay: Math.round((t.week.sessions / Math.max(1, weekDays)) * 10) / 10,
    lastWeekSticksPerDay: Math.round((t.lastWeek.sessions / 7) * 10) / 10,
    todayPuffsPerStick: perStick(t.today.puffs, t.today.sessions),
    yesterdayPuffsPerStick: perStick(t.yesterday.puffs, t.yesterday.sessions),
    weekPuffsPerStick: perStick(t.week.puffs, t.week.sessions),
    lastWeekPuffsPerStick: perStick(t.lastWeek.puffs, t.lastWeek.sessions),
    avg7PuffsPerStick: perStick(sum7.puffs, sum7.sessions),
  };
  return result;
}
