/** Read-side queries used by pages and the web API. */
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { isLiveConnected, openFullHistoryJob } from "@/lib/ingest";
import { puffSpan } from "@/lib/protocol/history";
import { computeStats, type GroupBy, type StatRow, type StatsResult, type StatTotals } from "@/lib/stats";
import { localDayRangeUtc, todayKey, DISPLAY_TZ, addDays, daysBetweenInclusive } from "@/lib/time";
import { deviceLabel } from "@/lib/variants";

export interface DeviceOverview {
  serial: string;
  name: string;
  color: string;
  variant: string;
  model: string | null;
  user: { id: number; name: string; color: string } | null;
  connected: boolean;
  live: schema.LiveState | null;
  lastSeenUtc: string | null;
  today: { records: number; sessions: number; puffs: number };
  job: { id: number; type: string; status: string; done: number; total: number | null; message: string | null } | null;
  /** Archive transfer in progress (agent live status or running job). */
  sync: { mode: "recent" | "full"; done: number; total: number | null } | null;
  lifetime: { sticks: number | null; puffs: number | null; seconds: number | null; battery: number | null };
  /** Candidates from live state / snapshot: charging flag, LED brightness level. */
  charging: boolean | null;
  brightness: number | null;
  clockWarning: boolean;
  fullHistoryComplete: boolean;
  ackedNextIndex: number | null;
  lowestStoredIndex: number | null;
}

export function listUsers(): schema.User[] {
  return getDb().select().from(schema.users).orderBy(schema.users.name).all();
}

export function listDevices(): schema.Device[] {
  return getDb().select().from(schema.devices).orderBy(schema.devices.name, schema.devices.serial).all();
}

/** Devices with `name` resolved to the display label (model · finish when unnamed). */
export function listDevicesLabeled(): (schema.Device & { rawName: string })[] {
  const all = listDevices();
  return all.map((d) => ({ ...d, rawName: d.name, name: deviceLabel(d.name, d.variant, d.serial, all) }));
}

export function getDevice(serial: string): schema.Device | undefined {
  return getDb().select().from(schema.devices).where(eq(schema.devices.serial, serial)).get();
}

export function latestSnapshot(serial: string): schema.Snapshot | undefined {
  return getDb().select().from(schema.snapshots).where(eq(schema.snapshots.serial, serial)).orderBy(desc(schema.snapshots.id)).limit(1).get();
}

