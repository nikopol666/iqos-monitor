"""One-second live read: a reduced set of classic registers (read-only)."""
from __future__ import annotations

import datetime as dt
import time

from iqos_agent.device_info import READ_COMMANDS, read_classic, u16, u32

LIVE_KEYS = ("battery", "stick_state", "counters", "error_state", "session", "status_60")


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
    return {
        "battery": u16(payloads.get("battery", b""), 0),  # C0/00/24 = LED brightness level, see device_info
        "brightness_level": payloads["battery"][0] if payloads.get("battery") else None,
        "status_60_raw": payloads["status_60"].hex() if payloads.get("status_60") else None,
        "stick_state": payloads["stick_state"][:1].hex() if payloads.get("stick_state") else None,
        "error_state": u16(payloads.get("error_state", b""), 0),
        "lifetime_sticks": u32(counters, 0),
        "lifetime_puffs": u32(counters, 10),
        "lifetime_seconds": (quarter / 4) if quarter is not None else None,
        "session_raw": payloads["session"].hex() if payloads.get("session") else None,
        "statuses": statuses,
        "read_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
