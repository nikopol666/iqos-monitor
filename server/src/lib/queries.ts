/** Read-side queries used by pages and the web API. */
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, getSqlite, schema } from "@/db";
import { isLiveConnected, latestJob } from "@/lib/ingest";
import { computeStats, type GroupBy, type StatRow, type StatsResult } from "@/lib/stats";
import { localDayRangeUtc, todayKey, DISPLAY_TZ } from "@/lib/time";
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
  const job = latestJob(device.serial);
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
      seconds: connected && live?.lifetimeSeconds != null ? live.lifetimeSeconds : (num(values.lifetime_seconds_candidate) ?? live?.lifetimeSeconds ?? null),
      battery: connected ? (live?.battery ?? null) : (live?.battery ?? num(values.battery_percent) ?? null),
    },
    charging: extra.charging ?? (typeof values.charging === "boolean" ? values.charging : null),
    brightness: extra.brightness_level ?? (typeof values.brightness_level === "number" ? values.brightness_level : null),
    clockWarning: !!device.clockWarning,
    fullHistoryComplete: !!device.fullHistoryComplete,
    ackedNextIndex: device.ackedNextIndex,
    lowestStoredIndex: device.lowestStoredIndex,
  };
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
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function statsFor(q: StatsQuery): StatsResult & { suspectHidden: number } {
  const db = getDb();
  if (!q.serials.length) return { ...computeStats([], q.from, q.to, q.groupBy, DISPLAY_TZ), suspectHidden: 0 };
  const { startUtc, endUtcExclusive } = localDayRangeUtc(q.from, q.to);
  const rows = db
    .select({
      serial: schema.events.serial,
      timestampUtc: schema.events.timestampUtc,
      puffCount: schema.events.puffCount,
      clockSuspect: schema.events.clockSuspect,
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
  return { ...computeStats(rows, q.from, q.to, q.groupBy, DISPLAY_TZ), suspectHidden };
}

export interface DayRecord {
  serial: string;
  eventId: number;
  timestampUtc: string;
  puffCount: number | null;
  clockSuspect: boolean;
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
  return rows.map((r) => ({ ...r, timestampUtc: r.timestampUtc!, clockSuspect: !!r.clockSuspect }));
}

export interface EventPage {
  items: {
    eventId: number;
    timestampUtc: string | null;
    status: string;
    puffCount: number | null;
    puffPairs: string[] | null;
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
      clockSuspect: !!r.clock_suspect,
      responseHex: r.response_hex,
      endNoticeUtc: r.end_notice_utc,
      puffsEstimate: r.puffs_estimate,
    })),
  };
}

export function recentLiveSamples(serial: string, limit = 50): schema.LiveSample[] {
  return getDb().select().from(schema.liveSamples).where(eq(schema.liveSamples.serial, serial)).orderBy(desc(schema.liveSamples.id)).limit(limit).all();
}

export function deviceNextIndexEstimate(serial: string): number | null {
  const row = getSqlite().prepare("SELECT max(event_id) AS high FROM events WHERE serial = ?").get(serial) as { high: number | null };
  return row.high === null ? null : row.high + 1;
}

export const _unused = sql;
