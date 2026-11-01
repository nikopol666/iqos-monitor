import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VECTORS = path.resolve(__dirname, "../../../../test-vectors");
process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "iqos-test-")), "test.sqlite3");

// Imported after DATABASE_PATH is set so the module opens the temp file.
const ingest = await import("../ingest");
const { getSqlite } = await import("@/db");

function capture(name: string) {
  return JSON.parse(readFileSync(path.join(VECTORS, name), "utf8")).results as { id: number; response_hex: string; status: string }[];
}

describe("ingestEvents", () => {
  const serial = "DEVICEA0000001";
  beforeAll(() => ingest.ensureDevice(serial));

  it("stores, decodes and acknowledges; never overwrites ok rows", () => {
    const rows = capture("fialova_post_use_20261026_201913.json");
    const r1 = ingest.ingestEvents(
      serial,
      rows.map((r) => ({ event_id: r.id, status: r.status, response_hex: r.response_hex })),
    );
    expect(r1.inserted).toBe(rows.length);
    expect(r1.acked).toEqual(rows.map((r) => r.id));
    const stored = getSqlite().prepare("SELECT status, puff_count, timestamp_utc FROM events WHERE serial=? AND event_id=1076").get(serial) as {
      status: string;
      puff_count: number;
      timestamp_utc: string;
    };
    expect(stored).toEqual({ status: "ok", puff_count: 18, timestamp_utc: "2026-10-26T19:02:00+00:00" });
    // A later bad read of the same id is ignored.
    const r2 = ingest.ingestEvents(serial, [{ event_id: 1076, status: "timeout", response_hex: "" }]);
    expect(r2.skipped).toBe(1);
    expect(r2.acked).toEqual([1076]);
    // A timeout can be replaced by a good read.
    ingest.ingestEvents(serial, [{ event_id: 5, status: "timeout", response_hex: "" }]);
    const r3 = ingest.ingestEvents(serial, [{ event_id: 5, status: "ok", response_hex: rows[0].response_hex }]);
    expect(r3.updated).toBe(1);
  });

  it("flags adjacent ids with a >30 day jump as clock suspects", async () => {
    const sqlite = getSqlite();
    const base = capture("fialova_post_use_20261026_201913.json")[0].response_hex;
    // Build two frames with ids 200/201 and times five months apart using the
    // same trick as the Python tests (patch id, seconds, CRC).
    const { crc16 } = await import("../protocol/crc");
    const { hexToBytes, bytesToHex } = await import("../protocol/bytes");
    const make = (id: number, iso: string) => {
      const f = hexToBytes(base);
      f[8] = id & 0xff;
      f[9] = (id >> 8) & 0xff;
      f[10] = (id >> 16) & 0xff;
      const secs = Math.floor((Date.parse(iso) - Date.UTC(2010, 0, 1)) / 1000);
      f[19] = secs & 0xff;
      f[20] = (secs >> 8) & 0xff;
      f[21] = (secs >> 16) & 0xff;
      f[22] = (secs >>> 24) & 0xff;
      const c = crc16(f.subarray(2, f.length - 2));
      f[f.length - 2] = c & 0xff;
      f[f.length - 1] = c >> 8;
      return bytesToHex(f);
    };
    ingest.ingestEvents(serial, [
      { event_id: 201, status: "ok", response_hex: make(201, "2026-10-26T10:00:00Z") },
      { event_id: 200, status: "ok", response_hex: make(200, "2026-05-03T10:00:00Z") },
      { event_id: 199, status: "ok", response_hex: make(199, "2026-05-02T10:00:00Z") },
    ]);
    const flags = sqlite.prepare("SELECT event_id, clock_suspect FROM events WHERE serial=? AND event_id IN (199,200,201) ORDER BY event_id").all(serial);
    expect(flags).toEqual([
      { event_id: 199, clock_suspect: 0 },
      { event_id: 200, clock_suspect: 1 },
      { event_id: 201, clock_suspect: 1 },
    ]);
    const dev = sqlite.prepare("SELECT clock_warning, lowest_stored_index FROM devices WHERE serial=?").get(serial) as { clock_warning: number; lowest_stored_index: number };
    expect(dev.clock_warning).toBe(1);
    expect(dev.lowest_stored_index).toBe(5);
  });

  it("live state writes samples only on change", () => {
    const sqlite = getSqlite();
    ingest.updateLive(serial, null, { battery: 90, stick_state: "01", lifetime_sticks: 10, lifetime_puffs: 100 });
    ingest.updateLive(serial, null, { battery: 90, stick_state: "01", lifetime_sticks: 10, lifetime_puffs: 100 });
    ingest.updateLive(serial, null, { battery: 89, stick_state: "01", lifetime_sticks: 10, lifetime_puffs: 101 });
    const n = (sqlite.prepare("SELECT count(*) AS n FROM live_samples WHERE serial=?").get(serial) as { n: number }).n;
    expect(n).toBe(2);
    const state = sqlite.prepare("SELECT battery, disconnected_utc FROM live_state WHERE serial=?").get(serial) as { battery: number; disconnected_utc: string | null };
    expect(state).toEqual({ battery: 89, disconnected_utc: null });
    ingest.updateLive(serial, null, { connected: false });
    const after = sqlite.prepare("SELECT battery, disconnected_utc FROM live_state WHERE serial=?").get(serial) as { battery: number; disconnected_utc: string | null };
    expect(after.battery).toBe(89);
    expect(after.disconnected_utc).not.toBeNull();
  });

  it("jobs are deduplicated while open", () => {
    const a = ingest.createJob(serial, "full_history");
    const b = ingest.createJob(serial, "full_history");
    expect(a.id).toBe(b.id);
    expect(ingest.pendingJobs([serial]).map((j) => j.id)).toEqual([a.id]);
    ingest.updateJob(a.id, { status: "running", progress_done: 10, progress_total: 100 });
    ingest.updateJob(a.id, { status: "done", progress_done: 100 });
    expect(ingest.pendingJobs([serial])).toEqual([]);
    const dev = getSqlite().prepare("SELECT full_history_complete FROM devices WHERE serial=?").get(serial) as { full_history_complete: number };
    expect(dev.full_history_complete).toBe(1);
  });

  it("live samples ignore the seconds counter but follow charging", () => {
    const s = "SAMPLE00000001";
    ingest.ensureDevice(s);
    const count = () => (getSqlite().prepare("SELECT count(*) c FROM live_samples WHERE serial = ?").get(s) as { c: number }).c;
    ingest.updateLive(s, null, { battery: 80, charging: true, lifetime_seconds: 100 });
    const base = count();
    ingest.updateLive(s, null, { battery: 80, charging: true, lifetime_seconds: 101.25 });
    expect(count()).toBe(base);
    ingest.updateLive(s, null, { battery: 80, charging: false, lifetime_seconds: 102 });
    expect(count()).toBe(base + 1);
    const last = getSqlite().prepare("SELECT extra_json FROM live_samples WHERE serial = ? ORDER BY id DESC LIMIT 1").get(s) as { extra_json: string };
    expect(JSON.parse(last.extra_json).lifetime_seconds).toBe(102);
  });

  it("deleted ids come back only with a full history download, blocked ones never", () => {
    const s = "BLOCK000000001";
    ingest.ensureDevice(s);
    ingest.ingestEvents(s, [
      { event_id: 5, status: "ok", response_hex: "" },
      { event_id: 6, status: "ok", response_hex: "" },
      { event_id: 7, status: "ok", response_hex: "" },
    ]);
    ingest.removeRecord(s, 5, "deleted");
    ingest.removeRecord(s, 6, "blocked");
    expect(ingest.missingIds(s, 5, 7)).toEqual([]);
    expect(ingest.missingIds(s, 5, 7, true)).toEqual([5]);
    // a blocked id is acknowledged but not stored; a deleted id is stored again and unblocked
    const r = ingest.ingestEvents(s, [
      { event_id: 5, status: "ok", response_hex: "" },
      { event_id: 6, status: "ok", response_hex: "" },
    ]);
    expect(r.acked).toEqual([5, 6]);
    expect(ingest.listBlocks(s).map((b) => b.eventId)).toEqual([6]);
    expect(ingest.missingIds(s, 5, 7, true)).toEqual([]);
    ingest.restoreRecord(s, 6);
    expect(ingest.missingIds(s, 5, 7)).toEqual([6]);
  });

  it("lists the archive ids the server still lacks", () => {
    const all = ingest.missingIds("UNKNOWN0000000", 0, 4);
    expect(all).toEqual([0, 1, 2, 3, 4]);
    const stored = getSqlite().prepare("SELECT event_id FROM events WHERE serial = ? AND status IN ('ok','empty') ORDER BY event_id").all(serial) as { event_id: number }[];
    const ids = stored.map((r) => r.event_id);
    const missing = ingest.missingIds(serial, 0, Math.max(...ids));
    for (const id of ids) expect(missing).not.toContain(id);
    expect(missing.length + ids.length).toBe(Math.max(...ids) + 1);
  });

  it("a cancelled job is not revived by the agent's progress report", () => {
    const c = ingest.createJob(serial, "full_history");
    ingest.updateJob(c.id, { status: "cancelled" });
    const after = ingest.updateJob(c.id, { status: "running", progress_done: 5, progress_total: 50 });
    expect(after?.status).toBe("cancelled");
    expect(after?.progressDone).toBe(5);
    // ...but the agent is still told about it for a while
    expect(ingest.pendingJobs([serial]).map((j) => j.status)).toEqual(["cancelled"]);
  });
});