function todayCounts(serial: string): { records: number; sessions: number; puffs: number } {
  const today = todayKey();
  const { startUtc, endUtcExclusive } = localDayRangeUtc(today, today);
  const row = getSqlite()
    .prepare(
      `SELECT count(*) AS records, sum(CASE WHEN puff_count > 0 THEN 1 ELSE 0 END) AS sessions, sum(coalesce(puff_count,0)) AS puffs
       FROM events WHERE serial = ? AND status = 'ok' AND timestamp_utc >= ? AND timestamp_utc < ?`,
    )
    .get(serial, startUtc.toISOString().replace(/\.\d{3}Z$/, "+00:00"), endUtcExclusive.toISOString().replace(/\.\d{3}Z$/, "+00:00")) as {
    records: number;
    sessions: number | null;
    puffs: number | null;
  };
  return { records: row.records, sessions: row.sessions ?? 0, puffs: row.puffs ?? 0 };
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function deviceOverview(device: schema.Device, siblings: schema.Device[] = listDevices()): DeviceOverview {
  const db = getDb();
  const live = db.select().from(schema.liveState).where(eq(schema.liveState.serial, device.serial)).get() ?? null;
  const user = device.userId ? (db.select().from(schema.users).where(eq(schema.users.id, device.userId)).get() ?? null) : null;
  const snap = latestSnapshot(device.serial);
  const values = snap ? (JSON.parse(snap.valuesJson) as Record<string, number | boolean | null>) : {};
  const connected = isLiveConnected(live);
  const job = openFullHistoryJob(device.serial);
  const extra = (live?.extraJson ? JSON.parse(live.extraJson) : {}) as { charging?: boolean | null; brightness_level?: number | null };
  let sync: DeviceOverview["sync"] = null;
  if (connected) {
    if (job && job.status === "running") sync = { mode: "full", done: job.progressDone, total: job.progressTotal };
    else if (live?.syncStatus) {
      const m = /^(recent|full)\s+(\d+)(?:\/(\d+))?/.exec(live.syncStatus);
      if (m) sync = { mode: m[1] as "recent" | "full", done: Number(m[2]), total: m[3] ? Number(m[3]) : null };
    }
  }
  return {
    serial: device.serial,
    name: deviceLabel(device.name, device.variant, device.serial, siblings),
    color: device.color,
    variant: device.variant,
    model: device.model,
    user: user ? { id: user.id, name: user.name, color: user.color } : null,
    connected,
    live,
    lastSeenUtc: device.lastSeenUtc,
    today: todayCounts(device.serial),
    job: job && (job.status === "queued" || job.status === "running") ? { id: job.id, type: job.type, status: job.status, done: job.progressDone, total: job.progressTotal, message: job.message } : null,
    sync,
    lifetime: {
      sticks: connected && live?.lifetimeSticks != null ? live.lifetimeSticks : (num(values.lifetime_sticks_candidate) ?? live?.lifetimeSticks ?? null),
      puffs: connected && live?.lifetimePuffs != null ? live.lifetimePuffs : (num(values.lifetime_puffs_candidate) ?? live?.lifetimePuffs ?? null),
      seconds: usageSeconds(connected && live?.lifetimeSeconds != null ? live.lifetimeSeconds : (num(values.lifetime_seconds_candidate) ?? live?.lifetimeSeconds ?? null)),
      // Battery, charging and brightness can change while the device is away: shown only while connected.
      battery: connected ? (live?.battery ?? null) : null,
    },
    charging: connected ? (extra.charging ?? null) : null,
    brightness: connected ? (extra.brightness_level ?? null) : null,
    clockWarning: !!device.clockWarning,
    fullHistoryComplete: !!device.fullHistoryComplete,
    ackedNextIndex: device.ackedNextIndex,
    lowestStoredIndex: device.lowestStoredIndex,
  };
}

/**
 * The device's usage counter ticks about 2.35 times per second of a session:
 * per session 2.3–2.5 (last-session register), over a whole archive 2.34
 * (1 188 records' durations summed against the counter), not 4 as iqos-bar
 * assumes. The agent reports ticks / 4; undo that and apply the measured
 * rate. See PROTOCOL.md, "Korelace kandidátů".
 */
export const USAGE_TICKS_PER_SECOND = 2.35;
export function usageSeconds(agentSeconds: number | null): number | null {
  return agentSeconds == null ? null : Math.round((agentSeconds * 4) / USAGE_TICKS_PER_SECOND);
}

/**
 * Average session length from the device's usage counter: between two
 * connections the counter grew by X ticks while N sticks were smoked, so a
 * stick lasted X / 2.5 / N seconds on average. Only connection pairs whose
 * later reading falls inside [from, to] count. Returns null without data.
 */
export function avgSessionSeconds(serials: string[], from: string, to: string): { seconds: number | null; sticks: number; intervals: number } {
  if (!serials.length) return { seconds: null, sticks: 0, intervals: 0 };
  const { startUtc, endUtcExclusive } = localDayRangeUtc(from, to);
  const rows = getDb()
    .select({ serial: schema.snapshots.serial, collectedUtc: schema.snapshots.collectedUtc, valuesJson: schema.snapshots.valuesJson })
    .from(schema.snapshots)
    .where(inArray(schema.snapshots.serial, serials))
    .orderBy(schema.snapshots.serial, schema.snapshots.id)
    .all();
  let ticks = 0;
  let sticks = 0;
  let intervals = 0;
  let prev: { serial: string; sticks: number; ticks: number } | null = null;
  for (const r of rows) {
    let v: Record<string, unknown> = {};
    try {
      v = JSON.parse(r.valuesJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const s = typeof v.lifetime_sticks_candidate === "number" ? v.lifetime_sticks_candidate : null;
    const q = typeof v.lifetime_seconds_candidate === "number" ? v.lifetime_seconds_candidate * 4 : null; // agent reports ticks / 4
    if (s == null || q == null) continue;
    const cur = { serial: r.serial, sticks: s, ticks: q };
    if (prev && prev.serial === r.serial) {
      const ds = cur.sticks - prev.sticks;
      const dq = cur.ticks - prev.ticks;
      const at = new Date(r.collectedUtc);
      if (ds > 0 && dq > 0 && at >= startUtc && at < endUtcExclusive) {
        ticks += dq;
        sticks += ds;
        intervals++;
      }
    }
    prev = cur;
  }
  return { seconds: sticks ? Math.round(ticks / USAGE_TICKS_PER_SECOND / sticks) : null, sticks, intervals };
}

export function overview(): DeviceOverview[] {
  const all = listDevices();
  return all.map((d) => deviceOverview(d, all));
}

export interface StatsQuery {
  serials: string[];
  from: string;
  to: string;
  groupBy: GroupBy;
  /** Drop records flagged as clock suspects. */
  excludeSuspect?: boolean;
  /** First day of the week, 1 = Monday … 7 = Sunday. */
  weekStart?: number;
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Totals of the period of equal length right before [from, to] (for deltas on the stats page). */
function previousTotals(q: StatsQuery): StatTotals {
  const days = daysBetweenInclusive(q.from, q.to);
  const to = addDays(q.from, -1);
  const from = addDays(to, -(days - 1));
  return statsFor({ ...q, from, to, groupBy: "day" }, false).totals;
}

export function statsFor(q: StatsQuery, withPrevious = true): StatsResult & { suspectHidden: number; previous: StatTotals | null } {
  const db = getDb();
  const previous = withPrevious ? previousTotals(q) : null;
  if (!q.serials.length) return { ...computeStats([], q.from, q.to, q.groupBy, DISPLAY_TZ, q.weekStart ?? 1), suspectHidden: 0, previous };
  const { startUtc, endUtcExclusive } = localDayRangeUtc(q.from, q.to);
  const rows = db
    .select({
      serial: schema.events.serial,
      timestampUtc: schema.events.timestampUtc,
      puffCount: schema.events.puffCount,
      clockSuspect: schema.events.clockSuspect,
      puffPairsJson: schema.events.puffPairsJson,
    })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.serial, q.serials),
        eq(schema.events.status, "ok"),
        isNotNull(schema.events.timestampUtc),
        gte(schema.events.timestampUtc, isoNoMs(startUtc)),
        lt(schema.events.timestampUtc, isoNoMs(endUtcExclusive)),
        ...(q.excludeSuspect ? [eq(schema.events.clockSuspect, 0)] : []),
      ),
    )
    .all() as StatRow[];
  let suspectHidden = 0;
  if (q.excludeSuspect) {
    const placeholders = q.serials.map(() => "?").join(",");
    suspectHidden = (
      getSqlite()
        .prepare(
          `SELECT count(*) AS n FROM events WHERE serial IN (${placeholders}) AND status = 'ok' AND clock_suspect = 1
             AND timestamp_utc >= ? AND timestamp_utc < ?`,
        )
        .get(...q.serials, isoNoMs(startUtc), isoNoMs(endUtcExclusive)) as { n: number }
    ).n;
  }
  return { ...computeStats(rows, q.from, q.to, q.groupBy, DISPLAY_TZ, q.weekStart ?? 1), suspectHidden, previous };
}

function safeSpan(json: string | null | undefined): { first: number; last: number } | null {
  if (!json) return null;
  try {
    return puffSpan(JSON.parse(json) as string[]);
  } catch {
    return null;
  }
}

export interface DayRecord {
  serial: string;
  eventId: number;
  timestampUtc: string;
  puffCount: number | null;
  clockSuspect: boolean;
  /** Seconds from session start to the last puff, when pair data exists. */
  lastPuffS: number | null;
}

/** Timestamped records of the given devices inside local days [from, to] (drill-down from the charts). */
export function recordsInRange(serials: string[], from: string, to: string, excludeSuspect = false, limit = 1000): DayRecord[] {
  if (!serials.length) return [];
  const { startUtc, endUtcExclusive } = localDayRangeUtc(from, to);
  const rows = getDb()
    .select({
      serial: schema.events.serial,
      eventId: schema.events.eventId,
      timestampUtc: schema.events.timestampUtc,
      puffCount: schema.events.puffCount,
      clockSuspect: schema.events.clockSuspect,
      puffPairsJson: schema.events.puffPairsJson,
    })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.serial, serials),
        eq(schema.events.status, "ok"),
        isNotNull(schema.events.timestampUtc),
        gte(schema.events.timestampUtc, isoNoMs(startUtc)),
        lt(schema.events.timestampUtc, isoNoMs(endUtcExclusive)),
        ...(excludeSuspect ? [eq(schema.events.clockSuspect, 0)] : []),
      ),
    )
    .orderBy(desc(schema.events.timestampUtc))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    serial: r.serial,
    eventId: r.eventId,
    timestampUtc: r.timestampUtc!,
    puffCount: r.puffCount,
    clockSuspect: !!r.clockSuspect,
    lastPuffS: safeSpan(r.puffPairsJson)?.last ?? null,
  }));
}

