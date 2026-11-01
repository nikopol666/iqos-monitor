import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { crc16, crc8 } from "../crc";
import { hexToBytes } from "../bytes";
import { checkCrc, decodePuffs, extractDatetime, metadataNextIndex, decodeEvent, frameIndex } from "../history";
import { parseSnapshotFrames, READ_COMMANDS, decodeClassic } from "../classic";

const VECTORS = path.resolve(__dirname, "../../../../../test-vectors");
// Real device captures are not part of the repository (they identify the devices); tests that need them skip.
const HAVE_VECTORS = existsSync(VECTORS);
const NOW = new Date("2026-10-28T00:00:00Z");

interface CaptureRecord {
  id: number;
  command_hex: string;
  raw_in: string[];
  response_hex: string;
  status: string;
}
function loadCapture(name: string): CaptureRecord[] {
  return JSON.parse(readFileSync(path.join(VECTORS, name), "utf8")).results;
}

describe.skipIf(!HAVE_VECTORS)("history frames (same assertions as agent/tests)", () => {
  it("validates CRC-16 and timestamps of the two controlled sessions", () => {
    const cases: [string, number, string][] = [
      ["device-a_post_use_20261026_201913.json", 1076, "2026-10-26T19:02:00+00:00"],
      ["device-b_correct_20261026_203051.json", 10487, "2026-10-26T19:07:01+00:00"],
    ];
    for (const [file, id, time] of cases) {
      const rec = loadCapture(file).find((r) => r.id === id)!;
      const frame = hexToBytes(rec.response_hex);
      expect(checkCrc(frame)).toBe(true);
      expect(frameIndex(frame)).toBe(id);
      expect(extractDatetime(frame, NOW)).toBe(time);
      // The request CRC-16 in the capture must match our builder.
      const cmd = hexToBytes(rec.command_hex);
      const body = cmd.subarray(0, cmd.length - 2);
      expect(crc16(body.subarray(1))).toBe(cmd[cmd.length - 2] | (cmd[cmd.length - 1] << 8));
    }
  });

  it("reads next_index 10488 from the captured metadata reply", () => {
    const report = hexToBytes(
      "3f27c09022010100200000f828008f01000000af04001e020000008225001803bd000086010019cd3f9280011108010738520120c80f000038520120c00f0000",
    );
    const frame = new Uint8Array([0, ...report.subarray(2, 2 + report[1])]);
    expect(checkCrc(frame)).toBe(true);
    expect(metadataNextIndex(frame)).toBe(10488);
  });

  it("decodes puff counts on all 26 real frames, incl. controlled 18/14", () => {
    const files = [
      "device-a_history_20261026_192057.json",
      "device-a_history_older_20261026_195416.json",
      "device-a_history_sample_20261026_195811.json",
      "device-a_post_use_20261026_201913.json",
      "device-b_correct_20261026_203051.json",
    ];
    const counts = new Map<number, number>();
    let total = 0;
    for (const file of files) {
      for (const row of loadCapture(file)) {
        const data = hexToBytes(row.response_hex);
        expect(checkCrc(data)).toBe(true);
        const trace = decodePuffs(data);
        expect(trace, `${file} id ${row.id}`).not.toBeNull();
        expect(trace!.count).toBe((data.length - 117) / 2);
        expect(trace!.eventPairs.length).toBe(trace!.count);
        counts.set(row.id, trace!.count);
        total++;
        const bad = new Uint8Array(data);
        bad[19] ^= 0xff;
        expect(decodePuffs(bad)).toBeNull();
      }
    }
    expect(total).toBe(26);
    expect(counts.get(1076)).toBe(18);
    expect(counts.get(10487)).toBe(14);
    expect(counts.get(10486)).toBe(0);
    expect(counts.get(10485)).toBe(15);
  });

  it("normalises statuses like the Python importer", () => {
    const empty = loadCapture("device-b_post_use_20261026_202103.json")[0];
    expect(decodeEvent("ok", empty.response_hex, NOW).status).toBe("empty");
    const full = loadCapture("device-a_post_use_20261026_201913.json").find((r) => r.id === 1076)!;
    const d = decodeEvent("ok", full.response_hex, NOW);
    expect(d.status).toBe("ok");
    expect(d.puffCount).toBe(18);
    expect(d.recordMarker).toBe(0x18);
    expect(d.timestampUtc).toBe("2026-10-26T19:02:00+00:00");
    expect(decodeEvent("ok", full.response_hex.slice(0, -2) + "00", NOW).status).toBe("bad_crc");
    expect(decodeEvent("timeout", "", NOW).status).toBe("timeout");
  });

  it("crc8 rejects a corrupted classic reply", () => {
    // Captured battery reply (fialova): status ok, payload 64 00 ... (100 %).
    const lines = readFileSync(path.join(VECTORS, "device-a_20261026_201331.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const battery = lines.find((r) => r.kind === "scp" && r.phase === "battery")!;
    const frame = hexToBytes(battery.frame);
    const cmd = hexToBytes(READ_COMMANDS.battery);
    expect(decodeClassic(frame, cmd).status).toBe("ok");
    expect(crc8(frame.subarray(2, frame.length - 1))).toBe(frame[frame.length - 1]);
    const bad = new Uint8Array(frame);
    bad[4] ^= 0x01;
    expect(decodeClassic(bad, cmd).status).toBe("bad_crc");
  });
});

describe.skipIf(!HAVE_VECTORS)("classic diagnostics (test_diagnostics.py port)", () => {
  const aliases: Record<string, string> = {
    life_data_raw: "sensor_84",
    reg_83_raw: "sensor_83",
    counters_raw: "counters",
    session_raw: "session",
  };
  const cases: [string, string, number, number][] = [
    ["device-a", "201331", 1077, 14736],
    ["device-b", "201341", 15204, 201053],
  ];
  for (const [color, stamp, sticks, puffs] of cases) {
    it(`parses the ${color} capture`, () => {
      const lines = readFileSync(path.join(VECTORS, `${color}_20261026_${stamp}.jsonl`), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const frames: Record<string, string> = {};
      for (const rec of lines) {
        if (rec.kind !== "scp") continue;
        const key = aliases[rec.phase] ?? rec.phase;
        if (!(key in READ_COMMANDS)) continue;
        const { status } = decodeClassic(hexToBytes(rec.frame), hexToBytes(READ_COMMANDS[key as keyof typeof READ_COMMANDS]));
        if (status === "ok" || status === "unsupported") frames[key] = rec.frame;
      }
      const snap = parseSnapshotFrames(frames);
      expect(snap.values.brightness_level).toBe(0x64); // reg 0x24 is the LED brightness, high
      expect(snap.values.battery_percent).toBeNull(); // reg 0x60 was not captured back then
      expect(snap.values.lifetime_sticks_candidate).toBe(sticks);
      expect(snap.values.lifetime_puffs_candidate).toBe(puffs);
      expect(snap.values.model).toBe("42PT");
      expect(String(snap.values.serial_readback)).toMatch(/^[A-Z0-9]{14}$/);
      expect(snap.statuses.brightness).toBe("unsupported");
      expect(snap.statuses.vibration).toBe("unsupported");
      expect(snap.statuses.flexbattery).toBe("unsupported");
    });
  }
});
