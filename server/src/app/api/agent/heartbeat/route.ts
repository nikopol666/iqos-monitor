import { inArray } from "drizzle-orm";
import { authenticateAgent, touchAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, readJson, validSerial } from "@/lib/api";
import { ensureDevice, eventCounts, pendingJobs, updateLive } from "@/lib/ingest";
import { getDb, schema } from "@/db";
import { deviceLabel } from "@/lib/variants";

interface HeartbeatBody {
  agent?: { name?: string; version?: string; hostname?: string };
  devices?: { serial: string; connected?: boolean; next_index?: number | null }[];
}

/**
 * Agent check-in. Registers unknown serials, returns per-device sync state
 * (incl. how many records the server holds) and any queued jobs for the
 * connected devices. Devices listed without `connected` are the agent's
 * offline devices: their live state is left alone.
 */
export async function POST(request: Request) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  touchAgent(identity, request);
  const body = await readJson<HeartbeatBody>(request);
  if (!body) return badRequest("invalid json");
  const devicesIn = Array.isArray(body.devices) ? body.devices : [];
  const serials: string[] = [];
  for (const d of devicesIn) {
    if (!validSerial(d.serial)) continue;
    ensureDevice(d.serial);
    serials.push(d.serial);
    if (d.connected === false) updateLive(d.serial, identity.id, { connected: false });
  }
  const db = getDb();
  const rows = serials.length ? db.select().from(schema.devices).where(inArray(schema.devices.serial, serials)).all() : [];
  const allDevices = db.select().from(schema.devices).all();
  const counts = eventCounts(serials);
  const devices: Record<string, unknown> = {};
  for (const r of rows) {
    devices[r.serial] = {
      name: deviceLabel(r.name, r.variant, r.serial, allDevices),
      // Lets an agent notice a fresh or restored server and re-send its local archive.
      event_count: counts[r.serial] ?? 0,
      acked_next_index: r.ackedNextIndex,
      lowest_stored_index: r.lowestStoredIndex,
      full_history_complete: !!r.fullHistoryComplete,
    };
  }
  const jobs = pendingJobs(serials.filter((s) => devicesIn.find((d) => d.serial === s)?.connected !== false)).map((j) => ({
    id: j.id,
    serial: j.serial,
    type: j.type,
    payload: j.payloadJson ? JSON.parse(j.payloadJson) : null,
    status: j.status,
    progress_done: j.progressDone,
    progress_total: j.progressTotal,
  }));
  return json({ ok: true, agent: identity, devices, jobs, server_time_utc: new Date().toISOString() });
}
