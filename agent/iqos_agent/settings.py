"""Device settings writes – ONLY frames captured from the official IQOS app.

Every write below was observed on an ILUMA i ONE (model code 42PT) over USB
in `modra nastaveni.pcapng` / `modra_nastaveni_2.pcapng` (2026-10-28): the app
sent the frame, the device acknowledged it and a subsequent read returned the
new value. Frames are replayed byte-for-byte; nothing is composed at runtime.
Writes are refused for any other model code.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from iqos_agent.device_info import read_classic

VERIFIED_MODELS = {"42PT"}


class SettingError(Exception):
    pass


def _send(dev, hex_command: str, timeout: float = 2.0) -> bytes:
    status, payload, frame = read_classic(dev, bytes.fromhex(hex_command), timeout=timeout)
    if status != "ok":
        raise SettingError(f"device did not acknowledge {hex_command[:8]}… ({status}, {frame.hex() if frame else '-'})")
    return payload


@dataclass(frozen=True)
class SettingSpec:
    key: str
    write: dict[str, list[str]]           # value -> frames to send in order
    read: Optional[str]                   # read-back command (None = fire-and-forget)
    decode: Optional[Callable[[bytes], Optional[str]]] = None
    group: Optional[str] = None           # settings sharing one multi-row write (vibration)
    extra: dict = field(default_factory=dict)


def _flag(index: int, setting_id: Optional[int] = None, on=0x01, off=0x00):
    def decode(payload: bytes) -> Optional[str]:
        if setting_id is not None and (len(payload) < 1 or payload[0] != setting_id):
            return None
        if len(payload) <= index:
            return None
        return {on: "on", off: "off"}.get(payload[index])
    return decode


# Vibration rows of register 0x04. Each row has a captured frame for both
# states; the app always rewrites all five rows and then commits.
VIB_ROWS = {
    "vib_heat":   {"reg": "0c", "off": "c04b045a0c000104001314151601010100d5", "on": "c04b040e0c000104001314151601011d0076", "read": "c007040c000000b8"},
    "vib_almost": {"reg": "0e", "off": "c04b048b0e00010400040101010101010045", "on": "c04b04df0e000104000401010101011d00e6", "read": "c007040e00000094"},
    "vib_ready":  {"reg": "0d", "off": "c04b04470d000104000202020201010100b9", "on": "c04b04130d000104000202020201011d001a", "read": "c007040d000000ae"},
    "vib_end":    {"reg": "0f", "off": "c04b04b00f0001040007010101010101007f", "on": "c04b04e40f000104000701010101011d00dc", "read": "c007040f00000082"},
}
VIB_ROW_ORDER = ["vib_heat", "vib_almost", "vib_ready", "vib_end"]   # order the app uses
VIB_CONST_ROW = "c04b04bb0b000000002b2b2b2b010101005b"
VIB_COMMIT = "c0470400ffff00da"


def decode_vib_row(payload: bytes) -> Optional[str]:
    # payload = [row id, 00, 01, 04, 00, a, b, c, d, 01, 01, state, 00, 00]; state 0x1d = on, 0x01 = off
    if len(payload) < 12:
        return None
    return {0x1D: "on", 0x01: "off"}.get(payload[11])


SETTINGS: dict[str, SettingSpec] = {
    "flexpuff": SettingSpec("flexpuff", {"off": ["c945220300000061"], "on": ["c94522030100000a"]}, "c905220300000017", _flag(1, 0x03)),
    "brightness": SettingSpec("brightness", {"low": ["c044241e0000009a"], "high": ["c044246400000034"]}, "c00024fc", _flag(0, None, on=0x64, off=0x1E)),
    "autostart": SettingSpec("autostart", {"off": ["c047240100000054"], "on": ["c04724010100003f"]}, "c007240100000022", _flag(1, 0x01)),
    "smart_gesture": SettingSpec(
        "smart_gesture",
        {"off": ["c0480507050100000000ffffffffffff0022", "c0440500ffff00c3"], "on": ["c0480514050100000100ffffffffffff0009", "c0440500ffff00c3"]},
        "c00405050100006c",
        _flag(4, 0x05),
    ),
    "lock": SettingSpec("lock", {"on": ["c0440402ff00005a"], "off": ["c04404000000005d"]}, "c000041c", _flag(0, None, on=0x02, off=0x00)),
    # Find my IQOS: momentary vibration burst; no read-back exists.
    "find": SettingSpec("find", {"on": ["c04562011e00000b"], "off": ["c04562001e00001d"]}, None),
}
for _key, _row in VIB_ROWS.items():
    SETTINGS[_key] = SettingSpec(_key, {"off": [_row["off"]], "on": [_row["on"]]}, _row["read"], decode_vib_row, group="vibration")

# Brightness decode maps 0x64 -> "on"; translate to the public value names.
_BRIGHTNESS_NAMES = {"on": "high", "off": "low"}


def read_setting(dev, spec: SettingSpec) -> Optional[str]:
    if spec.read is None or spec.decode is None:
        return None
    status, payload, _frame = read_classic(dev, bytes.fromhex(spec.read), timeout=1.5)
    if status != "ok":
        raise SettingError(f"read-back failed: {status}")
    value = spec.decode(payload)
    if value is None:
        raise SettingError(f"unexpected read-back payload {payload.hex()}")
    return _BRIGHTNESS_NAMES.get(value, value) if spec.key == "brightness" else value


def _write_vibration(dev, changed_key: str, value: str) -> None:
    """Rewrite all vibration rows (current states, one changed) and commit, like the app."""
    states: dict[str, str] = {}
    for key in VIB_ROW_ORDER:
        current = read_setting(dev, SETTINGS[key])
        if current not in ("on", "off"):
            raise SettingError(f"cannot read current state of {key}")
        states[key] = current
    states[changed_key] = value
    for key in VIB_ROW_ORDER:
        _send(dev, VIB_ROWS[key][states[key]])
        time.sleep(0.05)
    _send(dev, VIB_CONST_ROW)
    time.sleep(0.05)
    _send(dev, VIB_COMMIT)


def apply_setting(dev, model: Optional[str], setting: str, value: str) -> Optional[str]:
    """Write one setting and return the value read back from the device (None when no read-back)."""
    if model not in VERIFIED_MODELS:
        raise SettingError(f"writes are only verified for {sorted(VERIFIED_MODELS)}, device reports {model!r}")
    spec = SETTINGS.get(setting)
    if spec is None:
        raise SettingError(f"unknown setting {setting!r}")
    value = str(value).lower()
    if value not in spec.write:
        raise SettingError(f"unsupported value {value!r} for {setting}")
    if spec.group == "vibration":
        _write_vibration(dev, setting, value)
    else:
        for frame in spec.write[value]:
            _send(dev, frame)
            time.sleep(0.05)
    if spec.read is None:
        return None
    time.sleep(0.25)
    result = read_setting(dev, spec)
    if result != value:
        raise SettingError(f"read-back shows {result!r} after writing {value!r}")
    return result
