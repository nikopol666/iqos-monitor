/**
 * Everything the agent API writes: devices, archive events, snapshots, live
 * state and jobs. Pure functions over the shared SQLite handle.
 */
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, getSqlite, nowUtc, schema } from "@/db";
import { decodeEvent, parseSnapshotFrames, type ClassicKey } from "@/lib/protocol";
import { DEFAULT_VARIANT, defaultColorFor } from "@/lib/variants";

export const CLOCK_JUMP_DAYS = 30;
export const LIVE_TIMEOUT_SECONDS = 10;

export function colorsInUse(exceptSerial?: string): string[] {
  const rows = getSqlite().prepare("SELECT serial, color FROM devices").all() as { serial: string; color: string }[];
  return rows.filter((r) => r.serial !== exceptSerial).map((r) => r.color);
}

export function ensureDevice(serial: string): void {
  const db = getDb();
  const now = nowUtc();
  const existing = db.select({ serial: schema.devices.serial }).from(schema.devices).where(eq(schema.devices.serial, serial)).get();
  if (existing) {
    db.update(schema.devices).set({ lastSeenUtc: now }).where(eq(schema.devices.serial, serial)).run();
    return;
  }
  db.insert(schema.devices)
    .values({
      serial,
      name: "",
      firstSeenUtc: now,
      lastSeenUtc: now,
      variant: DEFAULT_VARIANT,
      color: defaultColorFor(DEFAULT_VARIANT, colorsInUse()),
      colorCustom: 0,
    })
    .run();
}

export interface IncomingEvent {
  event_id: number;
  status: string;
  response_hex?: string | null;
  raw_packets_json?: string | null;
  fetched_at_utc?: string | null;
}

export interface IngestResult {
  acked: number[];
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Upsert archive records with the agent's rule: a stored 'ok' or 'empty' row
 * is never overwritten. Decoding happens here from the raw hex so the server
 * is the single source of truth for interpretations.
 */
export function ingestEvents(serial: string, items: IncomingEvent[]): IngestResult {
  const sqlite = getSqlite();
  const now = nowUtc();
  const select = sqlite.prepare("SELECT status FROM events WHERE serial = ? AND event_id = ?");
  const insert = sqlite.prepare(`
    INSERT INTO events (serial, event_id, timestamp_utc, status, response_hex, raw_packets_json,
                        puff_count, puff_pairs_json, record_marker, clock_suspect, fetched_at_utc, received_at_utc)
    VALUES (@serial, @eventId, @timestampUtc, @status, @responseHex, @rawPacketsJson,
            @puffCount, @puffPairsJson, @recordMarker, 0, @fetchedAtUtc, @receivedAtUtc)
    ON CONFLICT(serial, event_id) DO UPDATE SET
      timestamp_utc = excluded.timestamp_utc,
      status = excluded.status,
      response_hex = excluded.response_hex,
      raw_packets_json = coalesce(excluded.raw_packets_json, events.raw_packets_json),
      puff_count = excluded.puff_count,
      puff_pairs_json = excluded.puff_pairs_json,
      record_marker = excluded.record_marker,
      fetched_at_utc = excluded.fetched_at_utc,
      received_at_utc = excluded.received_at_utc
    WHERE events.status NOT IN ('ok', 'empty')
  `);
  const result: IngestResult = { acked: [], inserted: 0, updated: 0, skipped: 0 };
  const run = sqlite.transaction(() => {
    for (const item of items) {
      const eventId = Number(item.event_id);
      if (!Number.isInteger(eventId) || eventId < 0 || eventId > 0xffffff) continue;
      const existing = select.get(serial, eventId) as { status: string } | undefined;
      if (existing && (existing.status === "ok" || existing.status === "empty")) {
        result.skipped++;
        result.acked.push(eventId);
        continue;
      }
      const decoded = decodeEvent(String(item.status ?? "unknown"), item.response_hex ?? "");
      insert.run({
        serial,
        eventId,
        timestampUtc: decoded.timestampUtc,
        status: decoded.status,
        responseHex: item.response_hex ?? "",
        rawPacketsJson: item.raw_packets_json ?? null,
        puffCount: decoded.puffCount,
        puffPairsJson: decoded.puffPairs ? JSON.stringify(decoded.puffPairs) : null,
        recordMarker: decoded.recordMarker,
        fetchedAtUtc: item.fetched_at_utc || now,
        receivedAtUtc: now,
      });
      if (existing) result.updated++;
      else result.inserted++;
      result.acked.push(eventId);
    }
  });
  run();
  if (result.inserted || result.updated) {
    recomputeClockSuspect(serial);
    refreshDeviceRange(serial);
  }
  return result;
}

/** Adjacent archive IDs whose timestamps differ by > 30 days are suspect. */
export function recomputeClockSuspect(serial: string): number {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare("SELECT event_id, timestamp_utc, clock_suspect FROM events WHERE serial = ? AND status = 'ok' AND timestamp_utc IS NOT NULL ORDER BY event_id DESC")
    .all(serial) as { event_id: number; timestamp_utc: string; clock_suspect: number }[];
  const suspect = new Set<number>();
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.event_id !== b.event_id + 1) continue;
    const diff = Math.abs(Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc));
    if (diff > CLOCK_JUMP_DAYS * 86400000) {
      suspect.add(a.event_id);
      suspect.add(b.event_id);
    }
  }
  const update = sqlite.prepare("UPDATE events SET clock_suspect = ? WHERE serial = ? AND event_id = ?");
  let changed = 0;
  sqlite.transaction(() => {
    for (const r of rows) {
      const want = suspect.has(r.event_id) ? 1 : 0;
      if (want !== r.clock_suspect) {
        update.run(want, serial, r.event_id);
        changed++;
      }
    }
    sqlite.prepare("UPDATE devices SET clock_warning = ? WHERE serial = ?").run(suspect.size ? 1 : 0, serial);
  })();
  return changed;
}

