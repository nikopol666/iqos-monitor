import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "iqos-test-")), "test.sqlite3");

const { validateEvents, validateLive, validateSnapshot } = await import("../ingest");
const { decodeEvent, parseSnapshotFrames } = await import("../protocol");
const { GET: statsGET } = await import("@/app/api/stats/route");

describe("agent payload validation", () => {
  it("events: accepts what the agent sends, rejects objects in string fields", () => {
    expect(validateEvents([{ event_id: 5, status: "ok", response_hex: "", raw_packets_json: null, fetched_at_utc: "2026-11-26T10:00:00+00:00", timestamp_candidate_utc: null }])).toBeNull();
    expect(validateEvents([null])).toMatch(/events\[0\]/);
    expect(validateEvents([{ event_id: 1, status: "ok", response_hex: { x: 1 } }])).toMatch(/response_hex/);
    expect(validateEvents([{ event_id: 1, status: "ok", raw_packets_json: ["a"] }])).toMatch(/raw_packets_json/);
    expect(validateEvents([{ event_id: { a: 1 }, status: "ok" }])).toMatch(/event_id/);
  });
  it("live: numbers, strings and booleans where expected", () => {
    expect(validateLive({ battery: 80, stick_state: "01", charging: true, lifetime_seconds: 12.25, connected: true, sync_status: null })).toBeNull();
    expect(validateLive({ connected: false })).toBeNull();
    expect(validateLive({ battery: { a: 1 } })).toMatch(/battery/);
    expect(validateLive({ stick_state: 1 })).toMatch(/stick_state/);
    expect(validateLive({ charging: "yes" })).toMatch(/charging/);
    expect(validateLive([])).toMatch(/object/);
  });
  it("snapshot: frames must be hex strings", () => {
    expect(validateSnapshot({ values: { model: "x" }, statuses: {}, frames: { serial: "", model: "00ff" }, collected_utc: "2026-11-26T10:00:00Z" })).toBeNull();
    expect(validateSnapshot({ frames: { serial: 5 } })).toMatch(/frames\.serial/);
    expect(validateSnapshot({ values: [1] })).toMatch(/values/);
  });
  it("snapshot frames that are not hex decode as invalid instead of throwing", () => {
    expect(parseSnapshotFrames({ serial: "zz" }).statuses.serial).toBe("invalid");
  });
});

describe("decodeEvent without a usable frame", () => {
  it("ok/empty without a frame becomes bad_frame", () => {
    expect(decodeEvent("ok", "").status).toBe("bad_frame");
    expect(decodeEvent("ok", null).status).toBe("bad_frame");
    expect(decodeEvent("empty", "not-hex").status).toBe("bad_frame");
  });
  it("other statuses pass through", () => {
    expect(decodeEvent("timeout", "").status).toBe("timeout");
    expect(decodeEvent("ok", "0011223344556677889900aabb").status).toBe("bad_crc");
  });
});

describe("GET /api/stats range limits", () => {
  const get = (q: string) => statsGET(new Request(`http://localhost/api/stats?${q}`));
  it("returns 400 for oversized or out-of-bounds ranges", async () => {
    expect((await get("from=0001-01-01&to=9999-12-31&group=hour")).status).toBe(400);
    expect((await get("from=2026-01-01&to=2026-03-01&group=hour")).status).toBe(400);
    expect((await get("from=2026-02-31&to=2026-03-05&group=day")).status).toBe(400);
  });
  it("answers a normal range", async () => {
    const res = await get("from=2026-11-01&to=2026-11-26&group=day");
    expect(res.status).toBe(200);
  });
});
