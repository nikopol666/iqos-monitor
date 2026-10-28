/**
 * Classic (short) register replies – port of agent/iqos_agent/device_info.py.
 * The agent sends the snapshot already parsed; the server re-parses the raw
 * frames it stores so interpretations can be corrected later without a new
 * USB read.
 */
import { crc8 } from "./crc";
import { hexToBytes, bytesToHex, u16le, u32le, asciiPayload } from "./bytes";

export const READ_COMMANDS = {
  firmware: "c0000000",
  serial: "c0000309",
  model: "c90022ee",
  battery: "c00024fc",
  sensor_83: "c90320df",
  sensor_84: "c00021e7",
  counters: "c90221cd",
  session: "c90121f2",
  stick_state: "c00120f5",
  error_state: "c00220ca",
  brightness: "c00223c3",
  vibration: "c90023e9",
  flexbattery: "c90025fb",
  // Read-only probes from hauntedfail/iqos; same SCP frames over USB.
  flexpuff: "d205220300000017",
  autostart: "c907240100000022",
  pause_mode: "c907240200000018",
  holder_firmware: "c9000000",
  epoch: "c003003f",
  conversion: "c00020e0",
} as const;

export type ClassicKey = keyof typeof READ_COMMANDS;
export type ClassicStatus = "ok" | "invalid" | "unmatched" | "bad_crc" | "unsupported";

export function decodeClassic(frame: Uint8Array, command: Uint8Array): { status: ClassicStatus; payload: Uint8Array } {
  const empty = new Uint8Array(0);
  if (frame.length < 5 || !(frame[2] & 0x80)) return { status: "invalid", payload: empty };
  if ((frame[2] & 3) !== (command[1] & 3) || frame[3] !== command[2]) return { status: "unmatched", payload: empty };
  if (crc8(frame.subarray(2, frame.length - 1)) !== frame[frame.length - 1]) return { status: "bad_crc", payload: empty };
  if (frame[2] & 0x20) return { status: "unsupported", payload: empty };
  return { status: "ok", payload: frame.subarray(4, frame.length - 1) };
}

export interface SnapshotValues {
  serial_readback: string | null;
  model: string | null;
  firmware_raw: string | null;
  battery_percent: number | null;
  stick_state_code: string | null;
  error_state_code: number | null;
  lifetime_sticks_candidate: number | null;
  lifetime_puffs_candidate: number | null;
  lifetime_seconds_candidate: number | null;
  average_puffs_per_stick_candidate: number | null;
  sensor_83_raw_value: number | null;
  sensor_84_raw_value: number | null;
  last_session_raw: string | null;
  brightness_raw: string | null;
  vibration_raw: string | null;
  flexbattery_raw: string | null;
  flexpuff_enabled: boolean | null;
  autostart_enabled: boolean | null;
  pause_mode_enabled: boolean | null;
  holder_firmware_raw: string | null;
  epoch_raw: string | null;
  conversion_raw: string | null;
}

/** Setting replies carry [setting id, value, 0, 0]; value 1 = enabled. */
function flag(payload: Uint8Array | undefined, settingId: number): boolean | null {
  if (!payload || payload.length < 2 || payload[0] !== settingId) return null;
  return payload[1] === 1;
}

/** Re-derive snapshot values from stored raw frames (hex per command key). */
export function parseSnapshotFrames(frames: Partial<Record<ClassicKey, string>>): {
  values: SnapshotValues;
  statuses: Partial<Record<ClassicKey, ClassicStatus | "missing">>;
} {
  const payloads: Partial<Record<ClassicKey, Uint8Array>> = {};
  const statuses: Partial<Record<ClassicKey, ClassicStatus | "missing">> = {};
  for (const key of Object.keys(READ_COMMANDS) as ClassicKey[]) {
    const hex = frames[key];
    if (!hex) {
      statuses[key] = "missing";
      continue;
    }
    const { status, payload } = decodeClassic(hexToBytes(hex), hexToBytes(READ_COMMANDS[key]));
    statuses[key] = status;
    if (status === "ok") payloads[key] = payload;
  }
  const hexOrNull = (k: ClassicKey) => (payloads[k] ? bytesToHex(payloads[k]!) : null);
  const counters = payloads.counters ?? new Uint8Array(0);
  const sticks = u32le(counters, 0);
  const puffs = u32le(counters, 10);
  const quarterSeconds = u32le(counters, 6);
  const values: SnapshotValues = {
    serial_readback: payloads.serial ? asciiPayload(payloads.serial) : null,
    model: payloads.model ? asciiPayload(payloads.model) : null,
    firmware_raw: hexOrNull("firmware"),
    battery_percent: payloads.battery ? u16le(payloads.battery, 0) : null,
    stick_state_code:
      payloads.stick_state && payloads.stick_state.length ? payloads.stick_state[0].toString(16).padStart(2, "0") : null,
    error_state_code: payloads.error_state ? u16le(payloads.error_state, 0) : null,
    lifetime_sticks_candidate: sticks,
    lifetime_puffs_candidate: puffs,
    lifetime_seconds_candidate: quarterSeconds === null ? null : quarterSeconds / 4,
    average_puffs_per_stick_candidate: sticks && puffs !== null ? Math.round((puffs / sticks) * 100) / 100 : null,
    sensor_83_raw_value: payloads.sensor_83 ? u16le(payloads.sensor_83, 0) : null,
    sensor_84_raw_value: payloads.sensor_84 ? u16le(payloads.sensor_84, 0) : null,
    last_session_raw: hexOrNull("session"),
    brightness_raw: hexOrNull("brightness"),
    vibration_raw: hexOrNull("vibration"),
    flexbattery_raw: hexOrNull("flexbattery"),
    flexpuff_enabled: flag(payloads.flexpuff, 0x03),
    autostart_enabled: flag(payloads.autostart, 0x01),
    pause_mode_enabled: flag(payloads.pause_mode, 0x02),
    holder_firmware_raw: hexOrNull("holder_firmware"),
    epoch_raw: hexOrNull("epoch"),
    conversion_raw: hexOrNull("conversion"),
  };
  return { values, statuses };
}