export function refreshDeviceRange(serial: string): void {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT min(event_id) AS low, max(event_id) AS high, count(*) AS n FROM events WHERE serial = ? AND status IN ('ok','empty')")
    .get(serial) as { low: number | null; high: number | null; n: number };
  sqlite.prepare("UPDATE devices SET lowest_stored_index = ? WHERE serial = ?").run(row.low, serial);
}

/** Re-decode every stored frame (after a decoder improvement). */
export function redecodeAll(serial?: string): number {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(`SELECT serial, event_id, status, response_hex FROM events ${serial ? "WHERE serial = ?" : ""}`)
    .all(...(serial ? [serial] : [])) as { serial: string; event_id: number; status: string; response_hex: string }[];
  const update = sqlite.prepare(
    "UPDATE events SET timestamp_utc = ?, status = ?, puff_count = ?, puff_pairs_json = ?, record_marker = ? WHERE serial = ? AND event_id = ?",
  );
  let n = 0;
  sqlite.transaction(() => {
    for (const r of rows) {
      const d = decodeEvent(r.status, r.response_hex);
      update.run(d.timestampUtc, d.status, d.puffCount, d.puffPairs ? JSON.stringify(d.puffPairs) : null, d.recordMarker, r.serial, r.event_id);
      n++;
    }
  })();
  const serials = serial ? [serial] : (sqlite.prepare("SELECT serial FROM devices").all() as { serial: string }[]).map((r) => r.serial);
  for (const s of serials) {
    recomputeClockSuspect(s);
    refreshDeviceRange(s);
  }
  return n;
}

export interface IncomingSnapshot {
  collected_utc?: string;
  values?: Record<string, unknown>;
  statuses?: Record<string, string>;
  frames?: Record<string, string>;
}

export function saveSnapshot(serial: string, snap: IncomingSnapshot): void {
  const db = getDb();
  const frames = (snap.frames ?? {}) as Partial<Record<ClassicKey, string>>;
  // Server-side re-parse from raw frames wins over whatever the agent computed.
  const parsed = Object.keys(frames).length ? parseSnapshotFrames(frames) : null;
  const values = parsed ? { ...(snap.values ?? {}), ...parsed.values } : (snap.values ?? {});
  const statuses = parsed ? { ...(snap.statuses ?? {}), ...parsed.statuses } : (snap.statuses ?? {});
  db.insert(schema.snapshots)
    .values({
      serial,
      collectedUtc: snap.collected_utc || nowUtc(),
      valuesJson: JSON.stringify(values),
      statusesJson: JSON.stringify(statuses),
      framesJson: JSON.stringify(frames),
    })
    .run();
  const patch: Partial<schema.Device> = { lastSeenUtc: nowUtc() };
  if (typeof values.model === "string") patch.model = values.model;
  if (typeof values.firmware_raw === "string") patch.firmwareRaw = values.firmware_raw;
  db.update(schema.devices).set(patch).where(eq(schema.devices.serial, serial)).run();
}