/** Records worth a second look: invalid status or a suspicious clock. */
export function faultyRecords(serial: string, limit = 200): { eventId: number; timestampUtc: string | null; status: string; puffCount: number | null; clockSuspect: boolean }[] {
  const rows = getSqlite()
    .prepare("SELECT event_id, timestamp_utc, status, puff_count, clock_suspect FROM events WHERE serial = ? AND (status != 'ok' OR clock_suspect = 1) ORDER BY event_id DESC LIMIT ?")
    .all(serial, limit) as { event_id: number; timestamp_utc: string | null; status: string; puff_count: number | null; clock_suspect: number }[];
  return rows.map((r) => ({ eventId: r.event_id, timestampUtc: r.timestamp_utc, status: r.status, puffCount: r.puff_count, clockSuspect: !!r.clock_suspect }));
}

export interface EventPage {
  items: {
    eventId: number;
    timestampUtc: string | null;
    status: string;
    puffCount: number | null;
    puffPairs: string[] | null;
    lastPuffS: number | null;
    clockSuspect: boolean;
    responseHex: string | null;
    endNoticeUtc: string | null;
    puffsEstimate: number | null;
  }[];
  total: number;
}

export function eventPage(serial: string, offset: number, limit: number, status?: string, validOnly = false): EventPage {
  const sqlite = getSqlite();
  let where = "WHERE e.serial = ?";
  const args: (string | number)[] = [serial];
  if (status) {
    where += " AND e.status = ?";
    args.push(status);
  } else if (validOnly) {
    where += " AND e.status = 'ok'";
  }
  const total = (sqlite.prepare(`SELECT count(*) AS n FROM events e ${where}`).get(...args) as { n: number }).n;
  const rows = sqlite
    .prepare(
      `SELECT e.event_id, e.timestamp_utc, e.status, e.puff_count, e.puff_pairs_json, e.clock_suspect, e.response_hex,
              o.end_notice_utc, o.puffs_estimate
       FROM events e LEFT JOIN observations o ON o.serial = e.serial AND o.event_id = e.event_id
       ${where} ORDER BY e.event_id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as {
    event_id: number;
    timestamp_utc: string | null;
    status: string;
    puff_count: number | null;
    puff_pairs_json: string | null;
    clock_suspect: number;
    response_hex: string | null;
    end_notice_utc: string | null;
    puffs_estimate: number | null;
  }[];
  return {
    total,
    items: rows.map((r) => ({
      eventId: r.event_id,
      timestampUtc: r.timestamp_utc,
      status: r.status,
      puffCount: r.puff_count,
      puffPairs: r.puff_pairs_json ? (JSON.parse(r.puff_pairs_json) as string[]) : null,
      lastPuffS: safeSpan(r.puff_pairs_json)?.last ?? null,
      clockSuspect: !!r.clock_suspect,
      responseHex: r.response_hex,
      endNoticeUtc: r.end_notice_utc,
      puffsEstimate: r.puffs_estimate,
    })),
  };
}

/** Live samples for research/export, oldest first, optionally from a timestamp. */
export function liveSamplesSince(serial: string, sinceUtc: string | null, limit = 5000): schema.LiveSample[] {
  const conds = [eq(schema.liveSamples.serial, serial)];
  if (sinceUtc) conds.push(gte(schema.liveSamples.atUtc, sinceUtc));
  return getDb().select().from(schema.liveSamples).where(and(...conds)).orderBy(schema.liveSamples.id).limit(limit).all();
}

export function listSnapshots(serial: string, limit = 100): schema.Snapshot[] {
  return getDb().select().from(schema.snapshots).where(eq(schema.snapshots.serial, serial)).orderBy(desc(schema.snapshots.id)).limit(limit).all();
}

export function recentLiveSamples(serial: string, limit = 50): schema.LiveSample[] {
  return getDb().select().from(schema.liveSamples).where(eq(schema.liveSamples.serial, serial)).orderBy(desc(schema.liveSamples.id)).limit(limit).all();
}

export function deviceNextIndexEstimate(serial: string): number | null {
  const row = getSqlite().prepare("SELECT max(event_id) AS high FROM events WHERE serial = ?").get(serial) as { high: number | null };
  return row.high === null ? null : row.high + 1;
}

export const _unused = sql;
