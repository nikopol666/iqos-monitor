/**
 * Extended (SCP) history frames – port of agent/iqos_agent/core.py and
 * record_decode.py. Keep both implementations in sync; the vitest suite and
 * the Python tests share the same capture files in /test-vectors.
 */
import { crc16 } from "./crc";
import { u24le, u32le, bytesToHex, bytesEqual, hexToBytes } from "./bytes";

/** Device epoch: seconds since 2010-01-01T00:00:00Z. */
export const BASE_TIME_MS = Date.UTC(2010, 0, 1, 0, 0, 0);
export const HISTORY_DETAIL_PREFIX = hexToBytes("01020001");

/** Extended frame with valid length flag, length field and CRC-16. */
export function checkCrc(frame: Uint8Array): boolean {
  if (frame.length < 12) return false;
  if (!(frame[2] & 0x10)) return false;
  if (frame.length !== frame[3] + 6) return false;
  const expected = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
  return crc16(frame.subarray(2, frame.length - 2)) === expected;
}

export function isDeviceError(frame: Uint8Array): boolean {
  return frame.length > 2 && (frame[2] & 0x20) !== 0;
}

/** Archive index carried by a detailed history response (bytes 8..10 LE). */
export function frameIndex(frame: Uint8Array): number | null {
  return u24le(frame, 8);
}

/**
 * Candidate record timestamp (ISO UTC) corroborated by two precisely timed
 * sessions. Mirrors Python extract_datetime(): null when the frame is invalid,
 * flagged as error, has zero seconds, or lies more than 2 days in the future.
 */
export function extractDatetime(frame: Uint8Array, now: Date = new Date()): string | null {
  if (frame.length < 23 || !checkCrc(frame) || isDeviceError(frame)) return null;
  const seconds = u32le(frame, 19);
  if (!seconds) return null;
  const when = new Date(BASE_TIME_MS + seconds * 1000);
  if (when.getTime() > now.getTime() + 2 * 86400 * 1000) return null;
  return toIsoUtc(when);
}

/** Python-compatible "YYYY-MM-DDTHH:MM:SS+00:00" (no milliseconds). */
export function toIsoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export interface PuffTrace {
  count: number;
  marker: number;
  eventPairs: string[];
}

/**
 * Per-record puff event count. Layout observed in 0x01/0x02 detailed history
 * responses: frame[108] in {0x08, 0x18}, frame[109] = N, N two-byte entries at
 * offset 110, 7 trailer bytes, total length 117 + 2N. The meaning of each pair
 * is NOT verified; pairs are preserved for research only.
 */
export function decodePuffs(frame: Uint8Array): PuffTrace | null {
  if (!checkCrc(frame) || frame.length < 117) return null;
  if (!bytesEqual(frame.subarray(4, 8), HISTORY_DETAIL_PREFIX)) return null;
  const count = frame[109];
  const marker = frame[108];
  if (marker !== 0x08 && marker !== 0x18) return null;
  if (frame.length !== 117 + 2 * count) return null;
  const pairs: string[] = [];
  for (let i = 0; i < count; i++) {
    pairs.push(bytesToHex(frame.subarray(110 + i * 2, 112 + i * 2)));
  }
  return { count, marker, eventPairs: pairs };
}

/** next_index from the archive metadata reply (bytes 10..12 LE). */
export function metadataNextIndex(frame: Uint8Array): number | null {
  if (!checkCrc(frame) || frame.length < 13) return null;
  return u24le(frame, 10);
}

export type EventStatus = string;

export interface DecodedEvent {
  status: EventStatus;
  timestampUtc: string | null;
  puffCount: number | null;
  puffPairs: string[] | null;
  recordMarker: number | null;
}

/**
 * Normalise an incoming (status, response_hex) the same way the agent's
 * storage.save_event / import_json_files do, and decode it.
 */
/** Seconds per unit of a puff pair's byte 0. */
export const PUFF_TIME_UNIT_S = 2;

/**
 * Byte 0 of every puff pair is the puff's time since the session started in
 * 2-second units. Evidence (PROTOCOL.md): the last puff always lands a few
 * seconds before the next session starts (consecutive records 4–7 min
 * apart), capped sessions end at 360 s, the first puff comes 18–22 s after
 * the start (heat-up), and the last-session register's length field equals
 * 2 × last byte 0 + 2–9 s on eight sessions. Returns seconds.
 */
export function puffSpan(pairs: string[] | null | undefined): { first: number; last: number } | null {
  if (!pairs || !pairs.length) return null;
  const times = pairs.map((p) => parseInt(p.slice(0, 2), 16)).filter((n) => Number.isFinite(n));
  if (!times.length) return null;
  return { first: Math.min(...times) * PUFF_TIME_UNIT_S, last: Math.max(...times) * PUFF_TIME_UNIT_S };
}

export function decodeEvent(status: string, responseHex: string | null | undefined, now?: Date): DecodedEvent {
  let frame: Uint8Array | null = null;
  if (responseHex) {
    try {
      frame = hexToBytes(responseHex);
    } catch {
      frame = null;
    }
  }
  let normalised: EventStatus = status;
  if (frame && frame.length && checkCrc(frame)) {
    if (normalised === "ok" && frame.length === 13) normalised = "empty";
  } else if (normalised === "ok" || normalised === "empty") {
    normalised = frame && frame.length ? "bad_crc" : status;
  }
  if (normalised !== "ok" || !frame) {
    return { status: normalised, timestampUtc: null, puffCount: null, puffPairs: null, recordMarker: null };
  }
  const trace = decodePuffs(frame);
  return {
    status: normalised,
    timestampUtc: extractDatetime(frame, now),
    puffCount: trace ? trace.count : null,
    puffPairs: trace ? trace.eventPairs : null,
    recordMarker: trace ? trace.marker : null,
  };
}