export interface IncomingLive {
  battery?: number | null;
  stick_state?: string | null;
  error_state?: number | null;
  lifetime_sticks?: number | null;
  lifetime_puffs?: number | null;
  lifetime_seconds?: number | null;
  session_raw?: string | null;
  sync_status?: string | null;
  connected?: boolean;
  brightness_level?: number | null;
  status_60_raw?: string | null;
  battery_temp_c?: number | null;
  charging?: boolean | null;
}

export function updateLive(serial: string, agentId: number | null, live: IncomingLive): void {
  const db = getDb();
  const now = nowUtc();
  const prev = db.select().from(schema.liveState).where(eq(schema.liveState.serial, serial)).get();
  const next = {
    serial,
    agentId,
    updatedUtc: now,
    battery: live.battery ?? null,
    stickState: live.stick_state ?? null,
    errorState: live.error_state ?? null,
    lifetimeSticks: live.lifetime_sticks ?? null,
    lifetimePuffs: live.lifetime_puffs ?? null,
    lifetimeSeconds: live.lifetime_seconds == null ? null : Math.round(live.lifetime_seconds),
    sessionRaw: live.session_raw ?? null,
    syncStatus: live.sync_status ?? null,
    disconnectedUtc: live.connected === false ? now : null,
    extraJson: JSON.stringify({ brightness_level: live.brightness_level ?? null, status_60_raw: live.status_60_raw ?? null, battery_temp_c: live.battery_temp_c ?? null, charging: live.charging ?? null }),
  };
  if (live.connected === false) {
    // Keep the last known values, only mark the disconnect.
    db.insert(schema.liveState)
      .values({ ...next, battery: prev?.battery ?? null, stickState: prev?.stickState ?? null, lifetimeSticks: prev?.lifetimeSticks ?? null, lifetimePuffs: prev?.lifetimePuffs ?? null, lifetimeSeconds: prev?.lifetimeSeconds ?? null })
      .onConflictDoUpdate({ target: schema.liveState.serial, set: { disconnectedUtc: now, updatedUtc: now, syncStatus: null } })
      .run();
    return;
  }
  db.insert(schema.liveState)
    .values(next)
    .onConflictDoUpdate({ target: schema.liveState.serial, set: next })
    .run();
  const changed =
    !prev ||
    prev.disconnectedUtc !== null ||
    prev.battery !== next.battery ||
    prev.stickState !== next.stickState ||
    prev.lifetimeSticks !== next.lifetimeSticks ||
    prev.lifetimePuffs !== next.lifetimePuffs ||
    prev.extraJson !== next.extraJson;
  if (changed) {
    db.insert(schema.liveSamples)
      .values({ serial, atUtc: now, battery: next.battery, stickState: next.stickState, lifetimeSticks: next.lifetimeSticks, lifetimePuffs: next.lifetimePuffs, extraJson: next.extraJson })
      .run();
  }
  db.update(schema.devices).set({ lastSeenUtc: now }).where(eq(schema.devices.serial, serial)).run();
}

export function isLiveConnected(state: schema.LiveState | undefined | null, now = Date.now()): boolean {
  if (!state || state.disconnectedUtc) return false;
  return now - Date.parse(state.updatedUtc) < LIVE_TIMEOUT_SECONDS * 1000;
}

export type JobType = "full_history" | "set_setting";

/** Queue a job; an identical open job (same type and payload) is returned instead of duplicated. */
export function createJob(serial: string, type: JobType, payload?: unknown): schema.AgentJob {
  const db = getDb();
  const now = nowUtc();
  const payloadJson = payload == null ? null : JSON.stringify(payload);
  const open = db
    .select()
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.serial, serial), eq(schema.agentJobs.type, type), inArray(schema.agentJobs.status, ["queued", "running"])))
    .all()
    .find((j) => j.payloadJson === payloadJson);
  if (open) return open;
  return db
    .insert(schema.agentJobs)
    .values({ serial, type, payloadJson, status: "queued", createdUtc: now, updatedUtc: now })
    .returning()
    .get();
}

