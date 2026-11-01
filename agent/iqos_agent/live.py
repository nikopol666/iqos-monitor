"""One-second live read: a reduced set of classic registers (read-only)."""
from __future__ import annotations

import datetime as dt
import time

from iqos_agent.device_info import READ_COMMANDS, read_classic, u16, u32

LIVE_KEYS = ("battery", "stick_state", "counters", "error_state", "session", "status_60", "sensor_83", "sensor_84")


def read_live(dev) -> dict:
    payloads = {}
    statuses = {}
    for key in LIVE_KEYS:
        status, payload, _frame = read_classic(dev, bytes.fromhex(READ_COMMANDS[key]), timeout=0.8)
        statuses[key] = status
        if status == "ok":
            payloads[key] = payload
        time.sleep(0.02)
    counters = payloads.get("counters", b"")
    quarter = u32(counters, 6)
    s60 = payloads.get("status_60", b"")
    return {
        # Reg C0/01/60: [u16 raw, charge %, temperature C] – candidate layout, see PROTOCOL.md
        "battery": s60[2] if len(s60) >= 4 else None,
        "battery_temp_c": s60[3] if len(s60) >= 4 else None,
        "battery_raw": u16(s60, 0) if len(s60) >= 2 else None,
        "brightness_level": payloads["battery"][0] if payloads.get("battery") else None,
        "status_60_raw": s60.hex() if s60 else None,
        # Reg C0/01/20 byte 0 toggles 01/00 without any session: 01 = charging (candidate), not "stick inserted"
        "stick_state": payloads["stick_state"][:1].hex() if payloads.get("stick_state") else None,
        "charging": (payloads["stick_state"][0] == 1) if payloads.get("stick_state") else None,
        "error_state": u16(payloads.get("error_state", b""), 0),
        "lifetime_sticks": u32(counters, 0),
        "lifetime_puffs": u32(counters, 10),
        "lifetime_seconds": (quarter / 4) if quarter is not None else None,
        "session_raw": payloads["session"].hex() if payloads.get("session") else None,
        # Candidate voltage / temperature sensors (regs 0x83 / 0x84), logged for correlation with reg 0x60
        "sensor_83": u16(payloads.get("sensor_83", b""), 0),
        "sensor_84": u16(payloads.get("sensor_84", b""), 0),
        "statuses": statuses,
        "read_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