/**
 * Open jobs for the given devices plus jobs cancelled in the last 15 minutes,
 * so a running agent learns about a cancellation on its next heartbeat.
 */
export function pendingJobs(serials: string[]): schema.AgentJob[] {
  if (!serials.length) return [];
  const db = getDb();
  const recent = new Date(Date.now() - 15 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  return db
    .select()
    .from(schema.agentJobs)
    .where(
      and(
        inArray(schema.agentJobs.serial, serials),
        or(inArray(schema.agentJobs.status, ["queued", "running"]), and(eq(schema.agentJobs.status, "cancelled"), gte(schema.agentJobs.updatedUtc, recent))),
      ),
    )
    .orderBy(schema.agentJobs.id)
    .all();
}

export interface JobUpdate {
  status?: string;
  progress_done?: number;
  progress_total?: number | null;
  message?: string | null;
}

export function updateJob(id: number, patch: JobUpdate): schema.AgentJob | undefined {
  const db = getDb();
  const set: Partial<schema.AgentJob> = { updatedUtc: nowUtc() };
  const current = db.select({ status: schema.agentJobs.status }).from(schema.agentJobs).where(eq(schema.agentJobs.id, id)).get();
  if (!current) return undefined;
  // A cancelled job stays cancelled: the agent's progress reports ("running")
  // race with the user's cancel and must not revive it.
  const revive = current.status === "cancelled" && (patch.status === "running" || patch.status === "queued");
  if (patch.status && !revive) set.status = patch.status;
  if (typeof patch.progress_done === "number") set.progressDone = patch.progress_done;
  if (patch.progress_total !== undefined) set.progressTotal = patch.progress_total;
  if (patch.message !== undefined) set.message = patch.message;
  db.update(schema.agentJobs).set(set).where(eq(schema.agentJobs.id, id)).run();
  const job = db.select().from(schema.agentJobs).where(eq(schema.agentJobs.id, id)).get();
  if (job && job.type === "full_history" && job.status === "done") {
    db.update(schema.devices).set({ fullHistoryComplete: 1 }).where(eq(schema.devices.serial, job.serial)).run();
  }
  return job;
}

/** Number of stored archive records per serial (agents compare it with their local copy). */
export function eventCounts(serials: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!serials.length) return out;
  const rows = getDb()
    .select({ serial: schema.events.serial, n: sql<number>`count(*)` })
    .from(schema.events)
    .where(inArray(schema.events.serial, serials))
    .groupBy(schema.events.serial)
    .all();
  for (const s of serials) out[s] = 0;
  for (const r of rows) out[r.serial] = Number(r.n);
  return out;
}

/** The queued or running full-history job of a device, if any. */
export function openFullHistoryJob(serial: string): schema.AgentJob | undefined {
  const db = getDb();
  return db
    .select()
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.serial, serial), eq(schema.agentJobs.type, "full_history"), inArray(schema.agentJobs.status, ["queued", "running"])))
    .orderBy(desc(schema.agentJobs.id))
    .limit(1)
    .get();
}

export function latestJob(serial: string): schema.AgentJob | undefined {
  const db = getDb();
  return db.select().from(schema.agentJobs).where(eq(schema.agentJobs.serial, serial)).orderBy(desc(schema.agentJobs.id)).limit(1).get();
}

export function setAckedNextIndex(serial: string, nextIndex: number): void {
  const sqlite = getSqlite();
  sqlite.prepare("UPDATE devices SET acked_next_index = max(coalesce(acked_next_index, 0), ?) WHERE serial = ?").run(nextIndex, serial);
}

export function importObservations(records: { serial: string; event_id: number; end_notice_utc?: string | null; puffs_estimate?: number | null; source: string }[]): number {
  const sqlite = getSqlite();
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO observations (serial, event_id, end_notice_utc, puffs_estimate, source) VALUES (?, ?, ?, ?, ?)",
  );
  let n = 0;
  sqlite.transaction(() => {
    for (const r of records) {
      if (!r.serial || !Number.isInteger(r.event_id)) continue;
      ensureDevice(r.serial);
      insert.run(r.serial, r.event_id, r.end_notice_utc ?? null, r.puffs_estimate ?? null, r.source);
      n++;
    }
  })();
  return n;
}

export const _sql = sql;
